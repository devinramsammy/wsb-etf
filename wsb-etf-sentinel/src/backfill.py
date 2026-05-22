"""
Historical backfill for a subreddit by mirroring another subreddit's rebalance/NAV date grid.

Usage:
    python -m src.backfill --subreddit investing --through 2026-05-21
    python -m src.backfill --subreddit investing --through 2026-05-21 --dry-run
    python -m src.backfill --subreddit investing --through 2026-05-21 --skip-existing
"""

from __future__ import annotations

import argparse
import datetime
import logging
import sys

from src import db, main, nav_tracker
from src.main import RunParams, setup_logging

log = logging.getLogger("pipeline")


def _parse_date(s: str) -> datetime.date:
    return datetime.date.fromisoformat(s)


def _rebalance_dates(source: str, through: datetime.date) -> list[datetime.date]:
    return [d for d in db.get_distinct_changelog_dates(source) if d <= through]


def _nav_dates(source: str, through: datetime.date) -> list[datetime.date]:
    return db.get_distinct_nav_dates(source, through=through)


def backfill(
    *,
    subreddit: str,
    through: datetime.date,
    source_subreddit: str = db.DEFAULT_SUBREDDIT,
    dry_run: bool = False,
    skip_existing: bool = False,
    fetch_limit: int = 150,
    max_posts_scan: int = 15000,
) -> bool:
    """
    Phase 1: weekly rebalances (main pipeline) on source rebalance dates.
    Phase 2: daily NAV (nav_tracker) on source NAV dates through `through`.
    """
    rebalance_dates = _rebalance_dates(source_subreddit, through)
    nav_dates = _nav_dates(source_subreddit, through)

    if not rebalance_dates:
        log.error("No rebalance dates found for r/%s", source_subreddit)
        return False
    if not nav_dates:
        log.error("No NAV dates found for r/%s through %s", source_subreddit, through)
        return False

    log.info(
        "Backfill r/%s through %s — %d rebalance dates, %d NAV dates (grid from r/%s)",
        subreddit,
        through,
        len(rebalance_dates),
        len(nav_dates),
        source_subreddit,
    )

    if dry_run:
        log.info("=== DRY RUN — Phase 1: rebalances ===")
        for d in rebalance_dates:
            if d == db.INITIAL_COMPOSITION_DATE:
                log.info("  [SKIP] genesis baseline %s", d)
                continue
            exists = db.composition_exists(subreddit, d)
            skip = skip_existing and exists
            action = "SKIP" if skip else "RUN"
            log.info("  [%s] main --subreddit %s --date %s", action, subreddit, d)
        log.info("=== DRY RUN — Phase 2: daily NAV ===")
        for d in nav_dates:
            log.info("  [RUN] nav_tracker --subreddit %s --date %s", subreddit, d)
        return True

    db.ensure_tables()
    db.ensure_initial_baseline(subreddit)

    log.info("=== Phase 1: %d weekly rebalances ===", len(rebalance_dates))
    for i, as_of in enumerate(rebalance_dates, 1):
        if as_of == db.INITIAL_COMPOSITION_DATE:
            log.info(
                "(%d/%d) Skipping main on genesis date %s (baseline already seeded)",
                i,
                len(rebalance_dates),
                as_of,
            )
            continue

        if skip_existing and db.composition_exists(subreddit, as_of):
            log.info("(%d/%d) Skipping r/%s %s — composition exists", i, len(rebalance_dates), subreddit, as_of)
            continue

        log.info("(%d/%d) Rebalance r/%s for %s", i, len(rebalance_dates), subreddit, as_of)
        result = main.run(
            RunParams(
                as_of_date=as_of,
                subreddit=subreddit,
                fetch_limit=fetch_limit,
                max_posts_scan=max_posts_scan,
            )
        )
        if not result.get("ok"):
            log.error("Rebalance failed for %s: %s", as_of, result.get("error"))
            return False

    log.info("=== Phase 2: %d daily NAV snapshots ===", len(nav_dates))
    failed_nav: list[datetime.date] = []
    for i, date in enumerate(nav_dates, 1):
        log.info("(%d/%d) NAV r/%s for %s", i, len(nav_dates), subreddit, date)
        if not nav_tracker.track(date, subreddit):
            log.warning("NAV failed for %s", date)
            failed_nav.append(date)

    if failed_nav:
        log.error("Backfill finished with %d NAV failures: %s", len(failed_nav), failed_nav[:5])
        return False

    log.info("Backfill complete for r/%s through %s", subreddit, through)
    return True


def cli() -> None:
    setup_logging()
    parser = argparse.ArgumentParser(description="Backfill a subreddit from an existing date grid")
    parser.add_argument("--subreddit", required=True, help="Target subreddit (e.g. investing)")
    parser.add_argument(
        "--through",
        required=True,
        type=str,
        help="Last date to backfill (YYYY-MM-DD), inclusive",
    )
    parser.add_argument(
        "--source-subreddit",
        type=str,
        default=db.DEFAULT_SUBREDDIT,
        help="Subreddit whose rebalance/NAV dates to mirror (default: wallstreetbets)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print planned runs only")
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip rebalance dates that already have composition rows",
    )
    parser.add_argument("--limit", type=int, default=150, help="Posts per rebalance (default: 150)")
    parser.add_argument(
        "--max-posts-scan",
        type=int,
        default=15000,
        help="Max posts scanned when ranking by score",
    )
    args = parser.parse_args()

    subreddit = args.subreddit.lower().removeprefix("r/")
    source = args.source_subreddit.lower().removeprefix("r/")
    through = _parse_date(args.through)

    ok = backfill(
        subreddit=subreddit,
        through=through,
        source_subreddit=source,
        dry_run=args.dry_run,
        skip_existing=args.skip_existing,
        fetch_limit=args.limit,
        max_posts_scan=args.max_posts_scan,
    )
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    cli()
