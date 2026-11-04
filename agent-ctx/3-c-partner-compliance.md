# Task 3-c — Partner Compliance queue hardening (security audit §3)

Agent: partner-compliance · Files touched: ONLY `src/components/partner/partner-compliance.tsx` (406 → 470 lines, full rewrite).

## What changed

### Queue view
- Query keys migrated to the shared hierarchy: queue `["partner","compliance","queue"]`, detail `["partner","compliance","detail",detailId]` — so the root-level `qc.invalidateQueries({ queryKey: ["partner"] })` (Refresh button + after every decision) invalidates all partner data.
- **BUG FIX (fallback-to-queue-URL):** detail query now passes `/partner/compliance/${detailId ?? ""}` with `{ enabled: !!detailId }` — the query is disabled with no id, so it never fires against the queue URL; `d` is computed as `detailId && detail.data?.id === detailId ? detail.data : null`.
- Queue row meta now uses `fmtDateShort(t.createdAt)` (was raw `toLocaleDateString`).
- Row actions: Review (outline/FileText), Request changes (ghost/Undo2), then either primary "Verify & activate" (if ready) or warning-outline "Bypass" (`border-warning/50 text-warning hover:bg-warning/10`) only when server reports `bypassEnabled` (default false — UI never assumes).
- All raw emerald/amber classes replaced with semantic tokens (`border-success/40 text-success`, `border-warning/50 text-warning`, `bg-warning-bg`).

### Decisions — SINGLE ConfirmActionDialog at tree root
- New `DECISIONS: Record<DecisionKind, DecisionConfig>` for verify / bypass / request (endpoint, tone, title, description, confirmLabel, impacts, reason {label, minLength, placeholder}, acknowledgement, success toast).
- **BUG FIX (nested dialogs):** the old inline bypass Dialog (rendered as a sibling Radix Dialog with its own textarea/checkbox state) is deleted. Every decision — verify, bypass, request — now opens ONE shared `<ConfirmActionDialog>` rendered at the component root as a sibling of the review Dialog, so it always stacks on top, never nests inside.
- `runDecision(reason)`: POSTs `/partner/compliance/{id}/{endpoint}` with `{ reason }` when the config has a reason (bypass ≥20, request ≥10) else `{ attested: true }` (verify); success toast from config; closes decision + review dialogs; invalidates `["partner"]`; ApiError → its message, else "Action failed."; `busy` gates the dialog.
- Bypass impacts are computed from the target's open checklist items (`Waived: {label}`), with the "no unmet items" fallback string.

### Review dialog (dossier)
- ScrollArea `max-h-[62vh]`; semantic `<dl>` grids (sm:grid-cols-2) for CAC/regulatory, addresses/leadership, banking/consent; trustee cards with `idType.replace(/_/g, " ")`, masked ID numbers, residential address.
- **Documents:** raw `/api/v1/...` `<a target=_blank>` links replaced by `openDocument(fileId)` → GET `/partner/compliance/documents/{fileId}/url` → `window.open(url, "_blank", "noopener,noreferrer")` on the short-lived signed URL; error toast "Could not open the document."
- TIN rendered `tabular-nums`; registration date + NDPA acceptance use `fmtDateShort`; audit trail uses `fmtDateTime` and step chips `a.step.replace(/_/g, " ")`.
- Footer: "Identifiers are masked. Every document view is logged." + Request changes / Bypass (only when `!readyForReview && bypassEnabled`) / Verify & activate (`disabled={!d.readyForReview}`).
- Detail interface updated to the new masked server contract (no trustee/head-pastor phone/email fields, `ninMasked`, `worshipCampus.address` only, trimmed queue row). Inside the dialog: fetch error shows `ErrorBlock`, otherwise `LoadingBlock "Loading church dossier…"`.

## Deviations (minor, intentional)
1. Added `detail.error ? <ErrorBlock/> :` before the dossier LoadingBlock — spec said "!d → LoadingBlock"; without it a failed dossier fetch spins forever. Same ErrorBlock the spec mandates for the queue.
2. Added empty-state fallbacks: "No trustees on file." and "No onboarding events recorded yet." (spec silent; avoids empty boxes).
3. Registration date uses `fmtDateShort` (the only date formatter in the mandated import list) — note it renders month+day, not year.
4. Footer decision buttons carry the same icons as queue rows (Undo2/ShieldAlert/ShieldCheck) for consistency; spec didn't specify footer icons.
5. Bypass badge text on recently-verified rows is exactly "bypass" (spec wording), slightly shorter than the old "bypass-activated".

## Validation
- `bun run lint` → **0 errors, 5 warnings, all pre-existing** (crm-cards, crm-table, detail-sheet, upload-dialog, test-bootstrap). Zero findings in partner-compliance.tsx (grep count 0).
- `tsc --noEmit` → no errors in partner-compliance.tsx or confirm-action-dialog.tsx (76 errors exist elsewhere in-repo, untouched files).
- Written against the parallel agent's now-landed `confirm-action-dialog.tsx` — prop contract matches exactly (named export, reason/acknowledgement/impacts/busy/tone, trimmed reason passed to onConfirm).
- Dev server compiles clean (`dev.log`: Ready, no errors).
