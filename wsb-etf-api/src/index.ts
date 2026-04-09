import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import morgan from "morgan";

import pool from "./db.js";
import compositionRouter from "./routes/composition.js";
import priceHistoryRouter from "./routes/priceHistory.js";
import changelogRouter from "./routes/changelog.js";
import benchmarkRouter from "./routes/benchmark.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(cors());
app.use(express.json());

// --- Routes ---
app.get("/api/health", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    next(err);
  }
});

app.use("/api/composition", compositionRouter);
app.use("/api/price-history", priceHistoryRouter);
app.use("/api/changelog", changelogRouter);
app.use("/api/benchmark", benchmarkRouter);

// --- Error handling ---
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
