#!/usr/bin/env bash
# Focused check: projector disposal GL card in the detail drawer.
set -u
cd /home/z/my-project
AB="agent-browser"
bash scripts/ensure-server.sh >/dev/null 2>&1 || exit 1
$AB set viewport 1440 900 >/dev/null 2>&1
$AB open "http://localhost:3000" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1 || true
sleep 2
BODY=$($AB eval "document.body.innerText" 2>/dev/null)
if echo "$BODY" | rg -qi "enter your email|sign in"; then
  $AB find first "input[type=email]" fill "david@gracechapel.demo" >/dev/null 2>&1
  $AB find first "input[type=password]" fill "grace2026" >/dev/null 2>&1
  $AB find first "button[type=submit]" click >/dev/null 2>&1
  sleep 4
fi
$AB find text "Assets & Facilities" click >/dev/null 2>&1
sleep 3
$AB find text "E2E Test Projector" click >/dev/null 2>&1
sleep 2
BODY=$($AB eval "document.body.innerText" 2>/dev/null)
P=0; F=0
c() { if echo "$2" | rg -q "$3"; then echo "PASS: $1"; P=$((P+1)); else echo "FAIL: $1"; F=$((F+1)); fi; }
c "disposal card present" "$BODY" "Disposal"
c "loss account line" "$BODY" "Loss on Asset Disposal"
c "fixed asset credit line" "$BODY" "Fixed Assets"
c "cash debit line" "$BODY" "Operating Cash"
c "disposal date shown" "$BODY" "Disposed on|Nov 3, 2026"
c "disposal notes shown" "$BODY" "sold below book value|E2E"
$AB screenshot /tmp/verify-asset-disposal.png >/dev/null 2>&1 && echo "screenshot: /tmp/verify-asset-disposal.png"
echo "RESULT: PASS=$P FAIL=$F"
