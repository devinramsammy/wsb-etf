"""
Optional HTTP server to trigger the pipeline remotely (presync / backfill).

Run: SYNC_HTTP_PORT=8080 python -m src.sync_server

Protect with SYNC_SECRET: clients must send header Authorization: Bearer <secret>
or X-Sync-Secret: <secret> when SYNC_SECRET is set.
"""

import logging
import os

from flask import Flask, jsonify, request

from src.main import RunParams, run, setup_logging

log = logging.getLogger("pipeline")

app = Flask(__name__)


def _check_auth() -> bool:
    secret = os.environ.get("SYNC_SECRET")
    if not secret:
        return True
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer ") and auth[7:] == secret:
        return True
    if request.headers.get("X-Sync-Secret") == secret:
        return True
    return False


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/sync")
def sync():
    if not _check_auth():
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    body = request.get_json(silent=True) or {}

    try:
        from datetime import date

        date_str = body.get("date")
        as_of = date.fromisoformat(date_str) if date_str else None

        compare_str = body.get("compareDate")
        compare_to = date.fromisoformat(compare_str) if compare_str else None

        fetch_limit = int(body.get("limit", 50))
        max_posts_scan = int(body.get("maxPostsScan", 800))
        after = body.get("after")
        before = body.get("before")
        if after is not None and not isinstance(after, str):
            after = str(after)
        if before is not None and not isinstance(before, str):
            before = str(before)
    except (TypeError, ValueError) as exc:
        return jsonify({"ok": False, "error": f"invalid_body: {exc}"}), 400

    if as_of is None:
        from datetime import date as date_cls

        as_of = date_cls.today()

    params = RunParams(
        as_of_date=as_of,
        fetch_limit=fetch_limit,
        after=after,
        before=before,
        max_posts_scan=max_posts_scan,
        compare_to_date=compare_to,
    )

    try:
        result = run(params)
        status = 200 if result.get("ok") else 422
        return jsonify(result), status
    except Exception as exc:
        log.exception("Sync failed")
        return jsonify({"ok": False, "error": str(exc)}), 500


def main() -> None:
    setup_logging()
    port = int(os.environ.get("SYNC_HTTP_PORT", "8080"))
    log.info("Sync HTTP server on port %s", port)
    app.run(host="0.0.0.0", port=port, threaded=False)


if __name__ == "__main__":
    main()
