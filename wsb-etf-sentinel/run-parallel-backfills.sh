#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
THROUGH="${1:-2026-05-21}"
PUB=$(railway run --service wsb-etf-db printenv DATABASE_PUBLIC_URL)

for sub in smallstreetbets stocks stockmarket robinhood; do
  LOG="/tmp/backfill-${sub}.log"
  echo "starting r/$sub -> $LOG"
  nohup railway run --service wsb-etf-sentinel-pipeline \
    env DATABASE_URL="$PUB" .venv/bin/python -m src.backfill \
    --subreddit "$sub" --through "$THROUGH" > "$LOG" 2>&1 &
  echo "  PID=$!"
done
echo "all four backfills launched in parallel"
