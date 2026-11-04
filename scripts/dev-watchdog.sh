#!/bin/sh
# dev-watchdog.sh — keeps the Next.js dev server alive in the small sandbox.
#
# PROVEN ROOT CAUSE (kernel OOM log): next-server was OOM-killed twice at
# ~1.75–1.97GB anon-rss on the 4GB pod, leaving the Partner Console (and the
# whole app) dead between agent turns; users saw gateway error pages as
# "The server could not process the sign-in."
#
# This watchdog restarts `bun run dev` automatically ~2s after ANY exit
# (OOM kill, crash, manual kill). Memory ceilings:
#   • JS heap:        NODE_OPTIONS --max-old-space-size=1024 (set below)
#   • Turbopack RSS:  experimental.turbopackMemoryLimit in next.config.ts
#
# Start it fully detached (plain subshell — survives tool/turn boundaries):
#   (scripts/dev-watchdog.sh >/dev/null 2>&1 &)
#
# Idempotent: a second invocation is a no-op while one is already running.

set -u
cd "$(dirname "$0")/.." || exit 1

if pgrep -f "dev-watchdog\.sh" | grep -qv "^$$\$"; then
  echo "[watchdog] already running (pid $(pgrep -f 'dev-watchdog\.sh' | head -1)) — nothing to do"
  exit 0
fi

echo "[watchdog] started (pid $$) at $(date -u '+%Y-%m-%dT%H:%M:%SZ') — supervising: bun run dev" >> dev.log

while :; do
  # package.json's dev script tees output into dev.log itself; discard the
  # duplicate stream here and only append our own lifecycle markers.
  NODE_OPTIONS="--max-old-space-size=1024" bun run dev > /dev/null 2>&1
  code=$?
  echo "[watchdog] dev server exited (code=$code) at $(date -u '+%Y-%m-%dT%H:%M:%SZ') — restarting in 2s" >> dev.log
  sleep 2
done
