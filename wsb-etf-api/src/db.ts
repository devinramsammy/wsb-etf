import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  min: 2,
  max: 10,
  ssl: process.env.DATABASE_URL?.includes("railway")
    ? { rejectUnauthorized: false }
    : false,
});

export default pool;
