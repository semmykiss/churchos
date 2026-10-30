# WA-UI — WhatsApp Admin Module UI (Task 7)

## Summary
Built the complete WhatsApp admin module frontend (6 new files) for the Grace ChMS Next.js 16 app, plus the single allowed wiring edit in `module-registry.tsx`. Backend (`src/server/**`, `prisma/**`) untouched; no `db:push` run.

## Files created (src/components/app/whatsapp/)
1. **WhatsAppModule.tsx** — module shell: header ("WhatsApp" + subtitle), connection badge (emerald `Connected · {provider}` / amber `Not connected` from `GET /whatsapp/overview`), Tabs: Inbox | Broadcasts | Flows | Templates | Settings. Also exports ALL shared WhatsApp API types (`WaOverview`, `WaConversation`, `WaThreadResp`, `WaTemplate`, `WaBroadcast`, `WaFlow(Step)`, `WaRun`, `WaAccount`, `WaContactsResp`, `WaAudiencePreviewResp`, …) consumed via `import type` by the tabs (type-only imports → no runtime cycle).
2. **InboxTab.tsx** — two-pane inbox (list 340px + thread; mobile: list→thread with back button). Conversation rows with avatar initials, last-message preview + relative time, badges (Window open/closed dot, Not linked, Awaiting name, Opted out). Thread: inbound left white/border bubbles, outbound right emerald-600, outbound tick labels (✓/✓✓ delivered/read/failed + errorReason), template name chip. Link-Person dialog: debounced people search `GET /people?search=&page=1&pageSize=10` → `POST /whatsapp/contacts/:id/link`. Composer: free-form inside 24h window (Enter-to-send); amber policy warning + approved-template picker when window closed; opt-out block alert. Invalidates `["whatsapp"]` prefix after every mutation.
3. **BroadcastsTab.tsx** — desktop table + mobile cards; status badges (draft zinc, scheduled/sending amber, sent emerald, failed red); draft-row Send/Delete with AlertDialog confirms. New-broadcast dialog: name, template Select (unapproved disabled with "— pending approval"), stage chip toggles, Groups checkbox list (`GET /groups`), Tags checkbox list (`GET /tags`), `POST /whatsapp/audience/preview` inline count+sample, `POST /whatsapp/broadcasts`.
4. **FlowsTab.tsx** — Follow-ups queue (context.followup_note, "Mark handled" with optional note → `POST /whatsapp/runs/:id/resolve`); Active runs list (status badges: waiting_reply amber, scheduled emerald, active zinc, needs_human red; step index + nextStepAt); "Run scheduler" → `POST /whatsapp/tick` toast `Fired X … triggered Y`; flow cards (triggerType badge, active Switch → toggle, Edit/Delete, runCount); "Start" → contact Select → `POST /whatsapp/flows/trigger`; full flow editor (create+edit) with ordered STEP BUILDER: message/template/question/rsvp/give_link/assign_followup per-kind fields, delayHours parsed to number, vars/choices comma-split to arrays, up/down/remove, event/fund/template selects, validation per step before `POST /whatsapp/flows`.
5. **TemplatesTab.tsx** — table + cards; status badges (draft, "Pending Meta approval", approved, rejected) with statusInfo subtext; editor dialog (name hint lowercase_with_underscores, category, language, body 1024-char counter, variable labels) with live bubble preview (`{{n}}` → labels or "Var n"); actions gated by status: Edit (draft/rejected only — approved locked), Submit for approval (draft/rejected), **Approve (sandbox)** for pending, Delete (draft).
6. **WhatsAppSettingsTab.tsx** — `canDo(user,"admin.manage")` gate with read-only alert; account cards (provider badge, status, webhook URL + verify token copy rows, hasToken, lastError, Disconnect AlertDialog); Connect dialog (sandbox/meta helper texts, meta fields incl. password inputs for token/appSecret) → success panel showing returned `webhookUrl` + `webhookVerifyToken` with copy buttons and Meta paste guidance; "Test the channel" simulate-inbound card (admin only) with friendly ACTION_LABELS mapping.

## Wiring edit (module-registry.tsx) — exact diff
```diff
 import {
   LayoutDashboard, Users, UsersRound, ScanLine, CalendarDays, HandCoins, Landmark,
-  Megaphone, HandHeart, HeartHandshake, Workflow, BarChart3, Settings, UserRound,
+  Megaphone, HandHeart, HeartHandshake, Workflow, BarChart3, Settings, UserRound, MessageCircle,
   type LucideIcon,
 } from "lucide-react";

 import CommsModule from "@/components/app/modules/comms-module";
+import WhatsAppModule from "@/components/app/whatsapp/WhatsAppModule";
```
```diff
   { key: "comms", label: "Communications", icon: Megaphone, permission: ["comms.view", "comms.chat.use"], component: CommsModule, group: "finance" },
+  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, permission: ["comms.view", "comms.whatsapp.send"], component: WhatsAppModule, group: "finance" },
```

## Quality gates
- `bun run lint` → **passes, 0 errors 0 warnings** (fixed: empty interface → type alias; Section requires children → wrapped content; removed 2 unused type imports).
- `bunx tsc --noEmit` → **0 errors in all whatsapp/* files and module-registry** (remaining project errors are pre-existing in `src/server/**`, `partner-overview.tsx`, `skills/`, `examples/` — untouched per task scope).
- Dev server: compiles clean, `GET / 200`.

## Endpoint shapes discovered different from the task brief
1. **Tags list is `GET /tags`, NOT `GET /people/tags`** (no such route exists). Response `{ items: [{ id, name, color }] }` (max 50). Used `/tags` in BroadcastsTab.
2. **`GET /whatsapp/messages/:contactId`** returns a NARROW contact: `{ contact: { id, phoneNumber, personId, optedIn, withinWindow, lastInboundAt } }` — no `displayName/personName/onboardState` there; thread header therefore uses the conversation-list row for the display name and the thread contact for authoritative window/optIn state.
3. **`GET /whatsapp/accounts`** returns extra fields vs brief: `businessAccountId`, `tokenMasked`, `createdAt` alongside the documented ones; `webhookUrl` is a relative path `/api/v1/whatsapp/webhook/{phoneNumberId}`.
4. **`POST /whatsapp/send`** accepts `{ contactId, text? }` OR `{ contactId, templateId?, vars? }` and returns `{ ok, mode: "text" | "template" }`; window/not-approved cases throw ApiError with user-friendly messages (surfaced via toast.error).
5. **`POST /whatsapp/broadcasts`** also accepts optional `scheduledAt` (server sets status scheduled); response `{ ok, id }`. Send returns `{ ok, sent, failed, skipped }` — used in the success toast.
6. **`POST /whatsapp/simulate/inbound`** returns the raw `processInbound` result `{ handled, action }` with action ∈ opted_out | opted_in | guest_created | matched | onboarding_continues | flow_advanced | onboarding_started | ai_reply | fallback (mapped to friendly labels).
7. **`GET /whatsapp/runs`** items include `needsHuman`, `contactId`, `phoneNumber`, `startedAt`, `lastActivityAt` beyond the brief; followup note lives at `context.followup_note`.
8. **`POST /whatsapp/flows`** accepts optional `isActive` (preserved on edit so the card toggle isn't clobbered); server clamps delayHours ≤ 720 and choices ≤ 4.
9. `GET /groups` and `GET /events` and `GET /funds` confirmed `{ items: [...] }` (GroupDTO / EventDTO / FundDTO incl. `code`), used for audience + step builder selects.

## Notes for next agents
- Query keys all live under the `["whatsapp", …]` prefix — invalidate that prefix after any WhatsApp mutation to refresh overview/conversations/threads everywhere.
- `canSendWhatsapp(user)` = `comms.whatsapp.send || comms.send` gates all mutating buttons in Broadcasts/Flows/Templates; Settings uses `admin.manage`. Server re-checks everything.
- Render-phase hydration guard pattern used in editors (setState-during-render with a key guard) is intentional (React "adjust state on prop change" pattern).
