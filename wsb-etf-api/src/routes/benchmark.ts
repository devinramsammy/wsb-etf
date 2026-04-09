import { Router, Request, Response, NextFunction } from "express";
import { BenchmarkQuery } from "../types.js";

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(str: string): boolean {
  if (!DATE_RE.test(str)) return false;
  const d = new Date(str + "T00:00:00Z");
  return !Number.isNaN(d.getTime());
}

// Simple in-memory cache (1 hour TTL)
let cache: { data: { date: string; price: number }[]; ts: number } | null =
  null;
const CACHE_TTL = 60 * 60 * 1000;

async function fetchVooData(): Promise<{ date: string; price: number }[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;

  // VOO benchmark series starts at product inception (Dec 29, 2025)
  const period1 = Math.floor(
    new Date("2025-12-29T00:00:00Z").getTime() / 1000,
  );
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/VOO?period1=${period1}&period2=${period2}&interval=1d`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance returned ${res.status}`);
  }

  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error("No chart data from Yahoo Finance");

  const timestamps: number[] = result.timestamp || [];
  const closes: (number | null)[] =
    result.indicators?.adjclose?.[0]?.adjclose ||
    result.indicators?.quote?.[0]?.close || [];

  const points: { date: string; price: number }[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null) continue;
    const d = new Date(timestamps[i] * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    points.push({ date: dateStr, price: Math.round(close * 100) / 100 });
  }

  cache = { data: points, ts: Date.now() };
  return points;
}

router.get(
  "/",
  async (
    req: Request<object, object, object, BenchmarkQuery>,
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

      let data = await fetchVooData();

      if (from) data = data.filter((d) => d.date >= from);
      if (to) data = data.filter((d) => d.date <= to);

      res.json({ data });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
