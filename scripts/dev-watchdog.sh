#!/bin/bash
# Keeps the Next.js dev server alive — respawns it if the port goes quiet.
while true; do
  if ! curl -s -o /dev/null --max-time 3 http://localhost:3000/; then
    cd /home/z/my-project
    echo "[$(date '+%H:%M:%S')] dev server down — restarting" >> /home/z/my-project/watchdog.log
    setsid bun run dev >> /home/z/my-project/dev.log 2>&1 < /dev/null &
  fi
  sleep 5
done
