#!/bin/bash
# Keeps the Next.js dev server alive — respawns it if nothing is LISTENING on :3000.
# (Process-listener check, not HTTP: a cold Turbopack compile can take >30s before
# the first successful response, and an HTTP probe would spawn duplicate servers.)
while true; do
  if ! lsof -ti:3000 > /dev/null 2>&1; then
    cd /home/z/my-project
    echo "[$(date '+%H:%M:%S')] dev server down — restarting" >> /home/z/my-project/watchdog.log
    setsid bun run dev >> /home/z/my-project/dev.log 2>&1 < /dev/null &
  fi
  sleep 5
done
