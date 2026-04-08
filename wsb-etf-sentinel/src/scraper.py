import logging
import time
from dataclasses import dataclass

import requests

log = logging.getLogger("pipeline")

ARCTIC_SHIFT_URL = "https://arctic-shift.photon-reddit.com/api/posts/search"
POST_FIELDS = "id,title,selftext,score,created_utc"


@dataclass
class RedditPost:
    title: str
    body: str
    score: int
    post_id: str | None = None
    created_utc: int | None = None


def _post_from_raw(raw: dict) -> RedditPost | None:
    title = raw.get("title", "") or ""
    body = (raw.get("selftext", "") or "").strip()
    if not body or body == "[removed]" or body == "[deleted]":
        return None
    score = int(raw.get("score") or 0)
    created = raw.get("created_utc")
    created_int = int(created) if created is not None else None
    post_id = raw.get("id")
    return RedditPost(
        title=title,
        body=body,
        score=score,
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
    min_score: int = 10,
    max_pages: int = 25,
    max_retries: int = 3,
) -> list[RedditPost]:
    """
    Load up to max_posts_scan posts (paginated, newest-first from the API),
    filter by min_score, sort by Reddit score descending, return the top `limit`.

    Ticker extraction is deferred to the Gemini sentiment step.
    """
    seen_ids: set[str] = set()
    all_posts: list[RedditPost] = []
    before_cursor: str | None = before
    pages = 0

    while len(all_posts) < max_posts_scan and pages < max_pages:
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
            if post is not None and post.score >= min_score:
                all_posts.append(post)

        if new_ids_this_page == 0:
            break

        if oldest_utc is None:
            break
        before_cursor = str(max(0, oldest_utc - 1))

    all_posts.sort(key=lambda p: p.score, reverse=True)
    top = all_posts[:limit]
    log.info(
        "fetch_top_posts_by_score: scanned %d posts across %d pages, returning top %d by score",
        len(all_posts),
        pages,
        len(top),
    )
    return top


def fetch_posts(limit: int = 50, max_retries: int = 3) -> list[RedditPost]:
    """Fetch top posts from r/wallstreetbets by score."""
    return fetch_top_posts_by_score(
        limit=limit,
        max_retries=max_retries,
    )
