import json
import logging
import time
from dataclasses import dataclass

import google.generativeai as genai

from src.config import get_gemini_api_key
from src.scraper import RedditPost

log = logging.getLogger("pipeline")

BATCH_SIZE = 10


@dataclass
class TickerSentiment:
    ticker: str
    sentiment: str  # "bullish" | "bearish" | "neutral"


def _build_prompt(posts: list[RedditPost]) -> str:
    """Build a sentiment analysis prompt for a batch of posts."""
    post_texts: list[str] = []
    for i, post in enumerate(posts, 1):
        body_preview = post.body[:500] if post.body else "(no body)"
        post_texts.append(
            f"Post {i} (score: {post.score}, tickers: {', '.join(post.tickers)}):\n"
            f"Title: {post.title}\n"
            f"Body: {body_preview}"
        )

    joined = "\n\n".join(post_texts)

    return (
        "You are a financial sentiment analyst. Analyze the following Reddit posts "
        "from r/wallstreetbets and determine the sentiment for each stock ticker "
        "mentioned.\n\n"
        "For each ticker mentioned across all posts, provide a single overall sentiment: "
        '"bullish", "bearish", or "neutral".\n\n'
        "Respond ONLY with a JSON array of objects, each with keys "
        '"ticker" (string) and "sentiment" (string). '
        "No markdown, no explanation, just the JSON array.\n\n"
        f"Posts:\n\n{joined}"
    )


def _parse_response(text: str) -> list[TickerSentiment]:
    """Parse Gemini response into TickerSentiment objects."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = lines[1:]  # drop opening ```json
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines)

    try:
        items = json.loads(cleaned)
    except json.JSONDecodeError:
        log.error("Failed to parse Gemini response as JSON: %s", cleaned[:200])
        return []

    results: list[TickerSentiment] = []
    for item in items:
        ticker = item.get("ticker", "").upper()
        sentiment = item.get("sentiment", "").lower()
        if ticker and sentiment in ("bullish", "bearish", "neutral"):
            results.append(TickerSentiment(ticker=ticker, sentiment=sentiment))

    return results


def analyze_sentiment(
    posts: list[RedditPost],
    max_retries: int = 3,
) -> list[TickerSentiment]:
    """Send posts to Gemini Flash for sentiment analysis, in batches."""
    api_key = get_gemini_api_key()
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.0-flash")

    all_sentiments: dict[str, TickerSentiment] = {}

    for batch_start in range(0, len(posts), BATCH_SIZE):
        batch = posts[batch_start : batch_start + BATCH_SIZE]
        prompt = _build_prompt(batch)
        batch_num = batch_start // BATCH_SIZE + 1
        total_batches = (len(posts) + BATCH_SIZE - 1) // BATCH_SIZE
        log.info("Analyzing batch %d/%d (%d posts)", batch_num, total_batches, len(batch))

        for attempt in range(1, max_retries + 1):
            try:
                response = model.generate_content(prompt)
                sentiments = _parse_response(response.text)
                for s in sentiments:
                    all_sentiments[s.ticker] = s
                break
            except Exception as exc:
                log.warning("Gemini request failed (attempt %d/%d): %s", attempt, max_retries, exc)
                if attempt == max_retries:
                    log.error("Skipping batch %d after %d failures", batch_num, max_retries)
                else:
                    time.sleep(2 ** attempt)

    results = list(all_sentiments.values())
    log.info(
        "Sentiment analysis complete: %d tickers (%d bullish, %d bearish, %d neutral)",
        len(results),
        sum(1 for s in results if s.sentiment == "bullish"),
        sum(1 for s in results if s.sentiment == "bearish"),
        sum(1 for s in results if s.sentiment == "neutral"),
    )
    return results
