import { Router, Request, Response, NextFunction } from "express";
import pool from "../db.js";
import { PriceRow, PriceHistoryQuery } from "../types.js";

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
    req: Request<object, object, object, PriceHistoryQuery>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { from, to } = req.query;

      if (from !== undefined && !isValidDate(from)) {
        return res
          .status(400)
          .json({ error: "Invalid 'from' date format. Use YYYY-MM-DD." });
      }
      if (to !== undefined && !isValidDate(to)) {
        return res
          .status(400)
          .json({ error: "Invalid 'to' date format. Use YYYY-MM-DD." });
      }

      const conditions: string[] = [];
      const params: string[] = [];

      if (from) {
        params.push(from);
        conditions.push(`date >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        conditions.push(`date <= $${params.length}`);
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      const { rows } = await pool.query<PriceRow>(
        `SELECT price, date FROM etf_data_points ${where} ORDER BY date ASC`,
        params,
      );

      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
