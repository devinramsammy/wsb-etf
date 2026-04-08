import json
import logging
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import google.generativeai as genai

from src.config import get_gemini_api_key
from src.scraper import RedditPost

log = logging.getLogger("pipeline")

RESPONSE_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "ticker": {
                "type": "string",
                "description": "Uppercase US stock ticker symbol (e.g. TSLA, AAPL)",
            },
            "sentiment": {
                "type": "string",
                "enum": ["bullish", "bearish", "neutral"],
            },
        },
        "required": ["ticker", "sentiment"],
    },
}

PROMPT_TEMPLATE = (
    "You are a financial sentiment analyst. Analyze this Reddit post "
    "from r/wallstreetbets.\n\n"
    "1. Identify every real, tradeable US stock ticker mentioned or implied "
    "(e.g. 'Tesla' → TSLA, 'Apple' → AAPL). Ignore ETFs, indices, "
    "crypto, and non-stock references.\n"
    "2. For each ticker, determine the sentiment: "
    '"bullish", "bearish", or "neutral".\n\n'
    "If the post mentions no real stock ticker, return an empty array.\n\n"
    "Post (score: {score}):\n"
    "Title: {title}\n"
    "Body: {body}"
)


@dataclass
class TickerSentiment:
    ticker: str
    sentiment: str  # "bullish" | "bearish" | "neutral"
    score: int = 0  # reddit score of the post that produced this signal


def _build_prompt(post: RedditPost) -> str:
    body = post.body[:2000] if post.body else "(no body)"
    return PROMPT_TEMPLATE.format(score=post.score, title=post.title, body=body)


def _merge_sentiments(signals: list[TickerSentiment]) -> list[TickerSentiment]:
    """Aggregate per-post signals into one sentiment per ticker, weighted by Reddit score."""
    ticker_votes: dict[str, Counter] = {}
    for s in signals:
        if s.ticker not in ticker_votes:
            ticker_votes[s.ticker] = Counter()
        ticker_votes[s.ticker][s.sentiment] += s.score

    merged: list[TickerSentiment] = []
    for ticker, votes in sorted(ticker_votes.items()):
        winner = votes.most_common(1)[0][0]
        merged.append(TickerSentiment(ticker=ticker, sentiment=winner, score=votes[winner]))
        log.debug(
            "%s: %s (bullish=%d, bearish=%d, neutral=%d)",
            ticker, winner,
            votes.get("bullish", 0), votes.get("bearish", 0), votes.get("neutral", 0),
        )

    return merged


MAX_WORKERS = 10


def _analyze_one(
    model: genai.GenerativeModel,
    post: RedditPost,
    index: int,
    total: int,
    max_retries: int,
    progress_lock: threading.Lock,
    progress: list[int],
) -> list[TickerSentiment]:
    """Analyze a single post with retries. Thread-safe."""
    prompt = _build_prompt(post)
    signals: list[TickerSentiment] = []

    for attempt in range(1, max_retries + 1):
        try:
            response = model.generate_content(prompt)
            items = json.loads(response.text)
            for item in items:
                signals.append(TickerSentiment(
                    ticker=item["ticker"].upper(),
                    sentiment=item["sentiment"],
                    score=post.score,
                ))
            break
        except Exception as exc:
            log.warning("Gemini request failed post %d (attempt %d/%d): %s", index, attempt, max_retries, exc)
            if attempt == max_retries:
                log.error("Skipping post %d after %d failures", index, max_retries)
            else:
                time.sleep(2 ** attempt)

    with progress_lock:
        progress[0] += 1
        if progress[0] % 10 == 0 or progress[0] == total:
            log.info("Sentiment progress: %d/%d posts complete", progress[0], total)

    return signals


def analyze_sentiment(
    posts: list[RedditPost],
    max_retries: int = 3,
    max_workers: int = MAX_WORKERS,
) -> list[TickerSentiment]:
    """Analyze posts in parallel with Gemini, then merge by score-weighted vote."""
    api_key = get_gemini_api_key()
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        "gemini-3.1-flash-lite-preview",
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=RESPONSE_SCHEMA,
        ),
    )

    log.info("Analyzing %d posts with %d workers", len(posts), max_workers)
    all_signals: list[TickerSentiment] = []
    progress_lock = threading.Lock()
    progress = [0]

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                _analyze_one, model, post, i, len(posts), max_retries, progress_lock, progress
            ): i
            for i, post in enumerate(posts, 1)
        }
        for future in as_completed(futures):
            all_signals.extend(future.result())

    log.info("Raw signals: %d across %d posts", len(all_signals), len(posts))
    results = _merge_sentiments(all_signals)
    log.info(
        "Sentiment analysis complete: %d tickers (%d bullish, %d bearish, %d neutral)",
        len(results),
        sum(1 for s in results if s.sentiment == "bullish"),
        sum(1 for s in results if s.sentiment == "bearish"),
        sum(1 for s in results if s.sentiment == "neutral"),
    )
    return results
