import { Router, Request, Response, NextFunction } from "express";
import pool from "../db.js";
import { parseSubredditQuery } from "../middleware/subreddit.js";
import { CompositionRow, CompositionQuery } from "../types.js";

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(str: string): boolean {
  if (!DATE_RE.test(str)) return false;
  const d = new Date(str + "T00:00:00Z");
  return !Number.isNaN(d.getTime());
}

router.get(
  "/",
  async (
    req: Request<object, object, object, CompositionQuery>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const subreddit = parseSubredditQuery(req);
      if (typeof subreddit !== "string") {
        return res.status(400).json({ error: subreddit.error });
      }

      const { date } = req.query;

      if (date !== undefined) {
        if (!isValidDate(date)) {
          return res
            .status(400)
            .json({ error: "Invalid date format. Use YYYY-MM-DD." });
        }

        const { rows } = await pool.query<CompositionRow>(
          `SELECT ticker, percentage, shares, price
           FROM etf_composition
           WHERE subreddit = $1 AND date = $2
           ORDER BY percentage DESC`,
          [subreddit, date],
        );

        return res.json({ data: rows });
      }

      const { rows } = await pool.query<CompositionRow>(
        `SELECT ticker, percentage, shares, price
         FROM etf_composition
         WHERE subreddit = $1
           AND date = (
             SELECT MAX(date) FROM etf_composition WHERE subreddit = $1
           )
         ORDER BY percentage DESC`,
        [subreddit],
      );

      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
