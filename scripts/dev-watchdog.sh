#!/bin/bash
# Keeps the Next.js dev server alive — respawns it if nothing is LISTENING on :3000.
# (Process-listener check, not HTTP: a cold Turbopack compile can take >30s before
# the first successful response, and an HTTP probe would spawn duplicate servers.)
# NODE_OPTIONS caps the V8 heap so GC kicks in before the kernel OOM-killer
# starts reaping next-server during cold compiles on small sandboxes.
while true; do
  if ! lsof -ti:3000 > /dev/null 2>&1; then
    cd /home/z/my-project
    echo "[$(date '+%H:%M:%S')] dev server down — restarting" >> /home/z/my-project/watchdog.log
    NODE_OPTIONS="--max-old-space-size=1024" setsid bun run dev >> /home/z/my-project/dev.log 2>&1 < /dev/null &
  fi
  sleep 5
done
