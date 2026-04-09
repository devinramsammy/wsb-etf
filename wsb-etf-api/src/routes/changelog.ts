import { Router, Request, Response, NextFunction } from "express";
import pool from "../db.js";
import { ChangelogRow, ChangelogQuery, ChangelogMeta } from "../types.js";

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(str: string): boolean {
  if (!DATE_RE.test(str)) return false;
  const d = new Date(str + "T00:00:00Z");
  return !Number.isNaN(d.getTime());
}

router.get(
  "/meta",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [countRow, datesRows] = await Promise.all([
        pool.query<{ n: string; last: string | null }>(
          "SELECT COUNT(*)::text AS n, MAX(date)::text AS last FROM etf_changelog",
        ),
        pool.query<{ date: string }>(
          "SELECT DISTINCT date::text AS date FROM etf_changelog ORDER BY date DESC",
        ),
      ]);

      const totalEntries = Number.parseInt(countRow.rows[0]?.n ?? "0", 10);
      const lastRebalanceDate = countRow.rows[0]?.last ?? null;
      const dates = datesRows.rows.map((r) => r.date);

      const payload: ChangelogMeta = {
        dates,
        totalEntries,
        lastRebalanceDate,
      };

      res.json({ data: payload });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/",
  async (
    req: Request<object, object, object, ChangelogQuery>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { date } = req.query;

      if (date !== undefined) {
        if (!isValidDate(date)) {
          return res
            .status(400)
            .json({ error: "Invalid date format. Use YYYY-MM-DD." });
        }

        const { rows } = await pool.query<ChangelogRow>(
          "SELECT action, ticker, weight, date FROM etf_changelog WHERE date = $1 ORDER BY id DESC",
          [date],
        );

        return res.json({ data: rows });
      }

      const { rows } = await pool.query<ChangelogRow>(
        "SELECT action, ticker, weight, date FROM etf_changelog ORDER BY date DESC, id DESC",
      );

      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
