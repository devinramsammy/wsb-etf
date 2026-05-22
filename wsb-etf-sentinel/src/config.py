import os
import logging

from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("pipeline")


def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    return url


def get_gemini_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set")
    return key


DEFAULT_SUBREDDITS = ("wallstreetbets",)


def get_subreddits() -> list[str]:
    """Configured subreddits for the pipeline (comma-separated SUBREDDITS env var)."""
    raw = os.environ.get("SUBREDDITS")
    if not raw:
        return list(DEFAULT_SUBREDDITS)
    subreddits = [s.strip().lower().removeprefix("r/") for s in raw.split(",") if s.strip()]
    if not subreddits:
        raise RuntimeError("SUBREDDITS is set but contains no valid subreddit names")
    return subreddits
