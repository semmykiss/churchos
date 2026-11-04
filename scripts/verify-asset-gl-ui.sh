#!/usr/bin/env bash
# Browser E2E verification of asset GL posting UI (single tool-call run).
# Starts the dev server if needed, logs in as david (owner), opens the Assets
# module and verifies the GL states of both test assets.
set -u
cd /home/z/my-project
AB="agent-browser"
PASS=0; FAIL=0
ck() { # ck <label> <haystack> <needle>
  if echo "$2" | rg -q "$3"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1"; FAIL=$((FAIL+1)); fi
}

bash scripts/ensure-server.sh || exit 1

$AB set viewport 1440 900 >/dev/null 2>&1
$AB open "http://localhost:3000" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1 || true
sleep 2

# ── login (only if the login form is showing) ────────────────────────────────
BODY=$($AB eval "document.body.innerText" 2>/dev/null)
if echo "$BODY" | rg -qi "enter your email|sign in"; then
  echo "-- logging in as david (owner) --"
  $AB find first "input[type=email]" fill "david@gracechapel.demo" >/dev/null 2>&1
  $AB find first "input[type=password]" fill "grace2026" >/dev/null 2>&1
  $AB find first "button[type=submit]" click >/dev/null 2>&1
  sleep 4
  $AB wait --load networkidle >/dev/null 2>&1 || true
fi

# ── navigate to the Assets & Facilities module ───────────────────────────────
BODY=$($AB eval "document.body.innerText" 2>/dev/null)
ck "app shell loaded (sidebar shows Assets & Facilities)" "$BODY" "Assets & Facilities"
$AB find text "Assets & Facilities" click >/dev/null 2>&1 || $AB eval "window.dispatchEvent(new CustomEvent('chms:navigate',{detail:'assets'}))" >/dev/null 2>&1
sleep 3
$AB wait --load networkidle >/dev/null 2>&1 || true
BODY=$($AB eval "document.body.innerText" 2>/dev/null)

ck "keyboard asset listed" "$BODY" "Yamaha PSR-S975 Keyboard"
ck "keyboard shows In GL badge" "$BODY" "In GL"
ck "keyboard shows In maintenance status" "$BODY" "In maintenance"
ck "projector listed" "$BODY" "E2E Test Projector"
ck "projector shows Disposed status" "$BODY" "Disposed"
ck "disposal summary shows proceeds/book value" "$BODY" "Sold for|book value"
ck "acquisition cost visible" "$BODY" "850,000"

# ── open the keyboard detail drawer → Accounting (GL) section ────────────────
$AB find text "Yamaha PSR-S975 Keyboard" click >/dev/null 2>&1
sleep 2
BODY=$($AB eval "document.body.innerText" 2>/dev/null)
ck "detail shows Accounting (GL) section" "$BODY" "Accounting \(GL\)"
ck "detail shows Acquisition entry card" "$BODY" "Acquisition"
ck "detail names the fixed-asset account" "$BODY" "Fixed Assets"
ck "detail names Operating Cash" "$BODY" "Operating Cash"
ck "detail shows debit amount 850,000" "$BODY" "850,000"

$AB screenshot /tmp/verify-asset-gl-detail.png >/dev/null 2>&1 && echo "screenshot: /tmp/verify-asset-gl-detail.png"

# close drawer (Escape)
$AB press Escape >/dev/null 2>&1; sleep 1

# ── console errors ───────────────────────────────────────────────────────────
ERRS=$($AB errors 2>/dev/null)
if [ -z "$ERRS" ] || ! echo "$ERRS" | rg -qv "No errors|^\[\]|\[\]"; then
  echo "PASS: no page errors"; PASS=$((PASS+1))
else
  echo "PAGE ERRORS:"; echo "$ERRS" | head -10; FAIL=$((FAIL+1))
fi

echo ""
echo "RESULT: PASS=$PASS FAIL=$FAIL"
