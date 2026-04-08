import { Router, Request, Response, NextFunction } from "express";
import pool from "../db.js";
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
      const { date } = req.query;

      if (date !== undefined) {
        if (!isValidDate(date)) {
          return res
            .status(400)
            .json({ error: "Invalid date format. Use YYYY-MM-DD." });
        }

        const { rows } = await pool.query<CompositionRow>(
          "SELECT ticker, percentage FROM etf_composition WHERE date = $1 ORDER BY percentage DESC",
          [date],
        );

        return res.json({ data: rows });
      }

      // No date param — return latest day's composition
      const { rows } = await pool.query<CompositionRow>(
        `SELECT ticker, percentage
       FROM etf_composition
       WHERE date = (SELECT MAX(date) FROM etf_composition)
       ORDER BY percentage DESC`,
      );

      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
