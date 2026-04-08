import { Router, Request, Response, NextFunction } from "express";

const router = Router();

const SYNC_TIMEOUT_MS = Number(process.env.SYNC_TIMEOUT_MS) || 300_000;

function bearerToken(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return undefined;
  return h.slice(7);
}

function requireSyncAuth(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return next();
  const tok = bearerToken(req) ?? (req.headers["x-sync-secret"] as string | undefined);
  if (tok !== secret) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  next();
}

/**
 * POST /api/sync
 * Proxies to the pipeline sync server when PIPELINE_SYNC_URL is set (e.g. http://pipeline:8080/sync).
 * Body JSON: { date?, compareDate?, limit?, after?, before?, maxPostsScan? }
 */
router.post("/", requireSyncAuth, async (req: Request, res: Response, next: NextFunction) => {
  const base = process.env.PIPELINE_SYNC_URL?.replace(/\/$/, "");
  if (!base) {
    res.status(503).json({
      ok: false,
      error:
        "PIPELINE_SYNC_URL is not set. Deploy the pipeline with SYNC_HTTP_PORT and point this URL at it, or run the pipeline CLI locally.",
    });
    return;
  }

  const target = base.endsWith("/sync") ? base : `${base}/sync`;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const secret = process.env.SYNC_SECRET;
    if (secret) {
      headers.Authorization = `Bearer ${secret}`;
    }

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), SYNC_TIMEOUT_MS);

    const upstream = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify(req.body ?? {}),
      signal: ac.signal,
    });
    clearTimeout(t);

    const text = await upstream.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { ok: false, error: "invalid_upstream_json", raw: text.slice(0, 500) };
    }

    res.status(upstream.status).json(payload as object);
  } catch (err) {
    next(err);
  }
});

export default router;
