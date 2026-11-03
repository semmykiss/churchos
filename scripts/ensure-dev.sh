#!/usr/bin/env bash
# Ensure the Next dev server is up (sandbox reaps background processes
# between tool calls — the Turbopack cache makes each restart ~1-2s).
PORT_OK=$(curl -s -m 2 -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null)
if [ "$PORT_OK" = "200" ]; then exit 0; fi
cd /home/z/my-project || exit 1
setsid nohup bun run dev >> dev.log 2>&1 < /dev/null &
for i in $(seq 1 60); do
  sleep 1
  CODE=$(curl -s -m 2 -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null)
  if [ "$CODE" = "200" ]; then exit 0; fi
done
echo "dev server failed to become ready" >&2
exit 1
