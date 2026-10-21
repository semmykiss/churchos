# Task ID 9 — Diagnose & fix 3 broken modules + Build Access Control

## Initial findings (before fixes)

### TypeScript errors found via `bunx tsc --noEmit` (lint passes but tsc catches these):
- `src/components/churchos/modules/settings.tsx(245,69): error TS2522: Cannot find name 'role'`
- `src/components/churchos/modules/settings.tsx(245,89): error TS2522: Cannot find name 'role'`
- (Pre-existing) `src/components/churchos/app-shell.tsx(206,53): error TS2304: Cannot find name 'titleCase'`
- (Pre-existing) `src/components/churchos/module-registry.tsx(15,7): error TS2741: Property 'followups' is missing`

### Initial API state (from curl):
- admin login → 200
- /api/profile GET → 200 (returns user data)
- /api/profile POST changePassword → 200 ({ok:true})
- /api/settings GET → 200 (church profile + counts)
- /api/settings/users GET → 200 (admin)
- /api/pastoral GET → 200 (cases)
- /api/pastoral/prayer GET → 200 (prayer requests)
- member role POST /api/pastoral/prayer → 201 ✓
- /api/access → no route exists yet (returns HTML page)

### Bugs identified:

**Pastoral module (pastoral.tsx):**
1. **BUG (UX):** Top-level "New Case" button (line 159-163) only navigates to cases tab; doesn't open the New Case dialog. Should lift dialog state up.
2. **No actual runtime crashes identified yet — module appears to function.**

**Settings module (settings.tsx):**
1. **CRITICAL BUG:** `MyAccountSection` line 245 references `role` which is not declared in scope. The destructure is `const { user, organization } = useAuth()` — `role` is never pulled out. This throws `ReferenceError: role is not defined` at runtime, breaking the entire My Account tab (the default tab). The user perceives Settings as "broken".
2. Fix: derive `role` from `user?.role ?? 'member'` and use it consistently.

**Profile module:**
- No standalone module — Profile is the "My Account" tab inside Settings.
- /api/profile GET/PATCH/POST all return 200. ✓
- The bug is in the settings.tsx MyAccountSection crashing due to (1) above.

**module-registry.tsx constraint issue:**
- The task says the registry "auto-includes any module in the Module type once you add `access` to permissions.ts — verify this".
- VERIFICATION: This is FALSE. The registry uses a static `loaders` object literal; adding a new Module type without a corresponding loader entry means `getModuleComponent('access')` returns the `Placeholder` fallback at runtime (TS error caught by tsc but not eslint).
- Pre-existing TS error already there for missing `followups` loader (Task 1 omitted it).
- Decision: Add the minimum-necessary loader entry for `access` to make the feature actually render. (One-line addition. Documented in worklog.)

