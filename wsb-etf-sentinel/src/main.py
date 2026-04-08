import argparse
import datetime
import logging
import sys
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from src import scraper, analyzer, calculator, db

ET = ZoneInfo("America/New_York")

log = logging.getLogger("pipeline")


@dataclass
class RunParams:
    """Parameters for a single pipeline run (fetch → sentiment → DB)."""

    as_of_date: datetime.date
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
    Execute the full pipeline.

    --date is the price date (default: today). The pipeline fetches posts from
    the previous 7 days to derive sentiment, then records the ETF price under --date.

    Returns a small summary dict for HTTP/CLI callers.
    """
    if params is None:
        params = RunParams(as_of_date=datetime.datetime.now(ET).date())

    as_of = params.as_of_date
    compare_day = params.compare_to_date
    if compare_day is None:
        compare_day = as_of - datetime.timedelta(weeks=1)

    after = params.after
    before = params.before
    if after is None and before is None:
        after, before = _posts_window(as_of)

    posts_day = (datetime.date.fromisoformat(after) if after else as_of - datetime.timedelta(days=1))
    log.info("Pipeline for %s — using posts from %s", as_of, posts_day)

    log.info("--- Step 0: Ensuring database tables ---")
    db.ensure_tables()

    log.info("--- Step 1: Fetching Reddit posts (%s → %s) ---", after, before)
    posts = scraper.fetch_top_posts_by_score(
        limit=params.fetch_limit,
        after=after,
        before=before,
        max_posts_scan=params.max_posts_scan,
    )
    if not posts:
        log.warning("No posts found. Exiting.")
        return {"ok": False, "error": "no_posts", "as_of": str(as_of)}

    log.info("--- Step 2: Running sentiment analysis ---")
    sentiments = analyzer.analyze_sentiment(posts)
    if not sentiments:
        log.warning("No sentiment results. Exiting.")
        return {"ok": False, "error": "no_sentiment", "as_of": str(as_of)}

    log.info("--- Step 3: Computing ETF composition ---")
    composition = calculator.compute_composition(sentiments)
    if not composition:
        log.warning("Empty composition. Exiting.")
        return {"ok": False, "error": "empty_composition", "as_of": str(as_of)}

    log.info("--- Step 4: Rebalancing ETF (NAV-based) ---")
    prev_entries, prev_date = db.get_latest_composition()
    prev_nav, _ = db.get_latest_nav()
    initial_nav = prev_nav if prev_nav is not None else db.INITIAL_ETF_PRICE

    result = calculator.rebalance(
        composition=composition,
        prev_entries=prev_entries,
        as_of=as_of,
        initial_nav=initial_nav,
    )
    if result is None:
        log.warning("Rebalance failed. Exiting.")
        return {"ok": False, "error": "rebalance_failed", "as_of": str(as_of)}

    log.info("--- Step 5: Diffing against previous composition ---")
    prior_composition = db.get_composition(compare_day)
    changelog = calculator.diff_composition(result.entries, prior_composition)

    log.info("--- Step 6: Writing results to database ---")
    db.insert_composition(result.entries, as_of)
    db.insert_etf_price(result.nav, as_of)
    db.insert_changelog(changelog, as_of)

    log.info("Pipeline complete for %s — NAV: $%.2f", as_of, result.nav)
    return {
        "ok": True,
        "as_of": str(as_of),
        "posts_analyzed": len(posts),
        "tickers": len(sentiments),
        "composition_entries": len(result.entries),
        "etf_price": result.nav,
    }


def _parse_date(s: str) -> datetime.date:
    return datetime.date.fromisoformat(s)


def main() -> None:
    setup_logging()
    parser = argparse.ArgumentParser(description="WSB ETF sentiment pipeline")
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
        fetch_limit=args.limit,
        after=args.after,
        before=args.before,
        max_posts_scan=args.max_posts_scan,
        compare_to_date=compare_to,
    )

    try:
        result = run(params)
        if not result.get("ok"):
            sys.exit(1)
    except Exception:
        log.exception("Pipeline failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
