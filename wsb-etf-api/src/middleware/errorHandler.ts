import { Request, Response, NextFunction } from "express";
import { HttpError } from "../types.js";

export default function errorHandler(
  err: HttpError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error(err.stack || err);

  const status = err.status ?? 500;
  const message =
    status === 500 ? "Internal server error" : err.message ?? "Unknown error";

  res.status(status).json({ error: message });
}
