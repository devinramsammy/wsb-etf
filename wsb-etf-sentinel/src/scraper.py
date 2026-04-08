import re
import logging
import time
from dataclasses import dataclass

import requests

log = logging.getLogger("pipeline")

ARCTIC_SHIFT_URL = "https://arctic-shift.photon-reddit.com/api/posts/search"
# Arctic Shift caps a single request at 100; use fields to keep payloads small
POST_FIELDS = "id,title,selftext,score,created_utc"

# Common words that look like tickers but aren't
TICKER_BLACKLIST = {
    "A", "I", "AM", "AN", "AS", "AT", "BE", "BY", "DO", "GO", "IF", "IN",
    "IS", "IT", "ME", "MY", "NO", "OF", "OK", "ON", "OR", "SO", "TO", "UP",
    "US", "WE", "CEO", "CFO", "CTO", "COO", "DD", "EPS", "ETF", "FDA",
    "FOMO", "FUD", "GDP", "IMO", "IPO", "LOL", "LMAO", "NYSE", "OP",
    "OTC", "PE", "PM", "SEC", "TL", "DR", "TLDR", "WSB", "YOY", "ATH",
    "ALL", "ARE", "THE", "FOR", "AND", "NOT", "YOU", "HAS", "HAD", "HIS",
    "HER", "CAN", "DID", "BUT", "WAS", "NEW", "NOW", "OLD", "OUR", "OUT",
    "OWN", "SAY", "SHE", "TOO", "USE", "WAY", "WHO", "DAY", "GET", "GOT",
    "HIT", "HOW", "ITS", "LET", "MAY", "PUT", "RUN", "SAW", "SET", "TOP",
    "TRY", "TWO", "WON", "YET", "BIG", "FAR", "FEW", "LOW", "ANY", "END",
    "ONE", "CALL", "HOLD", "LONG", "LOSS", "MUCH", "OVER", "REAL", "RISK",
    "SELL", "VERY", "WHEN", "WITH", "YOLO", "EDIT", "JUST", "LIKE", "MAKE",
    "ONLY", "SOME", "THAN", "THEM", "THEN", "THEY", "THIS", "WANT", "WERE",
    "WHAT", "WILL", "YOUR", "BEEN", "ALSO", "BACK", "BEST", "BOTH", "COME",
    "DOWN", "EVEN", "FEEL", "FIND", "FROM", "FULL", "GOOD", "HAVE", "HERE",
    "HIGH", "INTO", "KEEP", "KNOW", "LAST", "LOOK", "LOTS", "MOVE", "NEED",
    "NEXT", "ONCE", "PART", "PLAY", "SAME", "SURE", "TAKE", "THAT", "WEEK",
    "WORK", "YEAR", "ZERO", "BULL", "BEAR", "PUMP", "DUMP", "GAIN", "BANG",
    "CASH", "DEBT", "FREE", "HUGE", "MOON", "SAFE", "TANK", "WASH", "PAYS",
    "PAYS", "LIVE", "MORE", "MOST", "MANY", "EVER", "EACH", "HALF", "HOPE",
    "HARD", "EASY", "FAST", "DONE", "GOES",
}

# Match $TICKER or standalone uppercase 1-5 letter words
TICKER_PATTERN = re.compile(r"\$([A-Z]{1,5})\b|(?<![a-zA-Z])([A-Z]{1,5})(?![a-zA-Z])")


@dataclass
class RedditPost:
    title: str
    body: str
    score: int
    tickers: list[str]
    post_id: str | None = None
    created_utc: int | None = None


def _extract_tickers(text: str) -> list[str]:
    """Extract stock ticker symbols from text."""
    matches = TICKER_PATTERN.findall(text)
    tickers: set[str] = set()
    for dollar_match, bare_match in matches:
        symbol = dollar_match or bare_match
        if symbol and symbol not in TICKER_BLACKLIST:
            tickers.add(symbol)
    return sorted(tickers)


def _post_from_raw(raw: dict) -> RedditPost | None:
    title = raw.get("title", "") or ""
    body = raw.get("selftext", "") or ""
    score = int(raw.get("score") or 0)
    created = raw.get("created_utc")
    created_int = int(created) if created is not None else None
    post_id = raw.get("id")
    combined_text = f"{title} {body}"
    tickers = _extract_tickers(combined_text)
    if not tickers:
        return None
    return RedditPost(
        title=title,
        body=body,
        score=score,
        tickers=tickers,
        post_id=str(post_id) if post_id else None,
        created_utc=created_int,
    )


def _search_request(
    params: dict,
    max_retries: int = 3,
) -> list[dict]:
    for attempt in range(1, max_retries + 1):
        try:
            log.info("Arctic Shift request (attempt %d/%d) params=%s", attempt, max_retries, params)
            resp = requests.get(ARCTIC_SHIFT_URL, params=params, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            break
        except requests.RequestException as exc:
            log.warning("Arctic Shift request failed: %s", exc)
            if attempt == max_retries:
                raise RuntimeError(f"Failed to fetch posts after {max_retries} attempts") from exc
            time.sleep(2**attempt)

    if data.get("error"):
        raise RuntimeError(f"Arctic Shift API error: {data.get('error')}")

    return data.get("data") or []


def fetch_top_posts_by_score(
    limit: int = 50,
    *,
    subreddit: str = "wallstreetbets",
    after: str | None = None,
    before: str | None = None,
    max_posts_scan: int = 800,
    max_pages: int = 25,
    max_retries: int = 3,
) -> list[RedditPost]:
    """
    Load up to max_posts_scan posts (paginated, newest-first from the API),
    keep those with ticker mentions, sort by Reddit score descending, return the top `limit`.

    Use `after` / `before` for a time window (Arctic Shift accepts values like ``1year`` or ISO dates).
    """
    seen_ids: set[str] = set()
    with_tickers: list[RedditPost] = []
    before_cursor: str | None = before
    pages = 0

    while len(with_tickers) < max_posts_scan and pages < max_pages:
        params: dict = {
            "subreddit": subreddit,
            "limit": 100,
            "sort": "desc",
            "fields": POST_FIELDS,
        }
        if after:
            params["after"] = after
        if before_cursor:
            params["before"] = before_cursor

        raw_posts = _search_request(params, max_retries=max_retries)
        if not raw_posts:
            break

        pages += 1
        oldest_utc: int | None = None
        new_ids_this_page = 0
        for raw in raw_posts:
            c_utc = raw.get("created_utc")
            if c_utc is not None:
                cu = int(c_utc)
                oldest_utc = cu if oldest_utc is None else min(oldest_utc, cu)

            pid = raw.get("id")
            pid_s = str(pid) if pid else None
            if pid_s and pid_s in seen_ids:
                continue
            new_ids_this_page += 1
            if pid_s:
                seen_ids.add(pid_s)

            post = _post_from_raw(raw)
            if post:
                with_tickers.append(post)

        if new_ids_this_page == 0:
            break

        if oldest_utc is None:
            break
        # Next page: posts strictly older than the oldest item in this batch
        before_cursor = str(max(0, oldest_utc - 1))

    with_tickers.sort(key=lambda p: p.score, reverse=True)
    top = with_tickers[:limit]
    log.info(
        "fetch_top_posts_by_score: scanned ~%d posts w/ tickers across %d pages, returning top %d by score",
        len(with_tickers),
        pages,
        len(top),
    )
    return top


def fetch_posts(limit: int = 50, max_retries: int = 3) -> list[RedditPost]:
    """Fetch top posts from r/wallstreetbets (by score among a broad recent scrape)."""
    return fetch_top_posts_by_score(
        limit=limit,
        max_retries=max_retries,
    )
