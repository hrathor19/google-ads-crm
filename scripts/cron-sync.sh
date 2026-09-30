#!/usr/bin/env bash
#
# Scheduled sync, for cron or a systemd timer.
#
# The source project ran APScheduler inside the FastAPI process: hourly light
# refresh, daily full refresh. This app deliberately does not run a scheduler
# in-process — on a serverless or multi-instance deploy that means N schedulers
# racing each other, all calling the same API with the same credentials. An
# external timer is one scheduler no matter how many web instances there are.
#
# Install (hourly light, daily full at 04:15 UTC to match the source):
#
#   crontab -e
#   15 * * * * /path/to/google-ads-crm/scripts/cron-sync.sh hourly
#   15 4 * * * /path/to/google-ads-crm/scripts/cron-sync.sh daily
#
set -euo pipefail

MODE="${1:-hourly}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${SYNC_LOG_DIR:-$APP_DIR/storage/logs}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/sync-$MODE.log"

case "$MODE" in
  hourly)
    # Light: recent campaign performance only. Two days, because the current
    # day is still accumulating and yesterday can still be restated.
    ARGS=(--entities=campaigns --days=2)
    ;;
  daily)
    # Full: every entity over the rolling window.
    ARGS=(--days="${SYNC_DEFAULT_LOOKBACK_DAYS:-30}")
    ;;
  *)
    echo "usage: $0 [hourly|daily]" >&2
    exit 64
    ;;
esac

# A long sync must not be started twice: a slow run overlapping the next tick
# would double the API load and interleave two replaceWindow passes over the
# same window.
#
# mkdir rather than flock, because flock is absent on macOS and the script has
# to behave the same wherever it runs. mkdir is atomic on every POSIX
# filesystem: it either creates the directory or fails, with no race between
# the check and the create.
LOCK_DIR="/tmp/google-ads-crm-sync-$MODE.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # A stale lock from a killed run would block every future sync silently, so
  # anything older than 6 hours is reclaimed.
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +360 2>/dev/null)" ]; then
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] reclaiming a stale $MODE lock" >> "$LOG"
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null || exit 0
  else
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] a $MODE sync is already running; skipping" >> "$LOG"
    exit 0
  fi
fi
# Release on any exit, including a failure or a signal.
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM


cd "$APP_DIR"


{
  echo "──────────────────────────────────────────────"
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] starting $MODE sync"
  npm run --silent sync -- "${ARGS[@]}"
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $MODE sync finished"
} >> "$LOG" 2>&1
