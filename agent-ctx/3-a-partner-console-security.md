# Task 3-a — Partner Console security-hardening upgrade

Agent: 3-a (partner console security audit pass)
Scope: ONLY 3 files — `src/components/partner/confirm-action-dialog.tsx` (new), `partner-root.tsx` (rewrite), `partner-login.tsx` (edit). No other file touched.

## What changed

### 1. NEW `src/components/partner/confirm-action-dialog.tsx`
- Exports `ConfirmActionProps` (exact spec interface), named `ConfirmActionDialog`, **and** `export default ConfirmActionDialog` (both import styles work for downstream agents).
- Gated confirmation for sensitive partner actions: optional typed confirmation (exact slug match, trim-compared), mandatory reason (min length, live counter `{n}/{min} characters minimum`, maxLength 500), mandatory acknowledgement checkbox.
- Impacts panel: destructive → `border-destructive/30 bg-destructive/5 text-muted-foreground`; default/warning → `border-warning/40 bg-warning-bg text-warning` (semantic tokens, dark-mode safe).
- Warning tone confirm button keeps solid amber: `bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700`.
- Busy-safe: `onOpenChange` blocked while `busy`, state (typed/why/ack) resets when `open` turns false, `canConfirm` gate, Loader2 spinner.
- A11y: `useId` ids + `htmlFor` labels, `aria-invalid` + error text on typed mismatch, `aria-live` counter, focus rings via shadcn defaults.

### 2. REWRITE `src/components/partner/partner-root.tsx`
- `QueryClient` now has `QueryCache`/`MutationCache` `onError` → any 401 (`ApiError.status === 401`) dispatches `window` event `partner:session-expired`. Listener drops the principal, `qc.clear()` (no cross-session cache reuse), toasts re-sign-in notice.
- Retry policy: queries retry ≤1 and never on 401; mutations never retry (no double onboarding/renewal/delete).
- Hash-based tabs `#/partner/<key>` via `tabFromHash()` regex `^#\/partner\/(\w+)`, `history.replaceState` on switch, `popstate` support.
- WAI-ARIA roving tabindex on the `role="tablist"`: ArrowLeft/ArrowRight cycle, Home/End jump, focus moved to tab button, `aria-controls`/`aria-selected`/`tabIndex` correct.
- Sticky header (brand-gradient Store tile, "Grace ChMS · Partner console", partner name/email, Church app + Sign out ghost buttons), tabpanel wrapper with `role="tabpanel"` ids, footer now reads only "Grace ChMS partner console · all actions are audit-logged" — infrastructure details (SQLite etc.) removed.
- Root wrapper `flex min-h-screen flex-col bg-background` + footer `mt-auto` → sticky footer rule holds.

### 3. EDIT `src/components/partner/partner-login.tsx`
- Prefilled credentials removed (empty state); demo hint is now dismissible (`Demo access: partner@gracechms.demo · partner2026 (seeded demo tenant)`, `text-xs text-muted-foreground`, X button with aria-label).
- Generic credential error: every non-429 failure shows exactly "Invalid email or password." — no user-enumeration signal. `role="alert"` danger box kept.
- 429 lockout: reads `err.details.retryAfterSeconds` (fallback: parse seconds out of `err.message`); shows "Too many attempts. Try again in Xs" (live 1s countdown) and disables submit while counting; unknown duration → "Please try again later."
- A11y: `inputMode="email"`, `autoComplete="email"`/`"current-password"`, `aria-invalid` while an auth error/lockout is shown, busy submit shows spinner + "Signing in…", disabled while busy or locked.
- Session-timeout notice: mount-time check of `sessionStorage["partner:session-ended"] === "1"` → muted info notice "Your session ended after inactivity. Please sign in again.", flag cleared.
- Email trimmed + lowercased client-side before POST; endpoint/payload and `onLogin(res.partner)` unchanged. AuthVisualPanel layout untouched.

## Deviations (and why)
- Root tablist got `scroll-slim` + `py-2` on tabs (bigger touch target, cleaner scrollbar) — additive classes on top of the spec'd ones.
- Login page bottom line "Local build · SQLite · …" replaced with "License enforcement is active at church sign-in" — removes infrastructure disclosure (audit spirit; root footer had the same rule).
- 429 with no parseable duration shows a "try again later" lockout box without countdown instead of inventing a number.
- Confirm dialog exports both named and default to be import-style agnostic for parallel consumers.

## Notes for other agents
- To use the confirm dialog: `import { ConfirmActionDialog } from "@/components/partner/confirm-action-dialog";` — pass `open`, `onOpenChange`, `title`, `description`, `impacts?`, `confirmLabel`, `tone?`, `typedConfirm?`, `reason?` (forward `why` to your API as the audit reason), `acknowledgement?`, `busy`, `onConfirm(reason)`.
- Partner login reads `sessionStorage["partner:session-ended"]` — if you drop a partner session programmatically, set it to `"1"` before navigating to the login view to get the "session ended" notice.
