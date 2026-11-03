#!/usr/bin/env bash
# Ensure the Next.js dev server is reachable; start it if not.
# Usage: source or execute before test steps. Waits up to ~60s.
BASE="http://localhost:3000"
if curl -s -o /dev/null --max-time 3 "$BASE/" 2>/dev/null; then
  echo "server: already up"
  exit 0
fi
cd /home/z/my-project || exit 1
setsid nohup bun run dev < /dev/null > /dev/null 2>&1 &
echo "server: starting..."
for i in $(seq 1 30); do
  sleep 2
  if curl -s -o /dev/null --max-time 3 "$BASE/" 2>/dev/null; then
    echo "server: ready after ~$((i*2))s"
    exit 0
  fi
done
echo "server: FAILED to start"
exit 1
