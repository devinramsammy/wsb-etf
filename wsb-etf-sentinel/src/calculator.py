import datetime
import logging
from dataclasses import dataclass

import yfinance as yf

from src.analyzer import TickerSentiment

log = logging.getLogger("pipeline")

SENTIMENT_WEIGHTS = {
    "bullish": 1.0,
    "neutral": 0.3,
    "bearish": 0.0,
}


@dataclass
class CompositionEntry:
    ticker: str
    percentage: float   # 0.0 to 1.0, all entries sum to 1.0
    shares: float = 0.0
    price: float = 0.0  # closing price at rebalance


@dataclass
class ChangelogEntry:
    action: str  # "added" | "removed" | "rebalanced"
    ticker: str
    weight: float


MIN_WEIGHT_PCT = 0.01  # 1% floor


def compute_composition(sentiments: list[TickerSentiment]) -> list[CompositionEntry]:
    """Weight tickers by sentiment * Reddit score, apply 1% floor, redistribute remainder evenly."""
    raw_weights: dict[str, float] = {}
    for s in sentiments:
        multiplier = SENTIMENT_WEIGHTS.get(s.sentiment, 0.0)
        if multiplier > 0:
            raw_weights[s.ticker] = multiplier * s.score

    if not raw_weights:
        log.warning("No tickers with positive sentiment weight")
        return []

    total = sum(raw_weights.values())
    pcts = {t: w / total for t, w in raw_weights.items()}

    # Keep only tickers at or above 1%
    above = {t: p for t, p in pcts.items() if p >= MIN_WEIGHT_PCT}
    below = {t: p for t, p in pcts.items() if p < MIN_WEIGHT_PCT}

    if not above:
        log.warning("No tickers above %.0f%% threshold", MIN_WEIGHT_PCT * 100)
        return []

    leftover = sum(below.values())
    if leftover > 0 and above:
        bonus = leftover / len(above)
        above = {t: p + bonus for t, p in above.items()}

    log.info("Composition: %d tickers (dropped %d below 1%%)", len(above), len(below))

    composition = [
        CompositionEntry(ticker=ticker, percentage=round(pct, 4))
        for ticker, pct in sorted(above.items(), key=lambda x: x[1], reverse=True)
    ]

    for entry in composition[:10]:
        log.info("  %s: %.2f%%", entry.ticker, entry.percentage * 100)
    return composition


def fetch_price(ticker: str, as_of: datetime.date | None) -> float | None:
    """Fetch closing price for a ticker. Uses historical close if as_of is in the past."""
    t = yf.Ticker(ticker)
    today = datetime.date.today()

    if as_of is None or as_of >= today:
        info = t.info
        price = info.get("regularMarketPrice") or info.get("currentPrice")
        if price is not None:
            return float(price)
        hist = t.history(period="1d")
        if not hist.empty:
            return float(hist["Close"].iloc[-1])
        return None

    start = as_of - datetime.timedelta(days=5)
    end = as_of + datetime.timedelta(days=1)
    hist = t.history(start=start.isoformat(), end=end.isoformat())
    if hist.empty:
        return None
    hist.index = hist.index.tz_localize(None)
    mask = hist.index.date <= as_of
    valid = hist.loc[mask]
    if valid.empty:
        return None
    return float(valid["Close"].iloc[-1])


def fetch_prices(tickers: list[str], as_of: datetime.date | None) -> dict[str, float]:
    """Fetch closing prices for multiple tickers. Returns {ticker: price} for resolved ones."""
    prices: dict[str, float] = {}
    for ticker in tickers:
        try:
            price = fetch_price(ticker, as_of)
            if price is not None:
                prices[ticker] = price
            else:
                log.warning("No price found for %s on %s", ticker, as_of)
        except Exception as exc:
            log.warning("Failed to fetch price for %s: %s", ticker, exc)
    return prices


@dataclass
class RebalanceResult:
    nav: float
    entries: list[CompositionEntry]  # fully populated with shares + price


def rebalance(
    composition: list[CompositionEntry],
    prev_entries: list[CompositionEntry],
    as_of: datetime.date,
    initial_nav: float = 100.0,
) -> RebalanceResult | None:
    """
    Rebalance the ETF:
    1. Value current holdings at as_of closing prices → current NAV
    2. Sell everything (conceptually)
    3. Buy new shares according to composition weights

    If prev_entries is empty, seeds with initial_nav.
    """
    prev_tickers = {e.ticker for e in prev_entries}
    new_tickers = {e.ticker for e in composition}
    all_tickers = list(prev_tickers | new_tickers)
    log.info("Fetching prices for %d tickers (as_of=%s)", len(all_tickers), as_of)
    prices = fetch_prices(all_tickers, as_of)

    if not prices:
        log.error("Could not resolve price for any ticker")
        return None

    if prev_entries:
        portfolio_value = 0.0
        for entry in prev_entries:
            price = prices.get(entry.ticker)
            if price is not None:
                portfolio_value += entry.shares * price
                log.debug("Liquidate %s: %.6f shares * $%.2f = $%.2f", entry.ticker, entry.shares, price, entry.shares * price)
            else:
                log.warning("Cannot price %s for liquidation, treating as $0", entry.ticker)
        if portfolio_value <= 0:
            log.error("Portfolio value is $0 after liquidation")
            return None
        nav = portfolio_value
    else:
        nav = initial_nav
        log.info("No previous holdings, seeding with NAV $%.2f", nav)

    resolvable = [e for e in composition if e.ticker in prices]
    if not resolvable:
        log.error("No tickers in new composition could be priced")
        return None

    total_pct = sum(e.percentage for e in resolvable)
    result_entries: list[CompositionEntry] = []

    for entry in resolvable:
        adjusted_pct = entry.percentage / total_pct
        dollar_alloc = nav * adjusted_pct
        shares = dollar_alloc / prices[entry.ticker]
        result_entries.append(CompositionEntry(
            ticker=entry.ticker,
            percentage=round(adjusted_pct, 4),
            shares=round(shares, 6),
            price=round(prices[entry.ticker], 2),
        ))
        log.debug(
            "Buy %s: $%.2f (%.2f%%) / $%.2f = %.6f shares",
            entry.ticker, dollar_alloc, adjusted_pct * 100,
            prices[entry.ticker], shares,
        )

    nav = round(nav, 2)
    log.info("Rebalance complete: NAV $%.2f, %d holdings", nav, len(result_entries))
    return RebalanceResult(nav=nav, entries=result_entries)


def diff_composition(
    today: list[CompositionEntry],
    yesterday: list[CompositionEntry],
) -> list[ChangelogEntry]:
    """Compare today's composition to yesterday's and produce changelog entries."""
    today_map = {e.ticker: e.percentage for e in today}
    yesterday_map = {e.ticker: e.percentage for e in yesterday}

    changelog: list[ChangelogEntry] = []

    for ticker, weight in today_map.items():
        if ticker not in yesterday_map:
            changelog.append(ChangelogEntry(action="added", ticker=ticker, weight=weight))
        elif weight != yesterday_map[ticker]:
            changelog.append(ChangelogEntry(action="rebalanced", ticker=ticker, weight=weight))

    for ticker, weight in yesterday_map.items():
        if ticker not in today_map:
            changelog.append(ChangelogEntry(action="removed", ticker=ticker, weight=weight))

    log.info(
        "Changelog: %d added, %d removed, %d rebalanced",
        sum(1 for c in changelog if c.action == "added"),
        sum(1 for c in changelog if c.action == "removed"),
        sum(1 for c in changelog if c.action == "rebalanced"),
    )
    return changelog
