import argparse
import datetime
import logging
import sys
from dataclasses import dataclass

from src import scraper, analyzer, calculator, db

log = logging.getLogger("pipeline")


@dataclass
class RunParams:
    """Parameters for a single pipeline run (fetch → sentiment → DB)."""

    as_of_date: datetime.date
    fetch_limit: int = 50
    after: str | None = None
    before: str | None = None
    max_posts_scan: int = 800
    compare_to_date: datetime.date | None = None


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


def run(params: RunParams | None = None) -> dict:
    """
    Execute the full pipeline. If params is None, uses today and default fetch settings.

    Returns a small summary dict for HTTP/CLI callers.
    """
    if params is None:
        today = datetime.date.today()
        params = RunParams(as_of_date=today)

    as_of = params.as_of_date
    compare_day = params.compare_to_date
    if compare_day is None:
        compare_day = as_of - datetime.timedelta(days=1)

    log.info("Pipeline starting for as_of=%s (compare changelog to %s)", as_of, compare_day)

    log.info("--- Step 0: Ensuring database tables ---")
    db.ensure_tables()

    log.info("--- Step 1: Fetching Reddit posts ---")
    posts = scraper.fetch_top_posts_by_score(
        limit=params.fetch_limit,
        after=params.after,
        before=params.before,
        max_posts_scan=params.max_posts_scan,
    )
    if not posts:
        log.warning("No posts with ticker mentions found. Exiting.")
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

    log.info("--- Step 4: Computing ETF price ---")
    etf_price = calculator.compute_etf_price(composition)

    log.info("--- Step 5: Diffing against previous composition ---")
    prior_composition = db.get_composition(compare_day)
    changelog = calculator.diff_composition(composition, prior_composition)

    log.info("--- Step 6: Writing results to database ---")
    db.upsert_composition(composition, as_of)
    if etf_price is not None:
        db.upsert_etf_price(etf_price, as_of)
    db.insert_changelog(changelog, as_of)

    log.info("Pipeline complete for %s", as_of)
    return {
        "ok": True,
        "as_of": str(as_of),
        "posts_analyzed": len(posts),
        "tickers": len(sentiments),
        "composition_entries": len(composition),
        "etf_price": etf_price,
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
        help="Date to tag this run in the DB (YYYY-MM-DD). Default: today UTC calendar date.",
    )
    parser.add_argument(
        "--compare-date",
        type=str,
        default=None,
        help="Changelog baseline composition date (YYYY-MM-DD). Default: day before --date.",
    )
    parser.add_argument("--limit", type=int, default=50, help="How many top-by-score posts to analyze")
    parser.add_argument(
        "--after",
        type=str,
        default=None,
        help="Arctic Shift time window start (e.g. 1year, 2025-01-01)",
    )
    parser.add_argument(
        "--before",
        type=str,
        default=None,
        help="Arctic Shift time window end (e.g. 2026-04-03 or epoch seconds)",
    )
    parser.add_argument(
        "--max-posts-scan",
        type=int,
        default=800,
        help="Max posts-with-tickers to consider when ranking by score (pagination cap)",
    )
    args = parser.parse_args()

    today = datetime.date.today()
    as_of = _parse_date(args.date) if args.date else today
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
