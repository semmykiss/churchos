# Task 12-a — Giving module simplification + usher count-sheet fixes

Agent: giving-simplifier · Date: session 12-a · Files touched: ONLY the two assigned files.

## Files changed

### 1) `src/components/app/modules/giving-module.tsx` (1871 → 1574 lines)

**Tabs (staff view) — now FOUR: `gifts | collections | funds | statements`**

- Removed the separate `batches` TabsTrigger + TabsContent.
- `collections` TabsContent now stacks BOTH areas with a `space-y-8` gap, each under a `Section` heading:
  - `<Section title="Service batches"><BatchesTab perms={perms} /></Section>` (BatchesTab untouched / kept as-is)
  - `<Section title="Usher count sheets"><UsherCollections user={user} /></Section>`
- Funds tab trigger label changed `Funds & Pledges` → `Funds`. Section banner comment updated.
- Member-only routing (My Giving / Service Collections for usher-only members) untouched.

**Funds tab (`FundsPledgesTab`) — funds cards + NewFundDialog only**

- Removed from the staff module: Pledges table + its `Section`, Recurring gifts table + its `Section`,
  `NewPledgeDialog` render + component, `CancelRecurringButton` component.
- Deleted dead code: `PledgeDTO`, `RecurringGiftDTO`, `PLEDGE_FREQ_LABELS`, `RECUR_FREQ_LABELS`,
  `pledgesQ`/`recurringQ`/`pledgeOpen` state, unused lucide imports `BookOpenCheck`, `Repeat`.
- `MyGivingPortal` (member pledges/recurring) NOT touched. GiftsTab + StatementsTab untouched.
- API calls, `useGivingPermissions` usage, KPI logic untouched. File-top doc comment updated to the new tab list.

### 2) `src/components/app/giving/UsherCollections.tsx` (815 → 841 lines)

**SheetFormDialog layout (fields/logic unchanged, layout only)**

- `DialogContent`: `max-w-[calc(100%-2rem)] sm:max-w-4xl max-h-[92vh] gap-5 overflow-y-auto` →
  `sm:max-w-3xl w-[95vw]` (mobile stays viewport-safe via the component's built-in `max-w-[calc(100%-2rem)]`).
- Body wrapped in `max-h-[80vh] space-y-6 overflow-y-auto scroll-slim pr-1` (header/footer pinned, body scrolls).
- Clear section headings: **Service details** (date + service in `grid gap-4 sm:grid-cols-2`),
  **Collection lines** (header + Add line, lines, totals, validation hint), **Counters & sign-off**
  (counters in `grid gap-4 sm:grid-cols-2`, right above the Save/Submit footer).
- Denomination calculator (₦ notes × count) untouched, still per cash line.

**"Reference (optional)" field — DOES NOT EXIST in this form**

- Grepped the file: only mentions of `reference` are the header comment, the `UsherSheetLine.reference`
  display type, and read-only display in the expanded row. There is no reference input, state, or payload key.
  Per-line payloads already send only `{ fundId, method, amountCents }` → nothing to remove, PATCH unaffected.

**Service dropdown — both requested services ALREADY present**

- `SERVICE_NAMES` = `["1st Service","2nd Service","3rd Service","Midweek Service","Bible Study","Prayer Meeting","Vigil","Revival","Special"]`.
- "Bible study" / "Prayer meeting" exist as **"Bible Study" / "Prayer Meeting"** (title case, as in every sibling entry).
- Reason for keeping the existing casing: the server validates `serviceName` against its own allowlist —
  `src/server/services/giving.ts:1835` has the identical title-case list, `createOfferingCountSheet`
  (giving.ts:1912-1913) throws `badRequest("Unknown service name.")` for anything else, and
  `updateOfferingCountSheet` (giving.ts:1974) silently falls back to the old name. Sending the user's literal
  sentence-case strings would 400 sheet creation for those two services. Since the task says ADD "if not present"
  and both services ARE selectable, no change made. (Server file was out of scope / untouchable.)

**Counted-by capture — verified against the API**

- `createOfferingCountSheet` (giving.ts:1895-1906) input: `{ name?, serviceDate?, serviceName?, countedByOne?, denominations?, lines?, categorySplits?, depositAccount? }`.
- `updateOfferingCountSheet` (giving.ts:1954-1958) input: `{ lines?, denominations?, countedByOne?, serviceName?, serviceDate? }`.
- **Neither accepts `countedByTwo`.** `countedByTwo` is set server-side at sign-off:
  `verifyUsherBatch` (giving.ts:1652, route POST /batches/:id/usher-verify) hard-codes `countedByTwo: user.name`
  (giving.ts:1665); finance can later set it again via `postBatch` (giving.ts:564, route requires body.countedByTwo).
- So: "Counted by" relabeled **"Counted by (1)"** (state `countedByOne`, id `uc-by`, payload
  `countedByOne: countedByOne.trim() || user.name` on POST + PATCH + usher-verify — current behavior kept:
  prefilled with signed-in user, editable, sends the typed name).
- Added a **"Counted by (2)"** read-only display (value = signed-in `user.name`) with helper text
  "Recorded automatically from your sign-in when the sheet is signed & submitted to finance." — truthful UI for
  what the server records; no fake `countedByTwo` key is sent in payloads (it would be silently dropped and never persist).
- Amount stays integer kobo end-to-end; no new dependencies; no API/permission changes.

## Quality gates

- `bunx tsc --noEmit | rg "giving-module|UsherCollections"` → **no output (0 errors)** for both files.
  (Remaining project errors are pre-existing in unrelated server files: people-import, pipeline, public-forms, stripe-provider, whatsapp.)
- `bun run lint | rg -A2 "giving-module|UsherCollections"` → **no output (clean)**.
  Fixed one file-attributed item: removed the now-unused `eslint-disable-line react-hooks/exhaustive-deps`
  directive on the `methodTotals` memo (line 575; directive pre-dated this task but reported against this file).
- `git diff --stat HEAD` confirms only the two assigned files changed. dev.log shows `✓ Compiled` with no errors.
