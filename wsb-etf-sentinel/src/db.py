import datetime
import logging

import psycopg2
import psycopg2.extras

from src.config import get_database_url
from src.calculator import CompositionEntry, ChangelogEntry

log = logging.getLogger("pipeline")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS etf_composition (
    id          SERIAL PRIMARY KEY,
    ticker      VARCHAR(10) NOT NULL,
    percentage  NUMERIC(5,4) NOT NULL,
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


def upsert_composition(entries: list[CompositionEntry], date: datetime.date) -> None:
    """Insert or update today's ETF composition."""
    if not entries:
        return

    conn = _connect()
    try:
        with conn.cursor() as cur:
            # Clear any stale entries for today that aren't in the new set
            tickers = [e.ticker for e in entries]
            cur.execute(
                "DELETE FROM etf_composition WHERE date = %s AND ticker != ALL(%s)",
                (date, tickers),
            )

            for entry in entries:
                cur.execute(
                    """
                    INSERT INTO etf_composition (ticker, percentage, date)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (date, ticker)
                    DO UPDATE SET percentage = EXCLUDED.percentage
                    """,
                    (entry.ticker, entry.percentage, date),
                )
        conn.commit()
        log.info("Upserted %d composition entries for %s", len(entries), date)
    finally:
        conn.close()


def upsert_etf_price(price: float, date: datetime.date) -> None:
    """Insert or update today's ETF price."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO etf_data_points (price, date)
                VALUES (%s, %s)
                ON CONFLICT (date)
                DO UPDATE SET price = EXCLUDED.price
                """,
                (price, date),
            )
        conn.commit()
        log.info("Upserted ETF price $%.2f for %s", price, date)
    finally:
        conn.close()


def insert_changelog(entries: list[ChangelogEntry], date: datetime.date) -> None:
    """Write changelog entries for today (replace any existing)."""
    if not entries:
        return

    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM etf_changelog WHERE date = %s", (date,))
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
                "SELECT ticker, percentage FROM etf_composition WHERE date = %s ORDER BY ticker",
                (date,),
            )
            rows = cur.fetchall()
        return [CompositionEntry(ticker=row[0], percentage=float(row[1])) for row in rows]
    finally:
        conn.close()
