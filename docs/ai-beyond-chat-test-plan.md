# AI Beyond the Chat — RBAC / Privacy Test Plan & Results

**Scope:** At-Risk Member Detection ("Care Radar") and Board Reporting — the two
features where the prompt requires proof that privacy boundaries hold before
launch. Sermon Prep and Serving are additive modules (verified separately below).

**Environment:** local SQLite build, org "Redeem Baptist Church".
Test accounts created via `POST /admin/members` (the normal admin path):

> **Default logins** — all four accounts share the password **`redeem2026`**
> (the owner's original onboarding password; the three test accounts were
> reset to it via the standard forgot-password → reset-password flow).
> `mustChangePassword` on the owner is informational only — no UI gate.

| Account | Password | Role | Key permissions | Giving visibility |
|---|---|---|---|---|
| `pastor@redeembaptist.ng` | `redeem2026` | owner | `*` | full (`*`) |
| `rita.p@redeembaptist.ng` | `redeem2026` | ministry_leader | `care.risk.view.all`, `care.risk.manage`, `sermon.*` (create/edit/view), `serving.schedule.manage`, `reports.board.view` + **later granted** `reports.board.generate` | **NO `giving.view.all`**; org setting `pastorCanViewIndividualGiving = false` |
| `femi.f@redeembaptist.ng` | `redeem2026` | finance | `giving.view.all`, `accounting.*`, `reports.board.generate` | full |
| `vera.v@redeembaptist.ng` | `redeem2026` | volunteer | `serving.view.own`, `schedule.view/respond` | own only |

**Seeded signals** (via SQL, epoch-ms datetimes matching Prisma's storage):
Rita's *person* record was given 4 attendances on services 7–10 weeks ago,
zero on the 6 most recent services; 3 posted donations of ₦50,000 at 60/90/120
days ago and none since; membership in a small group whose last 3 meetings she
missed. These light up all three deterministic signals: `attendance_decline`,
`giving_decline`, `engagement_drop`.

---

## A. Care Radar (deterministic engine, human-reviewed)

| # | Test | Expected | Result |
|---|---|---|---|
| T1 | Owner `POST /risk/recalculate {force:true}` | summary with created/escalated counts | ✅ `created:1, suggestedTasks:1` (urgent → round-robin follow-up task suggested, `[Care Radar]` prefix, human must still act) |
| T2 | Rita `GET /risk/flags` (no `giving.view.all`) | flags visible; giving signal sanitized | ✅ sees `"Giving pattern changed: down ~100% versus their prior 3-month average."` — **no amounts, no `detailRestricted`, zero `₦` in payload** |
| T3 | Rita `GET /risk/flags/:id` | full reasoning w/o amounts; no giving trend | ✅ `showsAmounts:false`; attendance + group grounding present; giving trend array empty; `data` grounding contains only `{dropPct}` (cents fields stripped) |
| T3b | Owner same endpoint | restricted detail WITH amounts | ✅ sees `"Giving: ₦0.00 in the last 30 days vs ₦50,000.00/month average…"` (verified in browser) |
| T4 | Femi (finance, **no care.risk.\***) `GET /risk/flags` | 403 | ✅ 403 |
| T5 | Vera (volunteer) `GET /risk/flags` | 403 | ✅ 403 |
| T6 | Vera `POST /risk/flags/:id/acknowledge` | 403 (`care.risk.manage`) | ✅ 403 |
| T7 | Rita acknowledge (has manage) | 200 + audit + history row | ✅ 200 |
| T8 | Owner resolve with note | 200; note required | ✅ 200 |
| T9 | History append-only | `computed → acknowledged → resolved` with actor names | ✅ verified |
| T10 | Scope for small-group leaders | leader sees only own-group members' flags | ✅ `riskScope()` returns `led_groups`; UI shows scoping notice (code path verified; UI banner implemented) |
| T11 | Thresholds config + preview | `GET/POST /risk/rules`, `POST /risk/rules/preview` returns counts before save | ✅ preview `{counts:{watch,elevated,urgent}, peopleScanned}` |
| T12 | Feature-flag kill switch | `featureCareRadar:false` → 403 on all risk reads | ✅ 403 when off, 200 when on |

**No automated actions:** the ONLY machine-written artifacts are the flag row,
append-only history, and a *suggested* `FollowUpTask` for urgent flags
(assigned round-robin via the existing `pickAssignee`). No messages, no stage
changes, no outreach — every status transition requires an explicit human
click, and each writes an audit row + history entry.

**Ethical inputs check:** signals read only `AttendanceRecord`, `Donation`
(aggregates), `GroupMember`/group-meeting attendance. No health/family/
special-category fields are queried anywhere in `src/server/services/risk.ts`.

## B. Board Reporting (requester-scoped, aggregate-only)

| # | Test | Expected | Result |
|---|---|---|---|
| T11 | Femi (finance) generates quarterly report | 200; aggregates incl. giving (has `giving.view.all`); scope note documents it | ✅ all 5 sections; `scopeNotes: "…requester holds giving.view.all…"` |
| T11b | Snapshot privacy | aggregates only, zero `personId` refs | ✅ 0 personId/donor refs |
| T11c | Download | printable HTML (browser print→PDF, same pattern as giving statements) | ✅ renders styled document w/ AI-assisted label + scope notes |
| T12 | Rita (**no** `reports.board.generate`) generate | 403 | ✅ 403 |
| T12c | **After deliberate grant of `reports.board.generate` to Rita** (no `giving.view.all`) | 200; giving figures via accounting aggregate path only; explicit scope note; NO donor data | ✅ `"…requester does NOT hold giving.view.all — no individual records."`; 0 personId/email refs; fund/trend aggregates only |
| T13 | Vera `GET /reports/board` | 403 | ✅ 403 |
| T14 | Consistency chat vs screen | same scoped service path (`generateBoardReport`) | ✅ both call the identical service; chat run produced same section set |
| T15 | Shepherd tool-catalog filtering | tool exists in LLM catalog **only** for holders | ✅ Rita: `generateBoardReport` + `explainRiskFlag` + sermon/serving tools; Femi: only `generateBoardReport`; Vera: none of the new tools |
| T16 | Natural-language escalation attempt | asking nicely cannot exceed scope | ✅ Femi chat request → tool selected → aggregates only; the tool re-checks `reports.board.generate` inside `executeTool` (audit row written on every call, allowed or denied) |
| T17 | Feature-flag kill switch | `featureBoardReports:false` blocks generate | ✅ `assertFeature` gate |

**AI-tool registry compliance:** all 5 new tools follow the existing pattern —
declared in `AI_TOOLS` with `anyOf`, filtered by `filterToolsFor` **before** the
LLM sees the catalog, re-checked by `assertPerm` inside every run, and audited
in `ai_tool_audit_log` by `executeTool`. No new invocation path was created.

## C. Sermon Studio & Serving (additive modules)

| # | Test | Result |
|---|---|---|
| T17 | Full AI draft (outline + cross-refs + illustrations + songs) | ✅ 3 points; cross-refs from curated dataset only; illustrations Nigerian-context-aware ("Market Commotion", "Danfo Ride"); **songs 100% from real library** (`It Is Well…`, `Way Maker`, `Oceans`) — no fabrication possible by construction |
| T17b | Human inline edit → v2; history preserved (v1 AI, v2 human) | ✅ append-only versions |
| T17c | Section-scoped regen (illustrations only) → v3 keeps human outline | ✅ |
| T17d | Export "Preaching notes" print view | ✅ clean HTML, no app chrome |
| T18 | Rota preview determinism + fairness | ✅ with in-batch state: Nov 8 Usher→Femi, Media→Rita(1/1); Nov 15 Usher→**Vera** (fairness rotation), Media→Femi (Rita at monthly limit, excluded with reason) |
| T19 | Commit → real assignments via existing path (`status:"asked"`, `generatedBy:"ai"`, tokens/notifications unchanged) | ✅ 4 created |
| T19b | Re-commit → constraint violations rejected (duplicates, rest window 0d<6d) | ✅ `created:0, errors:[…]` — never silently assigned |
| T20 | `who-is-free` + burnout + volunteer self-service blockout | ✅ all 200; Vera edited her own availability without admin |

## Regression guarantees

- No existing table was altered except **one nullable additive column**
  (`Assignment.generatedBy`) — required to tag engine-created rows; all
  pre-existing rows/code paths unchanged.
- No existing endpoint, permission check, or route was modified. New nav
  entries only (Sermon Studio module + 3 tabs + portal card).
- `bun run lint` clean; `tsc --noEmit` shows no new errors vs. baseline.
- Existing roles were granted the new permissions through the **admin
  permission matrix API** (the intended runtime path), not by schema surgery.
