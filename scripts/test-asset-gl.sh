#!/usr/bin/env bash
# E2E API test: asset GL posting — gain-on-disposal, write-off, RBAC negative.
# Uses EXISTING users only (david=owner, marcus=volunteer). No new users.
set -u
BASE="http://localhost:3000/api/v1"
JAR_D=/tmp/gl-test-david.txt
JAR_M=/tmp/gl-test-marcus.txt
rm -f "$JAR_D" "$JAR_M"

say() { echo -e "\n=== $* ==="; }

say "1) login david (owner)"
code=$(curl -s -o /tmp/login-d.json -w "%{http_code}" -c "$JAR_D" -H 'Content-Type: application/json' \
  -d '{"email":"david@gracechapel.demo","password":"grace2026"}' "$BASE/auth/login")
echo "login http=$code"

say "2) create GAIN test asset (equipment, cost 100000 NGN = 10000000 kobo)"
code=$(curl -s -o /tmp/a1.json -w "%{http_code}" -b "$JAR_D" -H 'Content-Type: application/json' \
  -d '{"name":"GL Gain Path Test Bench","category":"equipment","purchaseCostCents":10000000,"currentValueCents":10000000,"acquiredAt":"2026-11-01","notes":"temp test asset — safe to delete"}' \
  "$BASE/assets")
echo "create http=$code"
A1=$(bun -e 'const j=await Bun.file("/tmp/a1.json").json();console.log(j.data?.id ?? j.id ?? "")' 2>/dev/null)
echo "asset1=$A1"

say "3) post acquisition for GAIN asset"
code=$(curl -s -o /tmp/pa1.json -w "%{http_code}" -b "$JAR_D" -H 'Content-Type: application/json' -d '{}' "$BASE/assets/$A1/post-acquisition")
echo "post-acquisition http=$code"; cat /tmp/pa1.json; echo

say "4) dispose GAIN asset with proceeds 125000 NGN (expect gain 25000 -> Cr 4600)"
code=$(curl -s -o /tmp/dp1.json -w "%{http_code}" -b "$JAR_D" -H 'Content-Type: application/json' \
  -d '{"disposalDate":"2026-11-04","proceedsCents":12500000,"notes":"sold above book value"}' \
  "$BASE/assets/$A1/dispose")
echo "dispose http=$code"; cat /tmp/dp1.json; echo

say "5) create WRITEOFF test asset (furniture, cost 50000 NGN)"
code=$(curl -s -o /tmp/a2.json -w "%{http_code}" -b "$JAR_D" -H 'Content-Type: application/json' \
  -d '{"name":"GL Writeoff Test Chair","category":"furniture","purchaseCostCents":5000000,"currentValueCents":5000000,"acquiredAt":"2026-11-01","notes":"temp test asset — safe to delete"}' \
  "$BASE/assets")
echo "create http=$code"
A2=$(bun -e 'const j=await Bun.file("/tmp/a2.json").json();console.log(j.data?.id ?? j.id ?? "")' 2>/dev/null)
echo "asset2=$A2"

say "6) post acquisition for WRITEOFF asset"
code=$(curl -s -o /tmp/pa2.json -w "%{http_code}" -b "$JAR_D" -H 'Content-Type: application/json' -d '{}' "$BASE/assets/$A2/post-acquisition")
echo "post-acquisition http=$code"; cat /tmp/pa2.json; echo

say "7) dispose WRITEOFF asset proceeds 0 (expect Dr 5900 / Cr 1510, no cash line)"
code=$(curl -s -o /tmp/dp2.json -w "%{http_code}" -b "$JAR_D" -H 'Content-Type: application/json' \
  -d '{"disposalDate":"2026-11-04","proceedsCents":0,"notes":"scrapped — no salvage value"}' \
  "$BASE/assets/$A2/dispose")
echo "dispose http=$code"; cat /tmp/dp2.json; echo

say "8) RBAC negative: login marcus (volunteer) and attempt post-acquisition"
code=$(curl -s -o /tmp/login-m.json -w "%{http_code}" -c "$JAR_M" -H 'Content-Type: application/json' \
  -d '{"email":"marcus@gracechapel.demo","password":"grace2026"}' "$BASE/auth/login")
echo "login http=$code"
code=$(curl -s -o /tmp/rbac.json -w "%{http_code}" -b "$JAR_M" -H 'Content-Type: application/json' -d '{}' "$BASE/assets/$A1/post-acquisition")
echo "marcus post-acquisition http=$code (expect 403)"; cat /tmp/rbac.json; echo

say "9) idempotency: re-post acquisition on disposed asset (expect 409 conflict)"
code=$(curl -s -o /tmp/idem.json -w "%{http_code}" -b "$JAR_D" -H 'Content-Type: application/json' -d '{}' "$BASE/assets/$A2/post-acquisition")
echo "repost http=$code (expect 409 since disposed)"; cat /tmp/idem.json; echo

echo "A1=$A1"
echo "A2=$A2"
