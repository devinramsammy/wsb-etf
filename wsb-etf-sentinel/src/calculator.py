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
    percentage: float  # 0.0 to 1.0, all entries sum to 1.0


@dataclass
class ChangelogEntry:
    action: str  # "added" | "removed" | "rebalanced"
    ticker: str
    weight: float


def compute_composition(sentiments: list[TickerSentiment]) -> list[CompositionEntry]:
    """Weight tickers by bullish sentiment and normalize to sum to 1.0."""
    raw_weights: dict[str, float] = {}
    for s in sentiments:
        weight = SENTIMENT_WEIGHTS.get(s.sentiment, 0.0)
        if weight > 0:
            raw_weights[s.ticker] = weight

    if not raw_weights:
        log.warning("No tickers with positive sentiment weight")
        return []

    total = sum(raw_weights.values())
    composition = [
        CompositionEntry(ticker=ticker, percentage=round(weight / total, 4))
        for ticker, weight in sorted(raw_weights.items())
    ]

    log.info("Composition: %d tickers", len(composition))
    return composition


def compute_etf_price(composition: list[CompositionEntry]) -> float | None:
    """Compute a weighted ETF price from current stock prices via yfinance."""
    if not composition:
        return None

    tickers = [entry.ticker for entry in composition]
    log.info("Fetching prices for %d tickers", len(tickers))

    try:
        ticker_data = yf.Tickers(" ".join(tickers))
    except Exception as exc:
        log.error("yfinance bulk fetch failed: %s", exc)
        return None

    weighted_price = 0.0
    resolved_weight = 0.0

    for entry in composition:
        try:
            info = ticker_data.tickers[entry.ticker].info
            price = info.get("regularMarketPrice") or info.get("currentPrice")
            if price is None:
                hist = ticker_data.tickers[entry.ticker].history(period="1d")
                if not hist.empty:
                    price = float(hist["Close"].iloc[-1])

            if price is not None:
                weighted_price += price * entry.percentage
                resolved_weight += entry.percentage
                log.debug("%s: $%.2f * %.4f", entry.ticker, price, entry.percentage)
            else:
                log.warning("No price found for %s, skipping", entry.ticker)
        except Exception as exc:
            log.warning("Failed to fetch price for %s: %s", entry.ticker, exc)

    if resolved_weight == 0:
        log.error("Could not resolve price for any ticker")
        return None

    # Re-normalize for missing tickers so price isn't artificially low
    etf_price = round(weighted_price / resolved_weight, 2)
    log.info("ETF price: $%.2f (resolved %.1f%% of weight)", etf_price, resolved_weight * 100)
    return etf_price


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
