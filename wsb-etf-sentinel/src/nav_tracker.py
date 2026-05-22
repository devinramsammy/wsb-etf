"""
Daily NAV tracker for Reddit sentiment ETFs.

Calculates the ETF's net asset value by pricing the current composition
(shares × closing price) using yfinance. No rebalancing — just a price snapshot.

Usage:
    # Today's NAV for all configured subreddits (default)
    python -m src.nav_tracker

    # Specific date and subreddit
    python -m src.nav_tracker --date 2026-04-07 --subreddit investing
"""

import argparse
import datetime
import logging
import sys
from zoneinfo import ZoneInfo

from src import db
from src.calculator import fetch_prices
from src.config import get_subreddits

ET = ZoneInfo("America/New_York")
log = logging.getLogger("pipeline")


def compute_nav(date: datetime.date, subreddit: str) -> float | None:
    """
    Compute NAV for `date` using the composition that was active on that date.
    Returns the NAV or None if pricing failed.
    """
    entries, comp_date = db.get_composition_at_or_before(date, subreddit)
    if not entries:
        log.warning("No composition found for r/%s on or before %s", subreddit, date)
        return None

    log.info(
        "Using composition from %s (%d holdings) for r/%s on %s",
        comp_date,
        len(entries),
        subreddit,
        date,
    )

    tickers = [e.ticker for e in entries]
    prices = fetch_prices(tickers, date)

    if not prices:
        log.error("Could not fetch any prices for %s", date)
        return None

    nav = 0.0
    for entry in entries:
        price = prices.get(entry.ticker)
        if price is not None:
            nav += entry.shares * price
        else:
            log.warning("No price for %s on %s, using last known price $%.2f", entry.ticker, date, entry.price)
            nav += entry.shares * entry.price

    nav = round(nav, 2)
    log.info("NAV for r/%s on %s: $%.2f", subreddit, date, nav)
    return nav


def track(date: datetime.date, subreddit: str) -> bool:
    """Compute and store NAV for a single date and subreddit."""
    nav = compute_nav(date, subreddit)
    if nav is None:
        return False
    db.upsert_etf_price(nav, date, subreddit)
    return True


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    parser = argparse.ArgumentParser(description="Reddit sentiment ETF daily NAV tracker")
    parser.add_argument("--date", type=str, default=None, help="NAV date (YYYY-MM-DD). Default: today ET.")
    parser.add_argument(
        "--subreddit",
        type=str,
        default=None,
        help="Track a single subreddit. Default: all configured subreddits.",
    )
    args = parser.parse_args()

    db.ensure_tables()

    date = datetime.date.fromisoformat(args.date) if args.date else datetime.datetime.now(ET).date()
    subreddits = (
        [args.subreddit.lower().removeprefix("r/")]
        if args.subreddit
        else get_subreddits()
    )

    failed = False
    for subreddit in subreddits:
        db.ensure_initial_baseline(subreddit)
        if not track(date, subreddit):
            failed = True

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
