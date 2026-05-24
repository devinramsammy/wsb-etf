import argparse
import datetime
import logging
import sys
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from src import scraper, analyzer, calculator, db
from src.config import get_subreddits

ET = ZoneInfo("America/New_York")

log = logging.getLogger("pipeline")


@dataclass
class RunParams:
    """Parameters for a single pipeline run (fetch → sentiment → DB)."""

    as_of_date: datetime.date
    subreddit: str | None = None
    fetch_limit: int = 150
    after: str | None = None
    before: str | None = None
    max_posts_scan: int = 15000
    compare_to_date: datetime.date | None = None


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


def _posts_window(as_of: datetime.date) -> tuple[str, str]:
    """Return (after, before) covering the 7 days before as_of."""
    end = datetime.datetime(as_of.year, as_of.month, as_of.day)
    start = end - datetime.timedelta(days=7)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def run(params: RunParams | None = None) -> dict:
    """
    Execute the full pipeline for one subreddit.

    --date is the price date (default: today). The pipeline fetches posts from
    the previous 7 days to derive sentiment, then records the ETF price under --date.

    Returns a small summary dict for HTTP/CLI callers.
    """
    if params is None:
        params = RunParams(as_of_date=datetime.datetime.now(ET).date())

    if not params.subreddit:
        raise ValueError("RunParams.subreddit is required for run()")

    as_of = params.as_of_date
    subreddit = params.subreddit
    compare_day = params.compare_to_date
    if compare_day is None:
        compare_day = as_of - datetime.timedelta(weeks=1)

    after = params.after
    before = params.before
    if after is None and before is None:
        after, before = _posts_window(as_of)

    posts_day = (datetime.date.fromisoformat(after) if after else as_of - datetime.timedelta(days=1))
    log.info("Pipeline for r/%s on %s — using posts from %s", subreddit, as_of, posts_day)

    log.info("--- Step 0: Ensuring database tables ---")
    db.ensure_tables()
    db.ensure_initial_baseline(subreddit)

    log.info("--- Step 1: Fetching Reddit posts from r/%s (%s → %s) ---", subreddit, after, before)
    posts = scraper.fetch_top_posts_by_score(
        limit=params.fetch_limit,
        subreddit=subreddit,
        after=after,
        before=before,
        max_posts_scan=params.max_posts_scan,
    )
    if not posts:
        log.warning("No posts found for r/%s. Exiting.", subreddit)
        return {"ok": False, "error": "no_posts", "as_of": str(as_of), "subreddit": subreddit}

    log.info("--- Step 2: Running sentiment analysis ---")
    sentiments = analyzer.analyze_sentiment(posts)
    if not sentiments:
        log.warning("No sentiment results for r/%s. Exiting.", subreddit)
        return {"ok": False, "error": "no_sentiment", "as_of": str(as_of), "subreddit": subreddit}

    log.info("--- Step 3: Computing ETF composition ---")
    composition = calculator.compute_composition(sentiments)
    if not composition:
        log.warning("Empty composition for r/%s. Exiting.", subreddit)
        return {"ok": False, "error": "empty_composition", "as_of": str(as_of), "subreddit": subreddit}

    log.info("--- Step 4: Rebalancing ETF (NAV-based) ---")
    prev_entries, prev_date = db.get_latest_composition(subreddit)
    prev_nav, _ = db.get_latest_nav(subreddit)
    initial_nav = prev_nav if prev_nav is not None else db.INITIAL_ETF_PRICE

    result = calculator.rebalance(
        composition=composition,
        prev_entries=prev_entries,
        as_of=as_of,
        initial_nav=initial_nav,
    )
    if result is None:
        log.warning("Rebalance failed for r/%s. Exiting.", subreddit)
        return {"ok": False, "error": "rebalance_failed", "as_of": str(as_of), "subreddit": subreddit}

    log.info("--- Step 5: Diffing against previous composition ---")
    prior_composition = db.get_composition(compare_day, subreddit)
    changelog = calculator.diff_composition(result.entries, prior_composition)

    log.info("--- Step 6: Writing results to database ---")
    db.replace_composition(result.entries, as_of, subreddit)
    db.upsert_etf_price(result.nav, as_of, subreddit)
    db.replace_changelog(changelog, as_of, subreddit)

    log.info("Pipeline complete for r/%s on %s — NAV: $%.2f", subreddit, as_of, result.nav)
    return {
        "ok": True,
        "subreddit": subreddit,
        "as_of": str(as_of),
        "posts_analyzed": len(posts),
        "tickers": len(sentiments),
        "composition_entries": len(result.entries),
        "etf_price": result.nav,
    }


def run_all(params_base: RunParams) -> list[dict]:
    """Run the pipeline for each configured subreddit."""
    results: list[dict] = []
    for subreddit in get_subreddits():
        params = RunParams(
            as_of_date=params_base.as_of_date,
            subreddit=subreddit,
            fetch_limit=params_base.fetch_limit,
            after=params_base.after,
            before=params_base.before,
            max_posts_scan=params_base.max_posts_scan,
            compare_to_date=params_base.compare_to_date,
        )
        results.append(run(params))
    return results


def _parse_date(s: str) -> datetime.date:
    return datetime.date.fromisoformat(s)


def main() -> None:
    setup_logging()
    parser = argparse.ArgumentParser(description="Reddit sentiment ETF pipeline")
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="ETF price date (YYYY-MM-DD). Posts from the previous 7 days are used. Default: today.",
    )
    parser.add_argument(
        "--compare-date",
        type=str,
        default=None,
        help="Changelog baseline date (YYYY-MM-DD). Default: 7 days before --date.",
    )
    parser.add_argument(
        "--subreddit",
        type=str,
        default=None,
        help="Run for a single subreddit (e.g. investing). Default: all configured subreddits.",
    )
    parser.add_argument("--limit", type=int, default=150, help="How many top-by-score posts to analyze")
    parser.add_argument(
        "--after",
        type=str,
        default=None,
        help="Override post window start (e.g. 2025-01-01). Default: 7 days before --date.",
    )
    parser.add_argument(
        "--before",
        type=str,
        default=None,
        help="Override post window end (e.g. 2025-02-01). Default: --date.",
    )
    parser.add_argument(
        "--max-posts-scan",
        type=int,
        default=15000,
        help="Max posts to consider when ranking by score (pagination cap)",
    )
    args = parser.parse_args()

    as_of = _parse_date(args.date) if args.date else datetime.datetime.now(ET).date()
    compare_to = _parse_date(args.compare_date) if args.compare_date else None

    params = RunParams(
        as_of_date=as_of,
        subreddit=args.subreddit.lower().removeprefix("r/") if args.subreddit else None,
        fetch_limit=args.limit,
        after=args.after,
        before=args.before,
        max_posts_scan=args.max_posts_scan,
        compare_to_date=compare_to,
    )

    try:
        if args.subreddit:
            results = [run(params)]
        else:
            results = run_all(params)

        if not all(r.get("ok") for r in results):
            sys.exit(1)
    except Exception:
        log.exception("Pipeline failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
