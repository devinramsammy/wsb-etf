import pool from "./db.js";

/** Keep in sync with wsb-etf-sentinel/src/db.py MIGRATION_SQL */
const MIGRATION_STATEMENTS = [
  "ALTER TABLE etf_composition ADD COLUMN IF NOT EXISTS subreddit VARCHAR(50)",
  "UPDATE etf_composition SET subreddit = 'wallstreetbets' WHERE subreddit IS NULL",
  "ALTER TABLE etf_composition ALTER COLUMN subreddit SET DEFAULT 'wallstreetbets'",
  "ALTER TABLE etf_composition ALTER COLUMN subreddit SET NOT NULL",
  "ALTER TABLE etf_data_points ADD COLUMN IF NOT EXISTS subreddit VARCHAR(50)",
  "UPDATE etf_data_points SET subreddit = 'wallstreetbets' WHERE subreddit IS NULL",
  "ALTER TABLE etf_data_points ALTER COLUMN subreddit SET DEFAULT 'wallstreetbets'",
  "ALTER TABLE etf_data_points ALTER COLUMN subreddit SET NOT NULL",
  "ALTER TABLE etf_changelog ADD COLUMN IF NOT EXISTS subreddit VARCHAR(50)",
  "UPDATE etf_changelog SET subreddit = 'wallstreetbets' WHERE subreddit IS NULL",
  "ALTER TABLE etf_changelog ALTER COLUMN subreddit SET DEFAULT 'wallstreetbets'",
  "ALTER TABLE etf_changelog ALTER COLUMN subreddit SET NOT NULL",
  "ALTER TABLE etf_composition DROP CONSTRAINT IF EXISTS etf_composition_date_ticker_key",
  "ALTER TABLE etf_composition DROP CONSTRAINT IF EXISTS etf_composition_subreddit_date_ticker_key",
  `ALTER TABLE etf_composition ADD CONSTRAINT etf_composition_subreddit_date_ticker_key
    UNIQUE (subreddit, date, ticker)`,
  "ALTER TABLE etf_data_points DROP CONSTRAINT IF EXISTS etf_data_points_date_key",
  "ALTER TABLE etf_data_points DROP CONSTRAINT IF EXISTS etf_data_points_subreddit_date_key",
  `ALTER TABLE etf_data_points ADD CONSTRAINT etf_data_points_subreddit_date_key
    UNIQUE (subreddit, date)`,
];

export async function ensureDatabaseMigrated(): Promise<void> {
  for (const sql of MIGRATION_STATEMENTS) {
    await pool.query(sql);
  }
  console.log("Database subreddit migration verified");
}
