#!/usr/bin/env bash
# Dev-server supervisor for the small sandbox: `next dev` can be reaped
# mid-compile (OOM / sandbox cleanup). Turbopack keeps its incremental cache
# in .next, so each restart resumes faster — loop until the server sticks.
cd /home/z/my-project || exit 1
while true; do
  bun run dev >> dev.log 2>&1
  echo "[dev-supervisor] next dev exited ($?) — restarting in 2s $(date +%T)" >> dev.log
  sleep 2
done
