# Personas and Functional Specification — Church Management Platform

| | |
|---|---|
| **What this is** | The product definition for a multi-tenant church management platform (ChMS): who it serves, what each module must do, and the smallest cut that is credibly usable. Written for the founder and the first engineering team; story IDs are usable as tickets. |
| **Scope and premises** | Churches of 150–3,000 weekly attenders, single- and multi-campus. Web app plus mobile-web member experience. English UI, US-first compliance (IRS substantiation, TCPA/10DLC, CAN-SPAM, PCI via processor). Not a website builder, not fund accounting, not a live-streaming or sermon tool. |
| **Version** | v1.0 — 2026-10-29 — initial draft. |
| **Out of scope here** | Pricing and packaging, competitive teardown, technical architecture, visual design. Those belong to sibling documents in this batch. |

**How to read it.** Part 1 defines the six people the product is for and what makes them quit. Part 2 specifies twelve modules in a fixed pattern (purpose → stories → MVP vs later → edge cases → data). Part 3 collapses all twelve into one buildable MVP and names what is deliberately excluded. Section 0 holds the conventions that every module inherits; module sections do not repeat them.

Stories are written as user stories with an explicit actor. "MVP" means required for the first paying customer; "Later" means designed for but not built. Edge cases end in a **Decision**, because an edge case without a rule is just a worry.

---

## 0. Conventions every module inherits

### 0.1 Core objects

| Object | Definition | Cardinality rule |
|---|---|---|
| Tenant | One church organization; the billing and isolation boundary | Everything below carries `tenant_id` |
| Campus | A physical congregation with its own services, rooms and staff | A tenant has 1..n campuses; MVP ships with 1 |
| Person | One human, regardless of role | One record per human, ever; staff are people too |
| Household | The communication and giving unit ("the Bennett family") | A person belongs to at most one household at MVP |
| Household member | Person↔household link with a role | Roles: adult, child, dependent, other |
| Guardian link | Adult↔child authority, independent of address | Many-to-many; carries custody and pickup rights |
| Group | Any circle: small group, class, serve team, committee | Belongs to one group type and one campus |
| Event / occurrence | A template and its dated instances | Occurrences are materialized, never implied |
| Attendance record | One person × one occurrence × one status | Unique per person per occurrence |
| Check-in | A child's attendance plus security code and guardian | One active check-in per child per occurrence |
| Fund / gift / allocation | Designated purpose, donation, and its split across funds | A gift's allocations must sum to the gift |
| Batch | A counted deposit or a processor payout group | Must balance before posting |
| Pledge / recurring gift | A commitment, and a scheduled payment | Neither is revenue until a gift exists |
| Consent record | Person × channel × purpose × state | Append-only; latest state wins |
| Care case | A pastoral situation with an owner and stage | Confidentiality tier is mandatory |
| Workflow run | One automation execution for one person | Idempotent per trigger key |
| Audit event | Who did what, to which object, before and after | Append-only, never edited |

### 0.2 Twelve platform rules

1. **Tenant isolation is enforced in the data layer**, not in controllers: row-level security on `tenant_id`, including exports, search and background jobs. A cross-tenant read is a Sev-1 incident.
2. **Soft delete everywhere.** Hard delete only through a retention job. Financial records, audit events and care notes are never hard-deleted by a user action.
3. **Merge is a first-class operation** for people and households: field-level survivor choice, alias table so old IDs redirect, 30-day unmerge window, audit entry.
4. **Campus is a real column** on person (home campus), group, event, gift, message and role assignment — from day one, even while the MVP UI shows one campus.
5. **Authorization is checked server-side per object and per action.** Hiding a button is not a permission. Every endpoint resolves `(user, tenant, campus_scope, module, action)` before returning data.
6. **Audit log is append-only** and records actor, actor type (user / platform support / system), object, action, before/after for sensitive fields, IP, user agent, timestamp. *Viewing* a confidential care note is an auditable event.
7. **Consent is per person, per channel, per purpose** (operational vs marketing), with source, timestamp, IP and the exact wording version shown.
8. **All timestamps are stored in UTC** and rendered in the campus's timezone. Recurrence is computed in local wall time, never by adding fixed offsets.
9. **Custom fields are typed, scoped and permissioned**: staff-only, leaders, or member-visible; PII flag; searchable flag; exportable.
10. **No card data on our servers.** Processor tokens only; we may store brand, last four digits and expiry. This keeps the platform in the lightest PCI scope available to it ([Stripe security guide](https://docs.stripe.com/security/guide), accessed 2026-10-29).
11. **Money is integer minor units plus a currency code.** No floats, anywhere, including reports and CSV exports.
12. **Every list is exportable to CSV by someone with permission, and every export is audited** with row count and filter.

### 0.3 Roles at MVP

Six preset human roles, plus the kiosk device principal described below. Custom role building is a Later item; the permission model underneath is already granular.

| Role | Scope | Sees | Does not see |
|---|---|---|---|
| Owner | All campuses | Everything, billing, audit log, retention | — |
| Campus admin | One campus; MVP tenants have one | People, households, groups, events, rooms, messages, volunteers | Care notes unless on the case team; card data |
| Finance | One campus or all | Gifts, batches, payouts, pledges, statements, giving reports | Care notes; check-in medical flags |
| Ministry leader | Assigned groups | Roster, contact details, attendance, group-shared prayer requests | Giving; care notes; other groups |
| Volunteer | Assigned positions | Today's roster for their room or team | Directory search beyond their team |
| Member | Self and household | Own profile, giving, schedule, group, children's check-in | Anyone else's giving or contact details |
| Kiosk device | One campus | Children roster and guardian match for today | Browsing people; any admin screen |

The kiosk is a **device principal**, not a shared staff login. It gets a scoped token, a fixed screen, and no ability to search the congregation.

### 0.4 Terms used consistently

**Guest** — attended once or twice, no membership. **Attender** — regular, not a member. **Member** — covenanted or formally joined. **Headcount** — a number a human counted, no identities. **Checked-in** — a per-person attendance record exists. **Household** — giving and mailing unit, never a login. **Guardian** — an adult with pickup authority, not necessarily a household member.

---

# Part 1 — Personas

Six personas, chosen to cover the buying committee and both failure modes: the staff tool that volunteers refuse to use, and the member tool that requires a password nobody remembers. The buyer is the lead pastor or the administrator; the veto is the treasurer; the adoption risk is the volunteer leader.

Each persona carries: the job to be done, what they do today, and the specific behaviors that make them abandon software. The last line of each ("Build implication") is the constraint the module must satisfy.

## P1 — David, lead pastor

**Who.** 52, 11 years at the church, 240 weekly attenders growing to 350. Preaches, chairs the board, does most hospital visits. Uses a phone, not a laptop; delegates every screen he can.

**Jobs to be done**
1. On Monday morning, understand the state of the church in five minutes: who came, who is new, who is hurting, whether giving is on track.
2. Know which first-time guests were followed up, and by whom, without asking three staff members.
3. Walk into a hospital room or an elders' meeting knowing the person's story and recent contact.
4. See giving against budget without requesting a report from the treasurer.
5. Put a decision in front of the board with numbers he trusts.

**Current workaround.** Asks the administrator for a list; reads a printed attendance sheet on Monday; receives a monthly PDF from the treasurer; keeps connection cards in a folder; texts staff individually; hears about absences from group leaders, late.

**Abandons software when**
- The home screen is empty until he chooses filters, a date range and a campus.
- A person's profile needs more than one tap from search, or does not render on a phone.
- The numbers contradict what he saw on Sunday — attendance that counts volunteers, or giving that includes pledges.
- It looks like a sales CRM: pipelines, lead scores, "stages" with no pastoral meaning.

**Build implication.** One "This week" screen with no required input: attendance vs last week and last year, first-time guests and their follow-up status, giving month-to-date vs budget, open care cases. Person profile readable on a 390px screen. Never show him a metric whose definition is not printed under it.

## P2 — Renee, church administrator / office manager

**Who.** 38, part-time (25 h/week), five years in the role. De facto owner of the database, the calendar, the inbox and every password. Moderately technical: comfortable with spreadsheets, not with APIs.

**Jobs to be done**
1. Keep one clean record per person and household, so the directory, the mailing list and the giving records agree.
2. Onboard a new family in one pass — people, children, guardians, groups, consent — without re-keying anything.
3. Answer "who is this person and what do we know about them?" in ten seconds while someone is on the phone.
4. Absorb a departing staff member's knowledge without losing history.
5. Produce the board pack and the annual mailing without a weekend of merge fields.

**Current workaround.** A spreadsheet that predates her plus a ChMS she half-uses; connection cards typed in on Tuesday; email threads as the system of record; duplicates she has stopped fighting; a shared login for the office.

**Abandons software when**
- An import fails silently, or reports "42 errors" with no row numbers.
- A bulk edit needs forty clicks, or has no undo.
- The permission model cannot be explained to a volunteer in one sentence.
- Support answers on Monday about a Saturday failure.
- Anything requires SQL, a consultant, or a support ticket to change a dropdown option.

**Build implication.** Imports are staged, previewed and reversible. Every bulk action shows a before/after count and is undoable for seven days. Custom fields are admin-editable. Errors name the row and the reason.

## P3 — Tom, finance and treasurer volunteer

**Who.** 61, retired accountant, eight hours a month, accountable to the board and personally anxious about it. Two-person counting team on Sundays. Uses QuickBooks for the books.

**Jobs to be done**
1. Record Sunday's offering as a batch that balances to the penny before anything posts.
2. Reconcile processor payouts, fees and refunds against gifts and the bank deposit.
3. Keep restricted funds genuinely restricted, so designated money is not spent on operations.
4. Issue statements by the end of January that satisfy the IRS and survive a donor's auditor.
5. Report to the board monthly, and answer "why is this number different?" a year later.

**Current workaround.** Offering envelopes and a paper count sheet; a bank deposit; QuickBooks; statements by mail merge from a spreadsheet; one tab per fund; a shoebox of correction notes.

**Abandons software when**
- Numbers do not tie out to the cent, or a report changes after he exported it.
- Gifts can be edited or deleted without a trail, or by someone who is not finance.
- Statements omit required language, or cannot be regenerated for a prior year.
- There is no export that his accountant will accept.
- Pledges are mixed into received income.

**Build implication.** Batches are multi-step and balanced; posted gifts are immutable except by reversal; every financial change is audited with actor and reason; statements are reproducible for any closed year; every report has an `as_of` timestamp.

## P4 — Grace, ministry / small-group leader

**Who.** 34, works full-time, leads a group of nine in her home on Wednesdays. Volunteers because she cares about people, not because she likes software. Phone-only, often on bad Wi-Fi in a basement.

**Jobs to be done**
1. Know who is in her group and how to reach them this week.
2. Take attendance in under twenty seconds while people are still arriving.
3. Notice who has been missing for three weeks, before the pastor does.
4. Share a prayer request with the right circle and no wider.
5. Hand a crisis to a pastor with context, immediately.

**Current workaround.** A group chat plus a shared note; a paper list; texts; a monthly "who's missing?" message to the office; a call to the church phone when something is wrong.

**Abandons software when**
- The leader view is the admin view with fewer buttons — she sees giving totals or care notes she should not.
- She is logged out every week, or the password rules are impossible on a phone.
- Taking attendance needs four taps per person.
- It assumes connectivity she does not have.
- She cannot tell whether a prayer request she types will be seen by the whole church.

**Build implication.** A separate leader permission set, deny-by-default. Attendance is one tap per person with a "select all present" default. Sessions last. Every note carries a visible audience label ("Pastors only", "Group can see").

## P5 — Marcus, volunteer coordinator (service scheduling)

**Who.** 45, bi-vocational, coordinates 70–90 slots a week across greeters, kids, hospitality, production and worship. Not a staff member; has a day job; does this on Thursday nights and Sunday at 7am.

**Jobs to be done**
1. Fill every position for every service four weeks out, without calling anyone.
2. Cover a last-minute drop in under ten minutes, from a phone, at 8:50 on Sunday.
3. Protect the reliable 20% from burnout by seeing who is serving too often.
4. Know that the person in the kids room is cleared to be there.
5. Know who actually showed up, not just who said yes.

**Current workaround.** A scheduling tool plus group texts; a whiteboard; "can anyone swap?" messages in WhatsApp; phone calls at 7am; a spreadsheet of who is owed a Sunday off.

**Abandons software when**
- Scheduling takes longer than the spreadsheet did.
- Volunteers cannot swap without him — every swap becomes his inbox.
- Reminders are so frequent that people mute them, and then miss the real change.
- There is no record of no-shows, so the same person lets him down every month.
- Accepting a shift requires creating an account and remembering a password.

**Build implication.** Tokenized accept/decline from an SMS link with no login. A per-team swap board with one-tap leader approval. Reminders at fixed, sparse intervals (T-7, T-2, T-2h). No-show tracking feeds a reliability view.

## P6 — Aisha, member and parent

**Who.** 36, two children (4 and 8), works shifts, phone-first, gives monthly by card. Attends most weeks but not every week. Will use whatever is faster than the paper card.

**Jobs to be done**
1. Check two children into the right rooms in under two minutes, without repeating information she gave last week.
2. Know her children are safe and that only the right adults can collect them.
3. Give, change a recurring gift, and get a statement without phoning the office.
4. Update her address once and have it apply everywhere.
5. Control what the church sends her, and on which channel.
6. Find her group's meeting time and her serving schedule.

**Current workaround.** A paper card each week, or a kiosk that asks for a phone number; a text to the children's pastor when running late; a portal login she resets every quarter; emails she archives unread; cash in an envelope.

**Abandons software when**
- She must install an app to do something she does once a month.
- She is asked to re-enter her children's details, or the kiosk cannot find her by phone number.
- A password reset requires calling the office during office hours.
- Her giving history is visible to whoever shares the family email.
- Messages arrive at 9pm, or continue after she unsubscribes.
- The directory shows her address to people she does not know.

**Build implication.** Mobile web first, no install. Magic-link login. Family check-in by phone number or name, with pre-check-in QR. Per-person privacy toggles, never a household-level "share everything".

**Coverage check.** P1 owns reporting and care; P2 owns people, admin and communications; P3 owns giving; P4 owns groups and care; P5 owns scheduling and events; P6 owns the portal and check-in. No module lacks a named primary user.

---

# Part 2 — Module inventory

Twelve modules, one section each. Build order is not the order below; Part 3 sets the cut.

| # | Module | Primary persona | MVP weight |
|---|---|---|---|
| 2.1 | People and households | P2, P1 | Heavy — everything hangs off it |
| 2.2 | Groups, ministries and small groups | P4, P2 | Medium |
| 2.3 | Attendance and children's check-in | P6, P5, P4 | Heavy — the differentiator |
| 2.4 | Events, rooms and resource booking | P2, P5 | Light at MVP |
| 2.5 | Giving | P3, P6 | Heavy — trust-critical |
| 2.6 | Communications | P2, P1 | Heavy |
| 2.7 | Volunteer scheduling and service planning | P5, P4 | Heavy |
| 2.8 | Pastoral care and follow-up | P1, P4 | Medium — risk-critical |
| 2.9 | Workflows and automation | P2, P1 | Light — templates only |
| 2.10 | Reporting and dashboards | P1, P3 | Medium |
| 2.11 | Member self-service portal and app | P6 | Medium |
| 2.12 | Administration | P2, Owner | Heavy — unglamorous, decisive |

## 2.1 People and households

**Purpose.** One canonical record per human and one communication unit per family, with history that survives staff turnover.

**Key user stories**

| ID | Story |
|---|---|
| PPL-1 | As the office manager, I can create a person from a connection card with only a name and one contact method, so Sunday's guests are not left in a pile. |
| PPL-2 | As the office manager, I see possible duplicates before a new record is saved, so I stop creating the third "Mike Johnson". |
| PPL-3 | As the office manager, I can merge two records and choose the surviving value field by field, so nothing important is lost in the merge. |
| PPL-4 | As the office manager, I can define a custom field with its own type and visibility, so ministries stop keeping side spreadsheets. |
| PPL-5 | As the lead pastor, I see one timeline per person — attendance, groups, giving total, messages, care notes I am allowed to see — so a visit starts with context. |
| PPL-6 | As the office manager, I can move someone through life-cycle stages and see who moved in and out this month. |
| PPL-7 | As the office manager, I can archive someone who left without deleting their giving history. |
| PPL-8 | As a group leader, I can correct a member's phone number but cannot see or change their giving. |

**MVP**

- Person and household CRUD, with household roles (adult, child, dependent, other) and start/end dates.
- Guardian links independent of household, with custody and `authorized_pickup` flags.
- Up to 20 custom fields per object; types text, long text, select, multi-select, date, number, boolean; visibility staff/leader/member; PII and searchable flags.
- Duplicate check on create: exact email or phone, plus fuzzy name with date of birth.
- Merge with field-level survivor choice, alias redirect and 30-day unmerge.
- Life-cycle stages (guest → returning guest → attender → member → leader → inactive → archived) with stage history and `stage_changed_at`.
- Tags, basic saved filters, per-person timeline, archive/deactivate, soft delete.
- CSV import (staged, previewed) and CSV export.

**Later**

- Unlimited custom fields; field-level change history; address validation and geocoding; photo management; nightly database-wide duplicate sweep; household relationship graph (grown children, former spouses, emergency contacts); member-initiated merge requests; household-level "do not contact".

**Edge cases**

**E1. Blended family, two households.** A child lives primarily with her mother, spends alternate weekends with her father, and is collected from church by a grandmother who is not a member. *Decision:* a child has one primary household, but guardianship is a person-to-person link that ignores address. Check-in resolves authorized adults from guardian links plus household adults explicitly flagged for pickup. Never infer guardianship from a shared address, and never require the grandmother to become a household member — she gets an authorized-adult record.

**E2. Merge where both records carry giving.** Two records for the same donor, each with gifts, one credited jointly to a spouse. *Decision:* merge is person-level only; household merge is a separate, explicit action. Gifts follow the person and keep their original fund, date and amount. A jointly credited gift keeps its original household attribution so a reissued statement still reads "Mr and Mrs Bennett". Merging never rewrites a posted gift.

**E3. One human, three roles.** A person is a member, a paid staff member and a volunteer producer. *Decision:* one person record; staff and volunteer status are assignments, never person types. No duplicate record may be created to represent "staff David" — the role model must carry it, or the model is wrong.

**E4. Death, and the eighteenth birthday.** A member dies; separately, a 17-year-old in the youth group turns 18 next month. *Decision:* `deceased` status stops all workflows and messages within the same transaction, retains giving history for statements already issued, and prompts — never auto-applies — a marital-status change for the spouse. Guardian authority expires automatically on the child's eighteenth birthday, moves the person to a review queue, and does not expose their giving or care history to parents afterwards.

**Data captured**

| Entity | Fields that matter |
|---|---|
| Person | tenant, first/last/preferred/middle, suffix, dob, gender (optional), marital status, photo, home campus, status (active/inactive/deceased/archived), stage, stage_changed_at, membership date, notes, merged_into, created/updated by and at |
| Contact point | person, type (email/phone/address), value, label (home/work/mobile), verified_at, sms_capable, do_not_use |
| Household | name, address, primary phone, campus, giving_unit flag |
| Household member | person, household, role, start_date, end_date |
| Guardian link | adult, child, relationship, custody (full/partial/none), authorized_pickup, emergency_contact, verified_by |
| Custom field def | object, key, label, type, options, visibility, pii, searchable, required, display order |
| Person alias | old_id, new_id, merged_by, merged_at, unmerge_deadline |
| Stage history | person, from, to, changed_by, changed_at, reason |

## 2.2 Groups, ministries and small groups

**Purpose.** Model every circle — small group, class, serve team, committee — with leaders, rosters, meetings and a leader view that exposes nothing it should not.

**Key user stories**

| ID | Story |
|---|---|
| GRP-1 | As the administrator, I can create a group type ("Small Group") with default fields and a leader permission set, so every group of that kind behaves the same. |
| GRP-2 | As a group leader, I can add someone to my group from my phone in the lobby, without leaving the conversation. |
| GRP-3 | As a group leader, I can take attendance for tonight's meeting in under twenty seconds. |
| GRP-4 | As a group leader, I can see who has not attended in three weeks, so I know who to call. |
| GRP-5 | As the lead pastor, I can see every group, its fill rate and which groups have no leader. |
| GRP-6 | As a member, I can ask to join a group and get an answer from the leader rather than the office. |
| GRP-7 | As the administrator, I can mark a group confidential so it never appears in a directory or a campus list. |
| GRP-8 | As the administrator, I can split a group in two and keep both halves' history. |

**MVP**

- Group types with default settings and a leader permission set.
- Groups: campus, type, leader(s), co-leader, meeting pattern, location, capacity, description, visibility (listed/unlisted), confidential flag, start/end dates, status.
- Memberships with role (leader, co-leader, member, guest), status, joined_at, left_at, leave reason.
- Join requests with leader approve/decline; capacity check.
- Leader mobile view: roster, contact, one-tap attendance, three-week absentee list.
- Group calendar derived from meeting pattern; group email/SMS through the communications module (consent rules apply).
- Group attendance report and fill-rate report.

**Later**

- Public group finder with filters and map; waitlists with auto-promotion; curriculum library and per-session notes; group health scoring; guided multiplication workflow; per-type membership limits enforced; leader training tracking; multi-group membership rules; group-level prayer wall.

**Edge cases**

**E1. The leader leaves, or the group splits.** A leader resigns on a Tuesday; another group grows to 22 and must multiply. *Decision:* a group cannot exist without at least one leader — removing the last one blocks until a replacement is named or an admin override is recorded. Splitting copies settings, moves memberships with `left_at` on the source, and keeps attendance attached to the original group so history is never rewritten. Groups with attendance are never deleted, only closed.

**E2. The same person in two groups of the same type.** A member joins two Tuesday small groups because she likes both. *Decision:* allowed by default with a visible warning to the leader. A group type may set `max_memberships_per_person = 1`; at MVP this only warns, and enforcement ships with the Later per-type settings. Reporting counts the person once in "people in groups" and twice in "group seats filled" — both numbers are labeled.

**E3. A confidential group.** A recovery group meets on Thursday nights; its members' presence is itself sensitive. *Decision:* `confidential = true` removes the group from directories, group lists visible to non-leaders, and all per-person reporting except aggregate counts. Membership is visible only to the group's leaders and to an owner with an explicit grant. Attendance contributes to totals but never to a named list outside the group.

**E4. The leader can see too much.** A well-meaning leader opens a member's profile and finds a pastoral care note and a giving summary. *Decision:* leader permissions are deny-by-default and scoped to their group. Leaders see contact details, attendance, and prayer requests explicitly shared with the group. Giving, care notes, medical flags and household financial data are outside leader scope at every tier, including for co-leaders.

**Data captured**

| Entity | Fields that matter |
|---|---|
| Group type | name, default leader permission set, default custom fields, max memberships, color |
| Group | tenant, campus, type, name, description, meeting pattern, location, capacity, visibility, confidential, start/end, status |
| Group membership | group, person, role, status, joined_at, left_at, leave_reason, added_by |
| Group meeting | group, occurrence, topic, notes, attendance_taken_at |
| Join request | group, person, message, status, decided_by, decided_at |
| Group leader | group, person, since, training_completed_at (later) |

## 2.3 Attendance and children's check-in

**Purpose.** Know who showed up — or deliberately choose not to know — and get every child into a room and back to the right adult without a paper tag.

Two attendance modes exist and are never blended: **headcount** (a number, for adult services where tracking individuals is inappropriate) and **roster** (per-person records, for groups, classes and children).

**Key user stories**

| ID | Story |
|---|---|
| ATT-1 | As a parent, I can check in three children in under a minute using my phone number or last name. |
| ATT-2 | As a check-in volunteer, I can print a child label and a matching guardian tag, and reprint one when the printer jams. |
| ATT-3 | As a parent, I can pre-check-in before I arrive and show a single QR code at the kiosk. |
| ATT-4 | As a kids small-group leader, I see my room roster with allergy flags and the list of adults allowed to collect each child. |
| ATT-5 | As a check-out volunteer, I verify the code and record who collected the child. |
| ATT-6 | As the children's pastor, I see attendance by service, room and age group, and the ratio of children to leaders. |
| ATT-7 | As the administrator, I can correct a mistaken check-in after the fact with a reason, and the correction is audited. |
| ATT-8 | As a greeter, I can record a headcount for the adult service without identifying anyone. |

**MVP**

- Web kiosk on a tablet, locked to one campus and one check-in mode; lookup by phone, last name, or pre-check-in QR.
- Family check-in: select children, confirm guardians, assign rooms by age/grade rule, print child label and guardian tag(s).
- Security code: four characters, unique per child per occurrence, printed on both labels.
- Check-out by code match, or by an authorized adult with staff override and reason; unclaimed-children list at occurrence close.
- Room roster with allergy/medical flag, authorized pickup list, and leader view.
- Attendance records with source (kiosk, roster, pre-check-in, paper, import, correction) and check-in/out timestamps.
- Headcount mode for adult services, entered by a volunteer or staff member.
- Manual correction with reason, actor and timestamp; occurrence attendance summary.
- Pre-check-in from the member portal (QR), valid for one occurrence.

**Later**

- Offline kiosk with local roster cache and sync; teacher tablets; automated ratio alerts; one-time pickup codes for non-guardians; guardian photo verification; special-needs support flags and shadow-volunteer assignment; check-in from the mobile app with push; volunteer check-in; attendance import from handheld counters; geofenced self check-in.

**Edge cases**

**E1. Security code reuse across services.** A child attends the 9:00 service, goes home, and returns for the 11:00 family service; another child in the same room has the same initials. *Decision:* codes are generated per child **per occurrence**, never per family and never per day, four characters from a 32-character alphabet with ambiguous characters removed (no O/0, I/1). Uniqueness is enforced within a room for the active occurrence, and every code expires at occurrence close. Pre-printing labels for two services is supported by generating at print time, not at pre-check-in.

**E2. Guardian mismatch at pickup.** A tag is lost; a grandmother arrives who is not on the list; a divorced father is flagged "not authorized" by the custodial parent. *Decision:* check-out succeeds by code match, or by an adult on the authorized list. Otherwise a staff override is required, with the staff member's identity, the reason, and the override recorded in a security log. A guardian explicitly flagged `denied_pickup` (court order) cannot be overridden by anyone below campus admin, and the record shows the legal document reference. Every override appears in a daily exception digest to the children's pastor.

**E3. Offline at 9:55 on Sunday.** The church Wi-Fi drops with 40 children still to check in. *Decision (MVP):* the kiosk is network-dependent. At T-30 minutes the system automatically prints a paper fallback roster per room — expected children, allergy flags, authorized adults — and check-ins during an outage are recorded on paper and entered within 24 hours as `source = paper`. Full local-cache sync is Wave 2; pretending to support offline before conflict resolution is designed would create duplicate check-ins and false security.

**E4. Allergy and medical data are health data.** A five-year-old has a severe peanut allergy and an EpiPen in her bag. *Decision:* flags are structured (allergen, severity, action, medication location) plus a free-text note, visible only to users with `kids_roster` permission at that campus, printed on the child label and the room roster. They never appear in email, SMS, exports to non-kids roles, or the member directory. Access to the free-text note is logged. Flags purge 12 months after the child's last check-in unless a legal hold applies.

**Data captured**

| Entity | Fields that matter |
|---|---|
| Occurrence | event, campus, room(s), start/end local and UTC, status (scheduled/cancelled/closed) |
| Attendance record | person, occurrence, status (present/absent/unknown/excused), source, checked_in_at/by, checked_out_at/by, note |
| Check-in | child, occurrence, room, code, guardian_person, label_prints, checked_out_by, override_reason, staff_id |
| Medical flag | person, allergen, severity, action, medication_location, free_text, visibility, updated_by, expires_at |
| Authorized pickup | child, adult, source (guardian/household/manual), allowed or denied, document_ref |
| Room | campus, name, capacity, age_min/max, grade_min/max, features |
| Security incident | occurrence, child, description, reported_by, action_taken, at |

## 2.4 Events, rooms and resource booking

**Purpose.** Put the right event in the right room at the right time, and stop double-booking, without becoming a facilities ERP.

**Key user stories**

| ID | Story |
|---|---|
| EVT-1 | As the administrator, I can create a recurring Sunday service with its rooms and teams on one screen. |
| EVT-2 | As the administrator, I can see a week view by room and by ministry. |
| EVT-3 | As a ministry leader, I am blocked from booking an occupied room and can see what is in it. |
| EVT-4 | As the administrator, I can take a one-off room request for a wedding and approve or decline it. |
| EVT-5 | As the administrator, I can cancel a single occurrence without deleting the series. |
| EVT-6 | As a member, I can subscribe to the church calendar from my phone. |
| EVT-7 | As the office manager, I can add setup and teardown time so the room is not double-booked at 8:00. |

**MVP**

- Event templates with recurrence (weekly, every-n-weeks, monthly by weekday), start/end, campus, owner, default rooms, visibility.
- Occurrences materialized 12 months ahead; per-occurrence edit, cancel, notes.
- Rooms with campus, capacity, features, blackout windows.
- Conflict detection including a configurable buffer and setup/teardown padding; hard block for non-admins, warning with logged reason for admins.
- Room requests with one-step approval.
- Week and day calendar by room and by ministry; public ICS feed per campus.

**Later**

- Resource inventory with quantities (tables, chairs, AV kits, trailers) and per-occurrence booking; multi-room bookings; approval chains; external rental agreements and invoicing; room utilization analytics; seat maps; two-way Google Calendar sync; registration and ticketing (a separate module, deliberately not folded in here).

**Edge cases**

**E1. A recurring series with one exception.** Christmas Eve falls on a Sunday and the normal 9:00/11:00 pattern must change once. *Decision:* occurrences are real rows. Editing a series prompts "this occurrence / this and future / all". A cancelled occurrence keeps its record with status `cancelled` so room history and attendance history stay coherent — cancellations are never deletions.

**E2. A shared space with an external user.** The gym is used by a school on weekday mornings and by the church on Sundays. *Decision:* rooms can be flagged `shared_external` with blackout windows that behave as hard conflicts. Blackouts are visible on the calendar so nobody plans around a room that is not actually free. Admin override remains possible with a reason, because real churches break their own rules.

**E3. Setup and teardown are real occupancy.** A wedding books the auditorium 2:00–4:00 but the band loads in at 11:00 and the room is unusable until 6:00. *Decision:* bookings carry `setup_min` and `teardown_min`; conflict detection uses the padded window; the calendar displays the padded block, while the event displays its public times. Defaults come from the room, overridable per booking.

**E4. Daylight saving.** A 9:00 service must stay 9:00 in local time when clocks change, and a 2:00am recurrence does not exist on one Sunday a year. *Decision:* recurrence is computed in campus local wall time and then converted to UTC per occurrence; both values are stored. A nonexistent local time is skipped with a warning at series creation; an ambiguous local time resolves to the first occurrence and is flagged in the series audit.

**Data captured**

| Entity | Fields that matter |
|---|---|
| Event | tenant, campus, name, type, description, owner, recurrence rule, default rooms, visibility, status |
| Occurrence | event, start_local, end_local, start_utc, status, notes, expected_headcount |
| Room | campus, name, capacity, features, setup/teardown defaults, blackout windows, shared_external |
| Booking | occurrence, room, padded start/end, status, approved_by, override_reason |
| Room request | requester, purpose, preferred room, date/time, status, decided_by |

## 2.5 Giving

**Purpose.** Record every gift to the right fund and donor, reconcile it to the bank, and produce statements the treasurer will sign without hesitation.

Processing model: the church is the merchant of record through a connected processor account; the platform never touches card data and stores only a token, brand, last four and expiry ([Stripe security guide](https://docs.stripe.com/security/guide), accessed 2026-10-29). Bank transfer (ACH) and card at MVP; cash and check by batch entry.

**Key user stories**

| ID | Story |
|---|---|
| GIV-1 | As a donor, I can give once by card or bank transfer in under a minute without creating an account. |
| GIV-2 | As a donor, I can set a recurring gift and later change the amount or the card without calling the office. |
| GIV-3 | As the treasurer, I can enter Sunday's counted cash and checks as a batch that must balance before it posts. |
| GIV-4 | As the treasurer, I can reconcile a processor payout, net of fees, against the gifts it contains and the bank deposit. |
| GIV-5 | As finance, I can split one gift across two funds without creating two gifts. |
| GIV-6 | As a donor, I can pledge to the building fund and see progress against my pledge. |
| GIV-7 | As finance, I can generate annual statements as PDF and email, and know exactly what each donor received. |
| GIV-8 | As the lead pastor, I can see giving by fund and week without seeing individual donors. |

**MVP**

- Funds with code, restriction type, campus scope, active dates and optional goal.
- Gifts with method (card, ACH, cash, check, other), date, donor person and/or household, memo, anonymity, source, processor transaction id; split allocations that must sum to the gift.
- Hosted giving page per campus and fund; one-time and recurring; optional donor-covered fees.
- Batches: counted cash/checks with a two-person control (entered by, verified by), expected vs actual total, balance gate before posting, deposit reference. Loose cash with no envelope posts as an "unidentified cash" line against a holding fund, never against an invented person; later attribution is an audited reallocation that preserves the original line.
- Processor payout import with fee, refund and chargeback lines; reconciliation view per payout; variance threshold and exception task.
- Refunds and reversals as new records; posted gifts immutable.
- Pledges: donor, campaign, fund, amount, period, frequency; progress = allocations to that fund within the period.
- Annual and period statements as PDF, email or print list; regeneration for closed years; delivery log.
- Giving history and recurring-gift self-service in the portal; CSV export; historical contribution import from a prior system.

**Later**

- Public campaign pages with progress thermometers; text-to-give; kiosk giving; stock, DAF and crypto gifts; in-kind gifts; matching gifts; accounting sync (QuickBooks/Xero); multi-currency; per-gift receipts; check scanning; missionary support accounts; negative-restriction alerts; donor-advised fund imports.

**Edge cases**

**E1. Pledge versus actual.** A donor pledges $6,000 for the building fund over 12 months, gives $7,200, and also gives $400 to the same fund outside the campaign. *Decision:* a pledge is a commitment and never revenue. Progress counts only gifts allocated to the pledge's fund with a gift date inside the pledge period, and a gift counted toward one pledge cannot count toward another. Anything above the pledge is shown separately as "above pledge", not silently absorbed. A household pledge attributes to the household; statements still list the individual donors.

**E2. Recurring gift with an expired card.** A monthly giver's card expires; the first attempt fails on a Thursday. *Decision:* the failure webhook starts a dunning sequence — retry at D+1, D+3, D+7, with an email and SMS carrying a tokenized update link that needs no login. Staff are alerted after the second failure; the schedule pauses after the final failure but is never deleted. Failed attempts appear in the donor timeline and in a monthly "recurring at risk" figure, because silent attrition is the real cost.

**E3. Payout does not equal gifts.** The processor deposits $4,182.10 on Monday for gifts totaling $4,310.00 given Friday to Sunday. *Decision:* reconcile at payout level, not per gift: expected = gross gifts in the payout − fees − refunds. Timing differences are never variance; the payout carries its gift IDs, and gifts not yet paid out sit in "in transit". A variance above $0.50 or 0.5% opens an exception task with the payout attached. The bank deposit is matched to the payout, not to individual gifts.

**E4. A statement that actually substantiates a $250 gift.** Finance sends an annual summary that shows only a yearly total per donor. *Decision:* a conservative reading of Publication 1771 — an annual summary may substantiate several gifts of $250 or more only if it identifies each amount — means the statement lists every gift with date and amount plus fund, not just a total. It carries the "no goods or services were provided" statement, the quid pro quo description where goods were given, and the intangible-religious-benefits wording where that applies ([IRS Publication 1771](https://www.irs.gov/pub/irs-pdf/p1771.pdf), accessed 2026-10-29). A stored copy of what was sent, with timestamp and recipient address, is retained. January 31 is the conventional sending date, not a statutory deadline — the legal test is receipt before the donor files.

**Data captured**

| Entity | Fields that matter |
|---|---|
| Fund | code, name, restriction (unrestricted/temporarily/designated), campus scope, active from/to, goal |
| Gift | donor person, donor household, gift_date, method, amount, currency, processor txn id, status (pending/settled/refunded/void), memo, anonymous, source |
| Allocation | gift, fund, amount — sum must equal gift amount |
| Batch | campus, date, type (counted cash/check or payout), entered_by, verified_by, expected_total, actual_total, deposit_ref, status |
| Pledge | donor, campaign, fund, amount, start, end, frequency, status |
| Recurring gift | donor, amount, fund, schedule, payment method, next_run, failures, status, paused_reason |
| Payment method | processor token, type, brand, last4, expiry, holder, status |
| Statement | recipient, period, generated_at, delivery method, copy_ref, corrected flag |
| Reconciliation | payout id, processor gross, fees, refunds, expected net, bank deposit, variance, status, resolved_by |

## 2.6 Communications

**Purpose.** Get the right message to the right people on the channel they consented to, and be able to prove the consent afterwards.

Two purposes exist and are tagged on every send: **operational** (receipt, schedule change, check-in code, a staff member's follow-up) and **marketing** (newsletter, campaign, event promotion). They have different consent, suppression and quiet-hour rules.

**Key user stories**

| ID | Story |
|---|---|
| COM-1 | As the communications lead, I send a weekly email to everyone who opted in, using a saved template. |
| COM-2 | As the children's pastor, I text 40 parents about a room change in under five minutes. |
| COM-3 | As the office manager, I build a segment ("parents of 3rd–5th graders who attended twice in six weeks") and reuse it next month. |
| COM-4 | As the sender, I see delivered, opened, clicked, bounced and unsubscribed counts per message. |
| COM-5 | As a recipient, I can unsubscribe from marketing email and still receive my giving receipts and serving reminders. |
| COM-6 | As the office manager, I email six people directly without creating a campaign. |
| COM-7 | As the administrator, I can see why a message failed — bounce, no consent, bad number, carrier block. |
| COM-8 | As the sender, I preview the exact SMS with merge fields filled in before it goes. |

**MVP**

- Email through one provider, sent from a tenant sending domain with a guided SPF/DKIM/DMARC setup and verification status.
- Templates with merge fields and a plain-text fallback; test send; schedule; per-recipient status; basic analytics; audience export.
- Segments: saved filters on person, household, group, attendance, stage, campus and custom fields. Giving data is excluded from segmentation at MVP.
- Preference center: per-channel, per-purpose toggles; one-click unsubscribe that needs no login.
- SMS through a registered 10DLC brand and campaign per tenant; STOP/HELP handling; quiet hours for marketing (no sends 21:00–08:00 local); per-message cost estimate before send.
- Consent ledger: person, channel, purpose, state, source, timestamp, IP, wording version. Suppression list for hard bounces, complaints and STOP.
- Send-time de-duplication by person and by normalized address.

**Later**

- Two-way SMS inbox with assignment; A/B subject testing; dynamic content blocks; push notifications; WhatsApp; segmentation on giving history; deliverability reputation dashboard; dedicated IP; recurring newsletter series; per-campus sender identities; message approval workflows.

**Edge cases**

**E1. Consent belongs to a person, but the inbox belongs to a household.** Mark and Jane share `markjane@example.com`; Jane unsubscribes. *Decision:* consent rows are per person per channel per purpose, but suppression is applied at address level, because an unsubscribe cannot be un-shared. The UI warns before the action: "This stops email to both Mark and Jane at this address." SMS consent is separate and requires a recorded opt-in source — form, keyword, or a paper card with a date — because US carriers require documented consent for application-to-person messaging ([Twilio A2P 10DLC documentation](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc), accessed 2026-10-29). A STOP reply is written to suppression before the next send batch is assembled, affects SMS only, and cannot be removed by staff — only by a new, recorded opt-in.

**E2. Unsubscribe versus the messages people actually need.** A member unsubscribes from everything, then complains he did not get his giving statement. *Decision:* operational and marketing are separate streams with separate toggles, explained in plain language in the preference center. Marketing honors an unsubscribe immediately. Operational messages are capped, never bulk-scheduled to the whole list, and always attributable to a specific transaction or a named staff member. A global "do not contact" still blocks operational email except receipts and legally required notices, and the UI says so before it is set.

**E3. Duplicate sends from duplicate records.** The same family exists twice, both in the audience, and receives the newsletter twice. *Decision:* at send time, de-duplicate on person ID and on normalized email and phone. If two person records share an address, send once and log the merge with both person IDs. The delivery report shows "3 duplicates suppressed" so the sender trusts the number.

**E4. Deliverability when two hundred churches share a platform.** One church imports a purchased list and starts bouncing. *Decision:* every tenant sends from its own subdomain or a verified custom domain; Reply-To is the church office; hard bounces and complaints auto-suppress; a tenant whose complaint rate exceeds 0.1% is throttled and warned in-app before the shared IP reputation is damaged. SMS sending is blocked until 10DLC brand and campaign registration clears, with the registration status visible to the admin rather than hidden behind a generic failure.

**Data captured**

| Entity | Fields that matter |
|---|---|
| Message | channel, purpose, subject, body, template, sender identity, audience definition, scheduled_at, status, cost estimate, created_by |
| Recipient | message, person, address used, status, provider id, delivered/opened/clicked at, bounce reason, suppressed reason |
| Template | name, channel, body, merge fields, version, updated_by |
| Segment | name, filter definition, last count, owner, shared flag |
| Consent record | person, channel, purpose, state, source, source_detail, captured_at, ip, wording_version |
| Suppression | address or person, channel, reason (stop/bounce/complaint/manual), since, evidence |
| Sender identity | domain, from name, reply-to, verification status, SMS number, 10DLC brand/campaign status |

## 2.7 Volunteer scheduling and service planning

**Purpose.** Fill every slot for every service, let volunteers manage their own swaps, and give the worship team a run sheet that is current.

**Key user stories**

| ID | Story |
|---|---|
| SCH-1 | As the service coordinator, I build a plan with positions and counts ("Greeter ×2", "Kids leader ×3") and their call times. |
| SCH-2 | As the coordinator, I assign people from a list filtered by team, availability and clearance. |
| SCH-3 | As a volunteer, I accept or decline from a text link without logging in. |
| SCH-4 | As a volunteer, I request a swap; a teammate claims it; the leader approves in one tap. |
| SCH-5 | As the coordinator, I see unfilled positions seven days out and send a targeted ask to the right team. |
| SCH-6 | As a volunteer, I set blockout dates so I am not asked when I am away. |
| SCH-7 | As the worship leader, I publish a setlist with keys, order and links that the team can see on Sunday. |
| SCH-8 | As the coordinator, I mark who actually served, and no-shows feed a reliability view. |

**MVP**

- Plan per occurrence: service name, call time, notes, status (draft/published).
- Positions with role name, count, start/end, team, `requires_clearance` flag.
- Assignments with status (asked, accepted, declined, confirmed), asked_at, responded_at, source.
- Reminders at T-7 days, T-2 days and T-2 hours, per volunteer preference.
- Tokenized accept/decline and swap links that require no account.
- Per-team swap board: volunteer posts, teammate claims, leader approves or rejects.
- Team rosters, blockout dates, availability notes, and a "do not ask" period after a decline.
- Setlist items (order, title, key, tempo, link, notes) and a run-sheet view; PDF export with version stamp.
- No-show marking, fill-rate and no-show-rate reporting; ICS feed for each volunteer.

**Later**

- Auto-suggested assignments; max servings per period enforced; multi-week plan templates; rehearsal scheduling; file attachments and chord charts; live run sheet with countdown; volunteer hours export; background-check integration; volunteer check-in at the door; cross-campus substitution marketplace; service-length analytics.

**Edge cases**

**E1. The 8:55 no-show cascade.** The second kids greeter does not arrive; the service starts in five minutes. *Decision:* a no-show is inferred when an assigned volunteer has not checked in ten minutes before call time. That triggers exactly one notification to the team lead with a ranked standby list — same team, currently cleared, not already serving, longest since last served. It does not broadcast to the whole team. If still unfilled five minutes before service, it escalates to the campus staff member on duty. The fill path is logged, and three no-shows in ninety days flags a conversation, not a punishment.

**E2. A swap that puts an uncleared adult in a children's room.** A volunteer swaps into a kids position; their background check expired two months ago. *Decision:* clearance is validated at acceptance, not at request. A volunteer without a current check cannot accept a position flagged `requires_clearance`. Leader override requires a campus admin and is audited, and the plan shows a red "not cleared" badge until resolved. Safety rules that can be clicked away are not rules.

**E3. One person, two positions, one time.** A musician is also scheduled as a small-group leader at 9:00, and the two rooms are a four-minute walk apart. *Decision:* hard block on overlapping assignments for the same person, including across campuses, with a warning for assignments less than 30 minutes apart to account for travel and handover. An exception requires approval from both position owners and is visible on both plans.

**E4. The setlist changed after the team printed it.** The worship leader swaps two songs at 7:40 on Sunday. *Decision:* setlist edits create a new version; only the worship team and plan editors are notified; the printed or exported PDF carries a version number and timestamp; the mobile run sheet always shows the current version with a "changed since you last viewed" banner. Nobody is asked to compare paper to screen.

**Data captured**

| Entity | Fields that matter |
|---|---|
| Plan | occurrence, campus, service name, call time, notes, status, published_at, version |
| Position | plan, team, role name, count, start/end, requires_clearance, location |
| Assignment | position, person, status, asked_at, responded_at, source (staff/self/swap), checked_in_at, no_show |
| Swap request | assignment, requested_by, reason, claimed_by, approved_by, status, decided_at |
| Availability | person, date range, type (blockout/available), note, recurrence |
| Team | name, campus, leader(s), members, default positions |
| Setlist item | plan, order, title, key, tempo, link, notes, version |
| Clearance | person, type (background check/training), status, expires_at, verified_by |

## 2.8 Pastoral care and follow-up

**Purpose.** Make sure nobody falls through — visits, crises, prayer — with confidentiality that is explicit rather than assumed.

The design assumption: care notes are the most sensitive data in the product, and in some jurisdictions religious belief and health information are special-category data that require a specific legal basis and tight disclosure rules ([GDPR Article 9](https://gdpr-info.eu/art-9-gdpr/), accessed 2026-10-29). The product must behave as if a note could be read aloud in court.

**Key user stories**

| ID | Story |
|---|---|
| CAR-1 | As a pastor, I can log a hospital visit with date, visitor and a private note. |
| CAR-2 | As a pastor, I see my open cases sorted by urgency and last contact, so nobody waits a month. |
| CAR-3 | As a member, I can submit a prayer request and choose who may see it. |
| CAR-4 | As a care lead, I can move a case through stages with due dates and an owner. |
| CAR-5 | As a pastor, I can mark a case confidential so only named people can open it, and every view is logged. |
| CAR-6 | As a care lead, I can reassign a departing staff member's cases without losing their history. |
| CAR-7 | As a member, I can request a copy of what the church holds about me. |
| CAR-8 | As a welcome volunteer, I get a task when a first-time guest asks for a follow-up visit. |

**MVP**

- Care cases: one or more people, type (visit, hospital, bereavement, counselling referral, financial assistance, safeguarding, other), stage (new → triaged → assigned → active → closed), owner, urgency, due date, campus, opened/closed dates, close reason.
- Three confidentiality tiers: staff-only, named case team, pastoral team. Default on creation is staff-only. Notes may be escalated upward, never de-escalated by their author.
- Care notes with author, occurred_at, body, attachments, visibility; visit log with visitor, date, location, duration.
- Prayer requests: submitter, body, visibility (pastors only / prayer team / group / public), expiry, approval for public sharing, permission attestation.
- Tasks with assignee and due date; reminders; case activity timeline; access log for confidential cases.
- Search restricted to permitted users; person-level data export for an access request.

**Later**

- Per-type pipelines with SLAs; volunteer care teams with limited scope; visit scheduling and route planning; email-to-case; SMS wellbeing check-ins; outcome tracking; counselling referral directory; benevolence approvals with financial controls; case-load dashboards per pastor; safeguarding workflows with legal hold; multilingual care notes.

**Edge cases**

**E1. Confidentiality versus need to know.** A staff member discloses a marriage crisis; the senior pastor should know, the office manager should not. *Decision:* visibility is an explicit list plus a tier, not a role hierarchy. Platform administrators cannot read care notes unless they are on the case team — administration of the system and access to its most sensitive content are separated. Reads are logged and the person on the case can see who read it. This is deliberately inconvenient: the alternative is a system nobody confesses into.

**E2. A prayer request that names a third party.** "Please pray for my husband, he is having an affair." *Decision:* the submitter must attest that they have permission to share the content. Requests naming another adult are held for staff review before reaching a prayer team, and public sharing always requires staff approval. Requests expire by default after 30 days, are excluded from search indexing, and are never included in bulk exports.

**E3. A disclosure of abuse or risk of harm.** A teenager discloses abuse during a conversation logged as a care note. *Decision:* case types `safeguarding` and `risk` display a mandatory-reporting banner with the church's own policy and the local reporting route, and cannot be closed without a documented action and reviewer. These cases are excluded from ordinary exports, cannot be deleted, and can only be exported by an owner with a logged reason. The software does not give legal advice and must not imply confidentiality it cannot legally keep.

**E4. Staff turnover and the "forget me" request.** A pastor leaves; six months later a former member asks for everything held about them. *Decision:* reassignment transfers cases and tasks in bulk, preserves note authorship, and revokes access on deactivation within the same minute. A deletion request is reviewed by a human: free text is redacted, a minimal record (case existed, type, dates, decisions) is retained for legal and insurance purposes, and the decision is logged. Financial records are never deleted on request; they are anonymized only where law allows.

**Data captured**

| Entity | Fields that matter |
|---|---|
| Care case | people, type, stage, owner, urgency, campus, opened_at, due_at, closed_at, close_reason, confidentiality tier, access list |
| Care note | case, author, occurred_at, body, visibility, attachments, edited_at |
| Visit log | case, visitor, date, location, duration, summary |
| Prayer request | submitter, body, visibility, permission_attested, approved_by, expires_at, status |
| Care task | case, assignee, due_at, status, completed_at |
| Access log | case, user, action (view/edit/export), at, ip |

## 2.9 Workflows and automation

**Purpose.** Do the follow-up a church intends but forgets — with templates, not a general-purpose automation builder.

**Key user stories**

| ID | Story |
|---|---|
| WF-1 | As the welcome lead, when a first-time guest submits a connection card, I want a thank-you sent within 24 hours and a visit task created. |
| WF-2 | As the lead pastor, when a guest returns within 30 days, I want to be told and the person moved to "returning guest". |
| WF-3 | As a group leader, when someone joins my group, I want their contact details without asking the office. |
| WF-4 | As the office manager, I want a birthday greeting sent — to the guardian, for minors. |
| WF-5 | As a group leader, when a regular attender misses three weeks, I want a care task, not a guilt trip. |
| WF-6 | As the office manager, I can pause all automation for one person who asked not to be contacted. |
| WF-7 | As the administrator, I can see every message a workflow sent and why it fired for that person. |
| WF-8 | As the administrator, I can test a workflow against a fake person before enabling it. |

**MVP**

- Five prebuilt templates: first-visit follow-up, second-visit alert, new-member journey, birthday greeting, three-week absence.
- Each template exposes timing, message body, owner and on/off — no canvas, no branching.
- Triggers: person created (form or import), attendance recorded, stage changed, group joined.
- Actions: send email, send SMS, create task, assign care case, add tag, notify staff.
- Per-person suppression, global do-not-contact, per-run log with the reason it fired or was suppressed, test mode against a synthetic person.
- Idempotency per (workflow, person, trigger key); one active run per person per workflow; delays computed in campus time.

**Later**

- Visual builder with branching and goals; webhooks and custom events; A/B steps; re-enrollment rules; workflow analytics and conversion; giving-triggered journeys; API-triggered workflows; multi-channel sequences including push.

**Edge cases**

**E1. Late and duplicate triggers.** A 1,200-person import lands on a Thursday; every record looks like a "new person" and 1,200 welcome emails prepare to send. *Decision:* imports set `suppress_workflows = true` by default, with an explicit opt-in per import. Runs are idempotent on (workflow, person, trigger_key), so a retried webhook cannot send twice. A person who enters the same workflow twice inside its run window is suppressed, and the log says which rule suppressed them.

**E2. Absence triggers in a church that meets less often than it thinks.** Three "missing weeks" fires during a holiday break, or for a person who attends a different campus now. *Decision:* absence is measured against the person's own baseline (attended at least three of the last eight tracked occurrences) and counts missed *tracked* occurrences, not calendar weeks. The church calendar can mark blackout weeks. A campus change resets the baseline. A person with an open bereavement case never gets an absence task — that is what a care system is for.

**E3. Birthdays for minors and for the deceased.** A child's birthday triggers a message to the child's own email; a member died last month. *Decision:* under-18 birthdays route to guardians only, never to the child. `deceased` status excludes a person from every workflow in the same transaction that sets it. A do-not-contact flag excludes marketing but still permits internal care tasks, because "do not email me" is not "do not care for me".

**E4. Automation that becomes spam.** Five templates, one enthusiastic church, and a new family receives four automated messages in nine days. *Decision:* a per-person cap of two automated marketing touches per 14 days across all workflows, enforced at send time and shown as the suppression reason in the run log. Operational messages are exempt but must be attributable to a transaction. Every automated message carries a one-click "stop these" that writes a consent record rather than a hidden preference.

**Data captured**

| Entity | Fields that matter |
|---|---|
| Workflow | name, template key, trigger, conditions, steps, status, owner, version |
| Step | order, delay, action type, template, assignee rule |
| Run | workflow, person, trigger key, started_at, status, current step, suppressed reason |
| Action | run, step, executed_at, result, message id, task id |
| Do-not-contact | person, scope (all/marketing/channel), reason, since, set_by |

## 2.10 Reporting and dashboards

**Purpose.** Answer the ten questions staff and boards actually ask, with one agreed definition behind each number.

**Key user stories**

| ID | Story |
|---|---|
| REP-1 | As the lead pastor, I open a Monday "this week" view with attendance, guests, giving and open care cases. |
| REP-2 | As the administrator, I compare this Sunday to the same Sunday last year, and can exclude Easter. |
| REP-3 | As finance, I see giving by fund against budget and pledge progress against commitments. |
| REP-4 | As the board, I receive a one-page monthly PDF without asking anyone for it. |
| REP-5 | As a group leader, I see my group's attendance and who has missed three weeks. |
| REP-6 | As the coordinator, I see volunteer fill rate and no-show rate by team. |
| REP-7 | As an analyst, I can export the rows behind a chart, not just the chart. |
| REP-8 | As a new staff member, I can read what "attender" means in this system before I argue about a number. |

**MVP**

- Five dashboards: This Week; Attendance; Giving; Groups and Volunteers; New People funnel.
- Fixed ranges (this week, last 4/12 weeks, year to date, custom) with comparison to previous period and same period last year.
- Campus filter; drill-through from any number to the underlying list; CSV export of that list.
- Metric dictionary page, editable by the owner, linked from every chart's info icon.
- Scheduled monthly PDF pack to named recipients; snapshots are immutable once sent.
- Separate fiscal-year (budget and board reporting) and tax-year (donor statements) settings.

**Later**

- Custom report builder and saved reports; cohort retention curves; giving forecasts; demographic breakdowns; anonymized peer benchmarks; scheduled delivery to Slack/Teams; warehouse sync; embedded charts in email; per-leader dashboards.

**Edge cases**

**E1. Three different "attendance" numbers.** The pastor says 240, the kids director says 61, and the board paper says 289. *Decision:* three metrics exist and are never blended — `headcount` (manual count, adult services), `checked_in` (per-person records), `unique_attenders` (distinct people in a period). Every chart states which one it uses. Defaults: kids and groups use `checked_in`, adult services use `headcount`; a church that tracks adults individually can switch. Volunteers are excluded from `unique_attenders` by default and the dictionary says so.

**E2. Two year boundaries that disagree.** A gift arrives on 5 January and belongs to the previous fiscal year but the new tax year. *Decision:* fiscal year and tax year are independent settings; a gift carries its own date and is assigned to each boundary by rule, and every report prints which boundary it used. Pledges carry their own period, which may match neither.

**E3. Numbers change after the fact.** A gift is reallocated, a check-in is corrected, and last month's board pack now disagrees with the live dashboard. *Decision:* live reports are computed from current data and stamped `as_of`; a material change since the last view is flagged. Sent board packs are snapshotted and immutable, with a link to the live equivalent. Finance can always reproduce a closed period exactly, which matters more than the dashboard being pretty.

**E4. Small cells leak information.** A "giving by household" chart on a campus of 40 effectively publishes individual donations. *Decision:* any cell with fewer than five people is suppressed or rolled up, and giving is never visualized per household. Giving totals are visible only to finance roles. A leader sees their group's attendance counts but never a comparative giving view, even anonymized.

**Data captured**

| Entity | Fields that matter |
|---|---|
| Metric definition | key, display name, formula, inclusions, exclusions, owner, version, updated_at |
| Dashboard | name, role visibility, default range, widgets, campus scope |
| Report run | report key, parameters, as_of, generated_by, output ref, row count |
| Snapshot | period, payload hash, recipients, sent_at, immutable flag |
| Export job | user, query, entity, row count, at, ip |

## 2.11 Member self-service portal and mobile app

**Purpose.** Let a member do the six things they actually want, on a phone, without installing anything.

**Key user stories**

| ID | Story |
|---|---|
| SS-1 | As a member, I update my address once and the office sees the change. |
| SS-2 | As a donor, I see my giving history and download last year's statement. |
| SS-3 | As a recurring donor, I pause or change my gift without calling anyone. |
| SS-4 | As a parent, I pre-check my children in and show one QR code on Sunday. |
| SS-5 | As a member, I find my group's meeting time and message my leader. |
| SS-6 | As a volunteer, I see when I am serving and decline with a reason. |
| SS-7 | As a member, I choose which channels the church may use and for what. |
| SS-8 | As a member, I opt in or out of the directory and choose which fields are visible. |

**MVP**

- Magic-link login by email or SMS, optional password; sessions scoped to one device; fresh link required for giving and care pages.
- Profile and household editing; contact changes apply immediately with an audit entry; relational changes (removing an adult, changing a child's name) create a staff review task.
- Giving history, downloadable statements, recurring gift management through a processor-hosted card update page.
- Pre-check-in with a single QR per family, valid for one occurrence.
- My groups (roster, meeting details and group messages), my serving schedule with accept/decline and blockout dates.
- Notification preferences and unsubscribe; directory opt-in with per-field visibility; prayer request submission with audience choice.
- Installable PWA (home-screen icon, offline shell), no app store dependency.

**Later**

- Native iOS/Android apps; push notifications; in-app giving with saved methods; group chat; event registration and payment; photo directory; kids' curriculum and progress; language switcher; family calendar; sermon notes; volunteer self check-in; giving pledges and campaign pages.

**Edge cases**

**E1. One login per household or per person.** A family shares one email address; both spouses want access; the children are 6 and 9. *Decision:* accounts are per person. A shared address is allowed on two accounts, but magic links are single-use and expire in 15 minutes, and sensitive pages re-authenticate. Children under 13 have no account; guardians manage them. A household is never a login, because shared credentials are how giving histories leak.

**E2. Divorced parents.** Both parents want to see their child's check-in status; neither wants the other to see their giving or address. *Decision:* each adult keeps their own account, their own giving, and their own contact visibility. Both see the child's profile and pickup authority through separate guardian links; neither sees the other's giving, address or care notes. The child's primary household sets the directory address, and either parent can suppress it.

**E3. A member edit that affects someone else.** A member "corrects" the household by removing her mother-in-law, or changes a child's surname after a remarriage. *Decision:* relational and identity fields (household membership, legal name, date of birth, guardianship) go to a staff review queue and only apply after approval. Contact fields apply immediately. A member can never remove another adult from a household, and the review task shows a field-level diff.

**E4. Directory privacy and children.** A new family is listed in the directory by default; their address and two mobile numbers are visible to the whole church. *Decision:* directory listing is opt-in per person and off by default for children. Visibility is per field (hidden / church staff / directory). A child's photo needs separate photo consent. The directory never exposes giving, attendance, care notes or medical flags. Hiding from the directory does not remove someone from staff view, and that read is logged.

**Data captured**

| Entity | Fields that matter |
|---|---|
| Account | person, email, phone, auth method, last_login, mfa_state, status |
| Session | account, device, issued_at, expires_at, revoked_at |
| Profile change request | person, field, old value, new value, status, reviewed_by, reviewed_at |
| Directory preference | person, listed, field visibility map, photo consent |
| Notification preference | person, channel, category, state, updated_at |
| Pre-check-in | occurrence, household, children, qr token, used_at, expires_at |

## 2.12 Administration

**Purpose.** Make the platform safe to hand to a volunteer at 8am — roles, imports, audit and settings that do not require a support ticket.

**Key user stories**

| ID | Story |
|---|---|
| ADM-1 | As the owner, I invite a staff member and give them finance access without giving them care notes. |
| ADM-2 | As the administrator, I import 1,200 people from a CSV and see, before committing, what will be created, matched or skipped. |
| ADM-3 | As the administrator, I can roll back an import that went wrong. |
| ADM-4 | As the owner, I see who changed a person's address, when, and from what. |
| ADM-5 | As the administrator, I configure campuses, service times, rooms and funds without contacting support. |
| ADM-6 | As the owner, I deactivate a departing staff member and their sessions end immediately. |
| ADM-7 | As the administrator, I export everything for a data request or a move to another system. |
| ADM-8 | As the owner, I can see every export of confidential data and who made it. |

**MVP**

- Tenant settings: name, logo, timezone, locale, fiscal year start, retention defaults, support-access toggle.
- Campuses with address, timezone and service times.
- Users, six preset roles, campus scope per assignment, invite/resend/deactivate, immediate session revocation.
- CSV import with column mapping, normalization, dedupe preview, per-row action (create/match/skip), error report with row numbers, commit, and a 7-day compensating rollback.
- Entity exports (people, households, groups, attendance, gifts, messages) with permission checks and export audit.
- Audit log with filters by actor, object type, date and action; CSV export; immutable.
- Admin for custom fields, funds, rooms, service times, templates; email domain and SMS registration status; retention settings.
- Permission matrix view that answers "who can see giving?" in one screen.

**Later**

- SSO/SAML and SCIM provisioning; custom role builder with granular permissions; field-level permissions; approval workflows for permission changes; tenant API keys and webhooks; sandbox environment; white-label domains; usage analytics; self-service billing; configuration export between tenants; data residency options.

**Edge cases**

**E1. Campus-scoped permissions.** A campus admin in the north campus can see a family who attends both campuses, and can see their giving. *Decision:* permissions are `(role, campus_scope, module, action)`. Access is granted, never inferred from a person's home campus. A person who attends two campuses is visible to both campus admins for people and groups; their gifts are visible only to finance roles scoped to the campus of the gift. Cross-campus reporting requires an org-level role. Permissions are evaluated per request, never cached in a long-lived session token, so removing a volunteer from the kids team takes effect on their next tap, not their next login. At MVP, with one campus, the same code path runs with scope "all" so multi-campus is a configuration change, not a rewrite.

**E2. Platform support inside a tenant.** A support engineer needs to see why an import failed, in a tenant holding care notes. *Decision:* support access is off by default, granted by a tenant owner for a fixed window with a stated reason, displayed as a persistent banner, and written to the tenant's own audit log with actor type "platform support". Care notes and giving require a separate, narrower grant. The tenant can revoke mid-session.

**E3. An import that creates 400 duplicates.** A CSV from a previous system has 1,200 rows, inconsistent phone formats and 38 families listed twice. *Decision:* import is staged in a quarantine table; matching runs on normalized email, normalized phone, and name plus date of birth; the preview shows create/match/skip counts and per-row reasons; nothing posts until confirmed. Rollback is a compensating delete limited to rows created by that job, and it refuses if any of those rows have since received a gift, attendance or message — those must be merged instead, because deleting them would destroy real history.

**E4. Deleting a person who has given money.** A former member asks to be erased; they gave $14,000 over eight years. *Decision:* hard delete is blocked whenever gifts, pledges, statements or audit references exist. The UI offers "anonymize" (strip name, contact and address, keep amounts and dates under a pseudonymous ID) or "archive". Anonymization is irreversible and audited. Default retention, configurable and documented as policy rather than law: financial records 7 years, care notes 7 years after closure, attendance 3 years, messages 2 years.

**Data captured**

| Entity | Fields that matter |
|---|---|
| Tenant | name, plan, timezone, locale, fiscal year start, branding, retention policy, support-access state |
| Campus | name, address, timezone, service times, status |
| User | person, email, status, last_login, mfa, invited_by |
| Role assignment | user, role, campus scope (one/set/all), granted_by, granted_at |
| Permission | module, action, sensitivity tier |
| Audit event | tenant, actor, actor type, object type, object id, action, before, after, ip, user agent, at |
| Import job | file ref, mapping, mode, counts (create/match/skip/error), status, created_by, committed_at, rolled_back_at |
| Import row | job, raw payload, matched person, action, error code |
| Support grant | tenant, granted_by, scope, reason, expires_at, revoked_at |

---

# Part 3 — The MVP cut

## 3.1 The MVP in one sentence

**A single-campus church of ~200 attenders can run people, Sunday children's check-in, giving and statements, volunteer scheduling, weekly email and SMS, groups, care follow-up and a Monday dashboard in one system, without a spreadsheet beside it.**

That sentence is the acceptance test. If a church still needs a spreadsheet for one of those jobs, the MVP has failed regardless of how many features shipped.

## 3.2 Four cut principles

1. **Breadth before depth.** All twelve modules ship at the depth a 200-person church needs in year one. A missing module sends the church back to a spreadsheet and kills the switch, which is more expensive than a shallow module.
2. **One real differentiator.** Check-in, attendance and volunteer scheduling share one data model. Most churches run two tools and reconcile Sunday by hand; that reconciliation is the wedge.
3. **No builders.** No workflow builder, no report builder, no form builder, no custom-role builder at MVP. Opinionated templates, editable text, fixed dashboards. Builders are how small teams ship nothing.
4. **Single campus in the UI, multi-campus in the schema.** Every table and permission check is campus-aware from day one; the campus switcher, per-campus branding and cross-campus reporting arrive with the first multi-campus customer.

## 3.3 In-MVP checklist

### A. Foundation

- [ ] Multi-tenant data model with `tenant_id` on every table and row-level security enforced in the database, including exports and background jobs.
- [ ] Email/password and magic-link auth; session revocation on deactivation and on credential change; audit of login events.
- [ ] Six preset roles with campus scope; permission checks server-side per object and action; a "who can see giving?" matrix screen.
- [ ] Append-only audit log on people, giving, care, roles and exports, with actor type (user / platform support / system).
- [ ] Soft delete everywhere; hard delete blocked where financial or audit records exist.
- [ ] Custom fields admin (20 per object) with visibility and PII flags.
- [ ] CSV import with mapping, dedupe preview, dry run, error report and 7-day rollback.
- [ ] CSV export for every list, permission-checked and audited.
- [ ] Timezone-correct storage and rendering; DST-safe recurrence.

### B. People and households

- [ ] Person and household CRUD with household roles and start/end dates.
- [ ] Guardian links with custody and `authorized_pickup`, independent of address.
- [ ] Duplicate check on create (email, phone, name + DOB) and a merge flow with field-level survivor choice, alias redirect, 30-day unmerge.
- [ ] Life-cycle stages with history and a "moved this month" list.
- [ ] Person timeline: attendance, groups, messages, giving total (permissioned), care notes (permissioned).
- [ ] Archive/deactivate; deceased status that stops all automation immediately.
- [ ] Tags and saved filters usable as communication segments.

### C. Groups

- [ ] Group types with a leader permission set.
- [ ] Groups with campus, leaders, meeting pattern, capacity, visibility, confidential flag.
- [ ] Memberships with role and status; join requests with leader approval.
- [ ] Leader mobile view: roster, contact, one-tap attendance, three-week absentee list.
- [ ] Group calendar and group email/SMS respecting consent.
- [ ] Group fill-rate and leaderless-group report.

### D. Attendance and children's check-in

- [ ] Tablet kiosk locked to a campus and mode; lookup by phone, name or pre-check-in QR.
- [ ] Family check-in with room assignment by age/grade rule, child label and guardian tag printing.
- [ ] Four-character security code per child per occurrence, unique in room, expires at close.
- [ ] Check-out by code or authorized adult; staff override with reason, identity and security log.
- [ ] Room roster with allergy flags and authorized pickup list.
- [ ] Attendance records with source and timestamps; headcount mode for adult services.
- [ ] Manual correction with reason and audit.
- [ ] Auto-printed paper fallback roster at T-30 minutes.

### E. Events and rooms

- [ ] Event templates with recurrence, occurrences materialized 12 months ahead, per-occurrence cancel.
- [ ] Rooms with capacity, features, blackouts and setup/teardown padding.
- [ ] Conflict detection with buffer; hard block for non-admins, logged override for admins.
- [ ] One-step room request approval.
- [ ] Week/day calendar by room and ministry; public ICS feed.

### F. Giving

- [ ] Funds with restriction type and campus scope.
- [ ] Gifts with split allocations, methods, donor person/household, memo, anonymity.
- [ ] Hosted giving page per campus and fund; one-time and recurring; donor-covered fees optional.
- [ ] Processor onboarding (church as merchant of record), tokenized payment methods, no card data stored.
- [ ] Batches with two-person control, balance gate and deposit reference.
- [ ] Payout import, fee/refund/chargeback lines, reconciliation view, variance exception task.
- [ ] Refunds and reversals as new records; posted gifts immutable.
- [ ] Pledges with progress and "above pledge" separation.
- [ ] Annual and period statements (PDF/email/print list) with per-gift lines and required IRS language; stored copy of what was sent.
- [ ] Giving history and recurring-gift management in the portal; historical contribution import.

### G. Communications

- [ ] Email from a verified tenant domain with SPF/DKIM/DMARC setup guidance and status.
- [ ] Templates with merge fields, test send, scheduling, per-recipient status.
- [ ] Segments on people, households, groups, attendance, stage, campus and custom fields (no giving).
- [ ] Preference center with per-channel, per-purpose toggles and one-click unsubscribe.
- [ ] SMS with 10DLC brand and campaign registration per tenant; STOP/HELP; quiet hours; cost estimate.
- [ ] Consent ledger with source, timestamp and wording version; suppression on bounce, complaint and STOP.
- [ ] Send-time de-duplication by person and normalized address.

### H. Volunteer scheduling and service planning

- [ ] Plans per occurrence with positions, counts, call times and clearance flags.
- [ ] Assignments with asked/accepted/declined/confirmed status.
- [ ] Reminders at T-7, T-2 days and T-2 hours.
- [ ] Tokenized accept/decline and swap links with no login.
- [ ] Per-team swap board with leader approval and clearance re-validation.
- [ ] Blockout dates and availability; team rosters.
- [ ] Setlist items and run sheet with version stamp; PDF export.
- [ ] No-show marking, fill-rate and no-show-rate reporting; ICS feed.

### I. Pastoral care

- [ ] Care cases with type, stage, owner, urgency, due date and close reason.
- [ ] Three confidentiality tiers with explicit access lists; default staff-only.
- [ ] Care notes and visit log with visibility; access logging on reads.
- [ ] Prayer requests with audience choice, permission attestation, 30-day expiry and staff approval for public sharing.
- [ ] Care tasks, reminders and case timeline.
- [ ] Safeguarding/risk case types with a mandatory-reporting banner and no-delete rule.
- [ ] Person-level data export for an access request.

### J. Workflows

- [ ] Five templates: first visit, second visit, new member, birthday, three-week absence.
- [ ] Editable timing, message, owner and on/off; no builder.
- [ ] Triggers on person created, attendance, stage change, group join.
- [ ] Actions: email, SMS, task, care case, tag, staff notification.
- [ ] Per-run log with fired/suppressed reason; test mode; idempotent trigger keys.
- [ ] Global do-not-contact and two-touch-per-14-days cap.

### K. Reporting

- [ ] Five dashboards: This Week, Attendance, Giving, Groups and Volunteers, New People.
- [ ] Fixed ranges with previous-period and same-period-last-year comparison.
- [ ] Metric dictionary covering headcount, checked-in, unique attenders, giving gross/net, pledge progress.
- [ ] Drill-through to list and CSV export.
- [ ] Monthly PDF pack with immutable snapshot.
- [ ] Separate fiscal-year and tax-year settings.

### L. Member self-service

- [ ] Mobile-web PWA, installable, no app store.
- [ ] Magic-link login; per-person accounts; no household logins.
- [ ] Profile and household edit with staff review for relational fields.
- [ ] Giving history, statement download, recurring gift management.
- [ ] Pre-check-in QR for the family.
- [ ] My groups, my serving schedule with accept/decline and blockouts.
- [ ] Notification preferences, unsubscribe, directory opt-in with per-field visibility.
- [ ] Prayer request submission with audience choice.

### M. Operations and compliance

- [ ] Backups with point-in-time recovery (35 days); documented RPO 5 minutes, RTO 4 hours.
- [ ] US data hosting at MVP; DPA available to tenants; published subprocessor list.
- [ ] PCI scope documented as SAQ A-style: no card data on platform systems.
- [ ] Retention settings with documented defaults; anonymization path for deletion requests.
- [ ] Accessibility: WCAG 2.1 AA for portal and kiosk; large touch targets and high contrast on kiosk.
- [ ] Support access off by default, time-boxed, logged in the tenant's audit log.

## 3.4 Explicitly not in MVP

Each line is a deliberate cut, not an oversight. The right-hand column says what the church does instead, which is the real test of whether the cut hurts.

| Not in MVP | Until then |
|---|---|
| Multi-campus UI: campus switcher, per-campus branding, cross-campus reporting | Single campus configured; schema and permission checks already campus-aware |
| Campus-scoped role enforcement beyond a single campus | Roles carry scope; the selector appears when a second campus exists |
| Offline kiosk with local cache and sync | Auto-printed paper fallback roster plus same-day manual entry |
| Room resource inventory (tables, AV kits) and multi-room bookings | Rooms only; equipment coordinated by email |
| Event registration, ticketing and payment | External form plus a giving link |
| Workflow builder, branching, goals | Five editable templates |
| Report builder, saved custom reports, cohort analysis | Five dashboards plus CSV export |
| Public pledge campaign pages and progress thermometers | Pledges tracked internally; progress shared from a report |
| Text-to-give, stock, DAF, crypto, in-kind gifts | Card, ACH, cash, check |
| Accounting sync (QuickBooks/Xero) and payroll | CSV export to the accountant's format |
| Background-check integration | Clearance recorded manually with expiry |
| Native iOS/Android apps and push notifications | Installable PWA |
| Two-way SMS inbox | Outbound SMS; replies go to the church phone |
| Custom role builder and field-level permissions | Six preset roles |
| SSO/SAML, SCIM, tenant API keys, webhooks | Email/password and magic link; CSV in and out |
| Public group finder, photo directory, event calendar pages | Unlisted groups joined by request; ICS feed only |
| AI summaries, sermon media, live streaming, website builder | Explicitly someone else's product |
| Multi-language UI, multi-currency, UK Gift Aid | English, USD, US tax language |
| Facial recognition or any biometric check-in | Never — not a later item |
| Child-care ratio automation, medical record keeping | Flags and rosters only; no clinical record |

## 3.5 The switch test

The MVP is done when a 200-attender church can pass all six scenarios in one weekend, unaided, with the vendor watching but not touching the keyboard.

| # | Scenario | Pass condition |
|---|---|---|
| 1 | Sunday 08:45 — a family of five checks in two children | Under 90 seconds at the kiosk; both labels print; allergy flag on the room roster; grandmother collects as an authorized adult; an adult not on the list is refused and the attempt logged |
| 2 | Sunday 09:30 — three unfilled positions | Coordinator fills all three from a phone in under five minutes; each volunteer confirms by SMS link |
| 3 | Monday 09:00 — pastor opens the portal on his phone | This Week loads with no filters; attendance, guests with follow-up status, giving MTD and open care cases visible in one screen |
| 4 | Monday 10:00 — administrator migrates 600 people | Import previewed and committed in under two hours; every duplicate either merged or explicitly skipped; rollback available |
| 5 | Month end — treasurer closes the month | Four batches balanced, two payouts reconciled to the cent, board pack generated and sent |
| 6 | 20 January — statements | 180 statements generated; emailed and print lists produced; each lists per-gift dates and amounts with the required language |

**Fail conditions.** Any of these means the MVP is not shippable, regardless of feature count: the coordinator needs a laptop; a volunteer must create an account to accept a shift; the kiosk needs a per-child login; a statement cannot be regenerated for a closed year; the pastor's dashboard needs configuration before it shows anything; a gift can be edited by a non-finance user without a trace.

## 3.6 After MVP

| Wave | Content | Trigger to build |
|---|---|---|
| 2 | Multi-campus experience and campus-scoped enforcement; offline kiosk; workflow builder; accounting sync; custom roles | First multi-campus contract, or first church over 600 attenders |
| 3 | Registration and payments; native apps and push; background-check integration; two-way SMS; group finder; resource inventory | Churn interviews naming these as the reason, or 20% of customers asking |
| 4 | Report builder; peer benchmarks; AI-assisted care summaries and sermon-based small-group content | Only after retention is proven and data volume supports it |

## 3.7 Open questions and unverified items

These are decisions the founder must make; this document does not have the evidence to make them.

1. **Pricing and packaging** — not researched here. Per-attender, per-staff-seat, or module bundles change which modules must be deep at launch.
2. **Payment economics** — whether the platform takes a basis-point fee on giving, charges the church a subscription, or both. This determines whether giving is a module or the business model.
3. **Geographic market** — a US-first MVP cannot serve UK churches without Gift Aid declarations and different statement language. That is a market decision, not a feature.
4. **Registration** — deliberately excluded from the events module, but churches will assume it exists. Either scope it into Wave 2 or state the exclusion in sales material.
5. **Persona evidence** — the six personas are constructed from the segment premise (150–3,000 attenders, staff of 1–15, volunteer-dependent), not from interviews. Treat the jobs-to-be-done as hypotheses to validate with five churches before committing the roadmap.
6. **Retention periods** — the defaults in 2.12 are policy choices informed by common practice, not legal advice; they need a lawyer's review per market.

---

## Sources

Accessed 2026-10-29.

| Source | Used for | URL |
|---|---|---|
| IRS, *Publication 1771 — Charitable Contributions: Substantiation and Disclosure Requirements* | $250 written-acknowledgment rule; annual summary may cover several gifts; required statement elements; January 31 as convention | https://www.irs.gov/pub/irs-pdf/p1771.pdf |
| Twilio, *A2P 10DLC* documentation | US application-to-person SMS requires brand and campaign registration; unregistered traffic is filtered and surcharged | https://www.twilio.com/docs/messaging/compliance/a2p-10dlc |
| FTC, *CAN-SPAM Act: A Compliance Guide for Business* | Opt-out handling within 10 business days, physical postal address, primary-purpose test | https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business |
| GDPR, Article 9 (via gdpr-info.eu) | Religious belief and health data as special categories; non-profit religious-body condition and no external disclosure without consent | https://gdpr-info.eu/art-9-gdpr/ |
| Stripe, *Security guide* | Card data kept off platform servers; only brand, last four and expiry stored; TLS 1.2+ | https://docs.stripe.com/security/guide |
| Sam Rainer, *Ten Non-Negotiable Rules for Child Safety in Churches*, Church Leadership | Matching-tag check-in/check-out, two-adult rule, annual background checks as church practice | https://www.churchleadership.com/leading-ideas/ten-non-negotiable-rules-for-child-safety-in-churches |

## Verification notes

- The Planning Center Check-Ins marketing page was fetched but returned only cookie-consent text, so no competitor feature claims are made anywhere in this document.
- The IRS Publication 1771 HTML page returned a 404; the PDF at the URL above was fetched successfully and is the basis for the giving statements requirements.
- The Stripe security guide was served in Portuguese on fetch; content was read and is cited for the technical claim only (card data never reaches platform servers).
- The GDPR article is cited for the regulatory text, not as legal advice for any specific church or jurisdiction. The wording was read on a consolidated mirror (gdpr-info.eu); the official instrument is published in EUR-Lex.
- All persona detail, thresholds, and MVP cut lines are product judgments by the author, not findings from user research. Section 3.7 states this explicitly.
- No claim is made about competitor pricing, market share or feature parity; none was verified in this run.
