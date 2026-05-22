import datetime
import logging

import psycopg2
import psycopg2.extras

from src.config import get_database_url, get_subreddits
from src.calculator import CompositionEntry, ChangelogEntry

log = logging.getLogger("pipeline")

# Baseline basket and NAV before the first sentiment-driven rebalance.
INITIAL_COMPOSITION_DATE = datetime.date(2025, 12, 29)
INITIAL_COMPOSITION_TICKER = "VOO"
INITIAL_VOO_PRICE = 630.61
INITIAL_ETF_PRICE = 1000.00
DEFAULT_SUBREDDIT = "wallstreetbets"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS etf_composition (
    id          SERIAL PRIMARY KEY,
    subreddit   VARCHAR(50) NOT NULL DEFAULT 'wallstreetbets',
    ticker      VARCHAR(10) NOT NULL,
    percentage  NUMERIC(5,4) NOT NULL,
    shares      NUMERIC(16,6) NOT NULL DEFAULT 0,
    price       NUMERIC(10,2) NOT NULL DEFAULT 0,
    date        DATE NOT NULL,
    UNIQUE (subreddit, date, ticker)
);

CREATE TABLE IF NOT EXISTS etf_data_points (
    id          SERIAL PRIMARY KEY,
    subreddit   VARCHAR(50) NOT NULL DEFAULT 'wallstreetbets',
    price       NUMERIC(10,2) NOT NULL,
    date        DATE NOT NULL,
    UNIQUE (subreddit, date)
);

CREATE TABLE IF NOT EXISTS etf_changelog (
    id          SERIAL PRIMARY KEY,
    subreddit   VARCHAR(50) NOT NULL DEFAULT 'wallstreetbets',
    action      VARCHAR(10) NOT NULL,
    ticker      VARCHAR(10) NOT NULL,
    weight      NUMERIC(5,4) NOT NULL,
    date        DATE NOT NULL
);
"""

MIGRATION_SQL = """
ALTER TABLE etf_composition ADD COLUMN IF NOT EXISTS subreddit VARCHAR(50);
UPDATE etf_composition SET subreddit = 'wallstreetbets' WHERE subreddit IS NULL;
ALTER TABLE etf_composition ALTER COLUMN subreddit SET DEFAULT 'wallstreetbets';
ALTER TABLE etf_composition ALTER COLUMN subreddit SET NOT NULL;

ALTER TABLE etf_data_points ADD COLUMN IF NOT EXISTS subreddit VARCHAR(50);
UPDATE etf_data_points SET subreddit = 'wallstreetbets' WHERE subreddit IS NULL;
ALTER TABLE etf_data_points ALTER COLUMN subreddit SET DEFAULT 'wallstreetbets';
ALTER TABLE etf_data_points ALTER COLUMN subreddit SET NOT NULL;

ALTER TABLE etf_changelog ADD COLUMN IF NOT EXISTS subreddit VARCHAR(50);
UPDATE etf_changelog SET subreddit = 'wallstreetbets' WHERE subreddit IS NULL;
ALTER TABLE etf_changelog ALTER COLUMN subreddit SET DEFAULT 'wallstreetbets';
ALTER TABLE etf_changelog ALTER COLUMN subreddit SET NOT NULL;

ALTER TABLE etf_composition DROP CONSTRAINT IF EXISTS etf_composition_date_ticker_key;
ALTER TABLE etf_composition DROP CONSTRAINT IF EXISTS etf_composition_subreddit_date_ticker_key;
ALTER TABLE etf_composition ADD CONSTRAINT etf_composition_subreddit_date_ticker_key
    UNIQUE (subreddit, date, ticker);

ALTER TABLE etf_data_points DROP CONSTRAINT IF EXISTS etf_data_points_date_key;
ALTER TABLE etf_data_points DROP CONSTRAINT IF EXISTS etf_data_points_subreddit_date_key;
ALTER TABLE etf_data_points ADD CONSTRAINT etf_data_points_subreddit_date_key
    UNIQUE (subreddit, date);
"""


def _connect() -> psycopg2.extensions.connection:
    url = get_database_url()
    conn = psycopg2.connect(url)
    return conn


def ensure_tables() -> None:
    """Create tables if they don't exist and apply subreddit migrations."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
            cur.execute(MIGRATION_SQL)
        conn.commit()
        log.info("Database tables verified")
    finally:
        conn.close()

    for subreddit in get_subreddits():
        ensure_initial_baseline(subreddit)


def ensure_initial_baseline(subreddit: str = DEFAULT_SUBREDDIT) -> None:
    """
    If missing, insert the starting composition (100% INITIAL_COMPOSITION_TICKER),
    matching changelog row (added, full weight), and ETF price on INITIAL_COMPOSITION_DATE.
    """
    seed_entries = [
        CompositionEntry(
            ticker=INITIAL_COMPOSITION_TICKER,
            percentage=1.0,
            shares=round(INITIAL_ETF_PRICE / INITIAL_VOO_PRICE, 6),
            price=INITIAL_VOO_PRICE,
        ),
    ]
    genesis_changelog = [
        ChangelogEntry(
            action="added",
            ticker=INITIAL_COMPOSITION_TICKER,
            weight=1.0,
        ),
    ]

    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM etf_composition WHERE subreddit = %s AND date = %s LIMIT 1",
                (subreddit, INITIAL_COMPOSITION_DATE),
            )
            need_composition = cur.fetchone() is None
            cur.execute(
                "SELECT 1 FROM etf_changelog WHERE subreddit = %s AND date = %s LIMIT 1",
                (subreddit, INITIAL_COMPOSITION_DATE),
            )
            need_changelog = cur.fetchone() is None
            cur.execute(
                "SELECT 1 FROM etf_data_points WHERE subreddit = %s AND date = %s LIMIT 1",
                (subreddit, INITIAL_COMPOSITION_DATE),
            )
            need_price = cur.fetchone() is None
    finally:
        conn.close()

    if need_composition:
        insert_composition(seed_entries, INITIAL_COMPOSITION_DATE, subreddit)
        log.info(
            "Seeded initial ETF composition for r/%s: 100%% %s (%.6f shares @ $%.2f) on %s",
            subreddit,
            INITIAL_COMPOSITION_TICKER,
            seed_entries[0].shares,
            INITIAL_VOO_PRICE,
            INITIAL_COMPOSITION_DATE,
        )
    if need_changelog:
        insert_changelog(genesis_changelog, INITIAL_COMPOSITION_DATE, subreddit)
        log.info(
            "Seeded initial changelog for r/%s (added %s @ 100%%) on %s",
            subreddit,
            INITIAL_COMPOSITION_TICKER,
            INITIAL_COMPOSITION_DATE,
        )
    if need_price:
        upsert_etf_price(INITIAL_ETF_PRICE, INITIAL_COMPOSITION_DATE, subreddit)


def insert_composition(
    entries: list[CompositionEntry],
    date: datetime.date,
    subreddit: str = DEFAULT_SUBREDDIT,
) -> None:
    """Insert ETF composition (percentage, shares, price) for a new date."""
    if not entries:
        return

    conn = _connect()
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO etf_composition (subreddit, ticker, percentage, shares, price, date)
                VALUES %s
                """,
                [
                    (subreddit, e.ticker, e.percentage, e.shares, e.price, date)
                    for e in entries
                ],
            )
        conn.commit()
        log.info("Inserted %d composition entries for r/%s on %s", len(entries), subreddit, date)
    finally:
        conn.close()


def insert_etf_price(
    price: float,
    date: datetime.date,
    subreddit: str = DEFAULT_SUBREDDIT,
) -> None:
    """Insert ETF NAV for a new date."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO etf_data_points (subreddit, price, date) VALUES (%s, %s, %s)",
                (subreddit, price, date),
            )
        conn.commit()
        log.info("Inserted ETF price $%.2f for r/%s on %s", price, subreddit, date)
    finally:
        conn.close()


def insert_changelog(
    entries: list[ChangelogEntry],
    date: datetime.date,
    subreddit: str = DEFAULT_SUBREDDIT,
) -> None:
    """Write changelog entries for a new date."""
    if not entries:
        return

    conn = _connect()
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO etf_changelog (subreddit, action, ticker, weight, date) VALUES %s",
                [(subreddit, e.action, e.ticker, e.weight, date) for e in entries],
            )
        conn.commit()
        log.info("Inserted %d changelog entries for r/%s on %s", len(entries), subreddit, date)
    finally:
        conn.close()


def get_composition(
    date: datetime.date,
    subreddit: str = DEFAULT_SUBREDDIT,
) -> list[CompositionEntry]:
    """Fetch composition for a given date."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ticker, percentage, shares, price
                FROM etf_composition
                WHERE subreddit = %s AND date = %s
                ORDER BY percentage DESC
                """,
                (subreddit, date),
            )
            rows = cur.fetchall()
        return [
            CompositionEntry(ticker=r[0], percentage=float(r[1]), shares=float(r[2]), price=float(r[3]))
            for r in rows
        ]
    finally:
        conn.close()


def get_latest_composition(
    subreddit: str = DEFAULT_SUBREDDIT,
) -> tuple[list[CompositionEntry], datetime.date | None]:
    """Fetch the most recent composition. Returns (entries, date) or ([], None)."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT date FROM etf_composition
                WHERE subreddit = %s
                ORDER BY date DESC LIMIT 1
                """,
                (subreddit,),
            )
            row = cur.fetchone()
            if row is None:
                return [], None
            latest_date = row[0]
        return get_composition(latest_date, subreddit), latest_date
    finally:
        conn.close()


def get_latest_nav(
    subreddit: str = DEFAULT_SUBREDDIT,
) -> tuple[float | None, datetime.date | None]:
    """Fetch the most recent ETF NAV/price. Returns (price, date) or (None, None)."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT price, date FROM etf_data_points
                WHERE subreddit = %s
                ORDER BY date DESC LIMIT 1
                """,
                (subreddit,),
            )
            row = cur.fetchone()
            if row is None:
                return None, None
            return float(row[0]), row[1]
    finally:
        conn.close()


def get_composition_at_or_before(
    date: datetime.date,
    subreddit: str = DEFAULT_SUBREDDIT,
) -> tuple[list[CompositionEntry], datetime.date | None]:
    """Fetch the composition that was active on or before `date`."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT date FROM etf_composition
                WHERE subreddit = %s AND date <= %s
                ORDER BY date DESC LIMIT 1
                """,
                (subreddit, date),
            )
            row = cur.fetchone()
            if row is None:
                return [], None
            comp_date = row[0]
        return get_composition(comp_date, subreddit), comp_date
    finally:
        conn.close()


def upsert_etf_price(
    price: float,
    date: datetime.date,
    subreddit: str = DEFAULT_SUBREDDIT,
) -> None:
    """Insert or update ETF NAV for a date."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO etf_data_points (subreddit, price, date) VALUES (%s, %s, %s)
                ON CONFLICT (subreddit, date) DO UPDATE SET price = EXCLUDED.price
                """,
                (subreddit, price, date),
            )
        conn.commit()
        log.info("Upserted ETF price $%.2f for r/%s on %s", price, subreddit, date)
    finally:
        conn.close()


def get_distinct_changelog_dates(subreddit: str = DEFAULT_SUBREDDIT) -> list[datetime.date]:
    """Distinct rebalance dates for a subreddit, oldest first."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT date FROM etf_changelog
                WHERE subreddit = %s
                ORDER BY date ASC
                """,
                (subreddit,),
            )
            return [row[0] for row in cur.fetchall()]
    finally:
        conn.close()


def get_distinct_nav_dates(
    subreddit: str = DEFAULT_SUBREDDIT,
    through: datetime.date | None = None,
) -> list[datetime.date]:
    """Distinct NAV dates for a subreddit, oldest first."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            if through is None:
                cur.execute(
                    """
                    SELECT DISTINCT date FROM etf_data_points
                    WHERE subreddit = %s
                    ORDER BY date ASC
                    """,
                    (subreddit,),
                )
            else:
                cur.execute(
                    """
                    SELECT DISTINCT date FROM etf_data_points
                    WHERE subreddit = %s AND date <= %s
                    ORDER BY date ASC
                    """,
                    (subreddit, through),
                )
            return [row[0] for row in cur.fetchall()]
    finally:
        conn.close()


def composition_exists(subreddit: str, date: datetime.date) -> bool:
    """True if a composition row exists for this subreddit and date."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1 FROM etf_composition
                WHERE subreddit = %s AND date = %s
                LIMIT 1
                """,
                (subreddit, date),
            )
            return cur.fetchone() is not None
    finally:
        conn.close()
