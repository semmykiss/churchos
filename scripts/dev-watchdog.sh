#!/bin/sh
# dev-watchdog.sh — the ONLY sanctioned way to run the Next.js dev server in
# this 4GB sandbox. package.json's "dev" script points HERE, so every start
# path (bun run dev / npm run dev / npm run dev:safe) is supervised.
#
# PROVEN ROOT CAUSE (kernel OOM log): next-server was OOM-killed twice at
# ~1.75–1.97GB anon-rss; users then saw gateway error pages as
# "The server could not process the sign-in." Turbopack's native (Rust)
# memory grows outside the JS heap, so --max-old-space-size alone is not
# enough — both ceilings below are required, and this watchdog restarts the
# server ~2s after ANY exit so a kill can never leave the app dead.
#
# Memory ceilings (worst case ≈ 1.0GB heap + 0.75GB Turbopack + ~0.3GB
# runtime baseline + ~0.2GB system ≈ 2.25GB, well under the 4GB pod):
#   • JS heap:        NODE_OPTIONS=--max-old-space-size=1024  (here)
#   • Turbopack RSS:  experimental.turbopackMemoryLimit=786432000 in next.config.ts
#
# Idempotent: a second invocation is a no-op while one is already running.
# Debug escape hatch: `bun run dev:direct` (unsupervised, for experts only).

set -u
cd "$(dirname "$0")/.." || exit 1

if pgrep -f "dev-watchdog\.sh" | grep -qv "^$$\$"; then
  echo "[watchdog] already running (pid $(pgrep -f 'dev-watchdog\.sh' | head -1)) — nothing to do"
  exit 0
fi

echo "[watchdog] started (pid $$) at $(date -u '+%Y-%m-%dT%H:%M:%SZ') — supervising: next dev -p 3000" >> dev.log

while :; do
  # Executed DIRECTLY (not via `bun run dev`) so the loop cannot recurse once
  # package.json's "dev" points at this script. Output appends to dev.log.
  NODE_OPTIONS="--max-old-space-size=1024" ./node_modules/.bin/next dev -p 3000 >> dev.log 2>&1
  code=$?
  echo "[watchdog] dev server exited (code=$code) at $(date -u '+%Y-%m-%dT%H:%M:%SZ') — restarting in 2s" >> dev.log
  sleep 2
done
