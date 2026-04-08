import datetime
import logging

import psycopg2
import psycopg2.extras

from src.config import get_database_url
from src.calculator import CompositionEntry, ChangelogEntry

log = logging.getLogger("pipeline")

# Baseline basket and NAV before the first sentiment-driven rebalance.
INITIAL_COMPOSITION_DATE = datetime.date(2025, 12, 29)
INITIAL_COMPOSITION_TICKER = "VOO"
INITIAL_VOO_PRICE = 632.60
INITIAL_ETF_PRICE = 1000.00

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS etf_composition (
    id          SERIAL PRIMARY KEY,
    ticker      VARCHAR(10) NOT NULL,
    percentage  NUMERIC(5,4) NOT NULL,
    shares      NUMERIC(16,6) NOT NULL DEFAULT 0,
    price       NUMERIC(10,2) NOT NULL DEFAULT 0,
    date        DATE NOT NULL,
    UNIQUE (date, ticker)
);

CREATE TABLE IF NOT EXISTS etf_data_points (
    id      SERIAL PRIMARY KEY,
    price   NUMERIC(10,2) NOT NULL,
    date    DATE NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS etf_changelog (
    id      SERIAL PRIMARY KEY,
    action  VARCHAR(10) NOT NULL,
    ticker  VARCHAR(10) NOT NULL,
    weight  NUMERIC(5,4) NOT NULL,
    date    DATE NOT NULL
);
"""


def _connect() -> psycopg2.extensions.connection:
    url = get_database_url()
    conn = psycopg2.connect(url)
    return conn


def ensure_tables() -> None:
    """Create tables if they don't exist."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
        conn.commit()
        log.info("Database tables verified")
    finally:
        conn.close()

    ensure_initial_baseline()


def ensure_initial_baseline() -> None:
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
                "SELECT 1 FROM etf_composition WHERE date = %s LIMIT 1",
                (INITIAL_COMPOSITION_DATE,),
            )
            need_composition = cur.fetchone() is None
            cur.execute(
                "SELECT 1 FROM etf_changelog WHERE date = %s LIMIT 1",
                (INITIAL_COMPOSITION_DATE,),
            )
            need_changelog = cur.fetchone() is None
            cur.execute(
                "SELECT 1 FROM etf_data_points WHERE date = %s LIMIT 1",
                (INITIAL_COMPOSITION_DATE,),
            )
            need_price = cur.fetchone() is None
    finally:
        conn.close()

    if need_composition:
        insert_composition(seed_entries, INITIAL_COMPOSITION_DATE)
        log.info(
            "Seeded initial ETF composition: 100%% %s (%.6f shares @ $%.2f) on %s",
            INITIAL_COMPOSITION_TICKER,
            seed_entries[0].shares,
            INITIAL_VOO_PRICE,
            INITIAL_COMPOSITION_DATE,
        )
    if need_changelog:
        insert_changelog(genesis_changelog, INITIAL_COMPOSITION_DATE)
        log.info(
            "Seeded initial changelog (added %s @ 100%%) on %s",
            INITIAL_COMPOSITION_TICKER,
            INITIAL_COMPOSITION_DATE,
        )
    if need_price:
        insert_etf_price(INITIAL_ETF_PRICE, INITIAL_COMPOSITION_DATE)


def insert_composition(entries: list[CompositionEntry], date: datetime.date) -> None:
    """Insert ETF composition (percentage, shares, price) for a new date."""
    if not entries:
        return

    conn = _connect()
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO etf_composition (ticker, percentage, shares, price, date)
                VALUES %s
                """,
                [
                    (e.ticker, e.percentage, e.shares, e.price, date)
                    for e in entries
                ],
            )
        conn.commit()
        log.info("Inserted %d composition entries for %s", len(entries), date)
    finally:
        conn.close()


def insert_etf_price(price: float, date: datetime.date) -> None:
    """Insert ETF NAV for a new date."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO etf_data_points (price, date) VALUES (%s, %s)",
                (price, date),
            )
        conn.commit()
        log.info("Inserted ETF price $%.2f for %s", price, date)
    finally:
        conn.close()


def insert_changelog(entries: list[ChangelogEntry], date: datetime.date) -> None:
    """Write changelog entries for a new date."""
    if not entries:
        return

    conn = _connect()
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO etf_changelog (action, ticker, weight, date) VALUES %s",
                [(e.action, e.ticker, e.weight, date) for e in entries],
            )
        conn.commit()
        log.info("Inserted %d changelog entries for %s", len(entries), date)
    finally:
        conn.close()


def get_composition(date: datetime.date) -> list[CompositionEntry]:
    """Fetch composition for a given date."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ticker, percentage, shares, price FROM etf_composition WHERE date = %s ORDER BY percentage DESC",
                (date,),
            )
            rows = cur.fetchall()
        return [
            CompositionEntry(ticker=r[0], percentage=float(r[1]), shares=float(r[2]), price=float(r[3]))
            for r in rows
        ]
    finally:
        conn.close()


def get_latest_composition() -> tuple[list[CompositionEntry], datetime.date | None]:
    """Fetch the most recent composition. Returns (entries, date) or ([], None)."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT date FROM etf_composition ORDER BY date DESC LIMIT 1"
            )
            row = cur.fetchone()
            if row is None:
                return [], None
            latest_date = row[0]
        return get_composition(latest_date), latest_date
    finally:
        conn.close()


def get_latest_nav() -> tuple[float | None, datetime.date | None]:
    """Fetch the most recent ETF NAV/price. Returns (price, date) or (None, None)."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT price, date FROM etf_data_points ORDER BY date DESC LIMIT 1"
            )
            row = cur.fetchone()
            if row is None:
                return None, None
            return float(row[0]), row[1]
    finally:
        conn.close()
