# Church Management Platform — Product and Delivery Plan

**Version 1.0 · 29 October 2026**
**Audience:** founder and founding team
**Basis:** this document synthesises four research files in `research/` — market and competitive landscape (`01`), compliance and security baseline (`02`), personas and functional specification (`03`), and technical architecture and data model (`04`). Read those for detail and citations; read this for the plan.

---

## 0. The plan on one page

| Question | Answer |
|---|---|
| **What** | A multi-tenant church management platform: people, groups, attendance, children's check-in, giving, communications, volunteer scheduling, events, care, and reporting in one system |
| **Who** | Churches of 150–3,000 weekly attenders, single- and multi-campus, US-first then UK/Canada/Australia |
| **Wedge** | One data model across attendance, check-in and volunteer scheduling, one price for every module, and migration that actually works. Incumbents are broad but fragmented by module, metered in ways buyers resent, and hostile to switch away from |
| **MVP** | All twelve modules at the depth a 200-attender church needs — not nine modules in depth. A missing module sends the church back to a spreadsheet |
| **Architecture** | TypeScript modular monolith (Next.js + Node worker), PostgreSQL, shared schema with `tenant_id` + row-level security, Stripe Connect direct charges |
| **Price** | $39–$399/month by attendance band, all modules included, no platform fee on giving |
| **Timeline** | 3 weeks discovery → 24 weeks MVP → 16 weeks switch-ready GA → 16 weeks moat. Roughly 15–18 months to a complete product at 3.5 FTE |
| **Cost** | $900k–1.4M with a US team; $450–700k with two engineers in Eastern Europe or LATAM, to GA plus twelve months of selling |
| **The honest ceiling** | A 1,000-church business is roughly $1.7M ARR. This is a durable $3–8M ARR company, not a venture-scale one, unless it expands into denominational networks or adjacent verticals. Decide which game you are playing before you raise |

---

## 1. Product thesis and positioning

### 1.1 Why this market is worth entering

Church management software is not hard because churches are complicated. It is hard because a church is a volunteer-run organisation carrying a payroll system's data sensitivity, a charity's reporting obligations, a school's child-safety duties and a small business's payment flows — staffed largely by people who did not choose to become database administrators.

The category is mature and the incumbents are broad. What they are not is *coherent*. A typical 500-attender church runs three or four tools: one for people and groups, one for check-in, one for giving, a spreadsheet for the rest. Sunday's attendance is reconciled by hand on Monday. That reconciliation is the product opportunity.

Three claims the product must be able to make and prove:

1. **One system, one price, no module ladder.** Every module on every plan, unlimited admins, no feature gate that forces a phone call.
2. **A Sunday that runs itself.** Check-in that survives bad wifi, labels that print, volunteers who need no training, and an attendance record that is already correct by Monday morning.
3. **Giving the treasurer trusts.** Batches that reconcile to the bank, statements generated without a spreadsheet, and an audit trail built for the one year someone actually asks.

### 1.2 The wedge, stated precisely

Four weaknesses recur across the competitive set, and only one of them is a feature:

- **Cross-domain reporting.** Every vendor can report on its own module. Almost none answers "which first-time families from Easter are now in a group, giving, and serving?" without an export. This is the single most defensible capability because it requires the unified data model that modular competitors structurally cannot have.
- **Volunteer and member usability.** Church staff are part-time and turnover is constant. Interfaces built for a database administrator lose.
- **Migration.** Buyers name switching cost as the top reason they stay on software they dislike. Being the easiest system to move *into* is worth more than any single feature.
- **Transparent mid-market pricing.** At 500 attenders, published prices run $99–$239/month while quote-only suites run $500–$1,500+. The gap is packaging, not capability.

The product bet: **attendance, check-in and volunteer scheduling are one problem, not three.** Most churches run two systems and reconcile by hand; an integrated model removes a weekly manual task and is difficult to copy without rebuilding the schema.

### 1.3 What we deliberately do not build

Sermon streaming, website builders, live production tools, payroll, and full general-ledger accounting. These are adjacent markets with entrenched winners and low marginal differentiation. Integrate with them and stay the system of record for people, groups, attendance, giving, service and care. Every "yes" to a tangent is a quarter not spent on the wedge — this is the most common way products in this category die.

---

## 2. Market and competitive reality

### 2.1 The landscape in one table

Prices below are published list prices at 500 weekly attenders unless noted (full detail and sources in `research/01-market-competitive.md`).

| Product | Metering basis | ~500 attenders | Where it wins | Where it loses |
|---|---|---|---|---|
| Planning Center | Per module, per unit | ~$239 (4 modules) | Depth of scheduling, check-in, groups; free People and Giving; volunteer familiarity | Cost stacks by module; each ministry a separate UI; reporting stitched by hand |
| Tithe.ly | Flat bundle | $119 all-access | Cheapest full bundle; giving-first onboarding | Shallow per module; economics depend on processing margin |
| Breeze | Per contact | $72 | Simplest UX in the category | Basic reporting; absorbed into Tithe.ly in Nov 2025 |
| ChurchTrac | Per record | $99 | Price with accounting included | Small-church ceiling; limited multi-campus |
| One Church | Per profile | $166 (Core+) | Modern, transparent, multi-campus | Core capabilities paywalled into the higher tier |
| ChMeetings | Per active person | $50 | Lowest price; free migration; unlimited admins | Limited depth and brand at 500+ |
| Elvanto | Per active adult | ~$130 (est.) | Genuine all-in-one including worship planning | Per-adult meter penalises growth; thin US presence |
| Rock RMS | Free licence | hosting + implementation | Extensibility, data ownership, large churches | Not turnkey: you own hosting, upgrades, security |
| Pushpay/CCB, Realm, Fellowship One, Subsplash | Quote-only | $500–$1,500+ (est.) | Enterprise references, integrated giving, apps | Opaque pricing, annual contracts, dated UX |

**Two conclusions follow.** First, the low end is already brutal — you cannot win a price war against $50/month. Second, the mid-market transparent band ($99–$239) is where a genuine product gap exists: more coherent than Tithe.ly, cheaper and more honest than Planning Center, and dramatically easier to switch to than the quote-only suites.

### 2.2 Where the money actually is

Processing fees, not subscriptions, dominate category economics. At 2.15–2.9% + $0.30, every $100,000 of online giving costs the church $2,450–$3,200 a year — routinely more than the software itself. This is why Tithe.ly and Subsplash give software away: the payments margin pays for it.

It also sets a strategic fork (§9.1). You can pass processing through at cost and compete on subscription, or you can subsidise software with a platform fee. Choose deliberately; do not drift into it.

### 2.3 Market size, honestly

Roughly 433,000 church congregations exist across the US, UK, Canada and Australia; an estimated 65,000–110,000 sit in the 150–3,000 band; at $250–$400/month that is a **$250–400M annual software opportunity** before processing revenue. Third-party "ChMS market" reports are unusable — two 2024 figures differ by 13×.

A useful translation: **1,000 churches ≈ $1.7M ARR.** Reaching 3% of the addressable band is a $5–6M ARR business. That is a genuinely good outcome and a poor venture return. Price the ambition accordingly (§9.3).

### 2.4 Seasonality is a schedule constraint, not a footnote

Church fiscal years cluster on January (approximately 74% of surveyed churches) and budgets and switching decisions cluster in **August–September** and **October–January**. A release that lands in March waits five months for attention. The delivery calendar in §8.2 is built around these windows deliberately.

---

## 3. Who we build for

Six personas, all of them real constraints on the interface (full profiles in `research/03-functional-spec.md`):

| Persona | The job | What makes them abandon software |
|---|---|---|
| **Lead pastor** | Know whether the church is healthy without asking five people | Dashboards that require interpretation; anything that feels like a CRM |
| **Church administrator** | Keep the whole operation coherent, usually alone | One more system to reconcile; per-module pricing; having to call support to change a setting |
| **Finance volunteer** | Produce trustworthy numbers for a board and an auditor | Batches that do not reconcile; statements that need a spreadsheet; no audit trail |
| **Ministry / group leader** | Know who is in the group and who has gone quiet | A desktop-only interface, a login they have lost, and a 40-field form |
| **Volunteer coordinator** | Fill Sunday's positions without 30 text messages | Scheduling tools that require volunteers to create accounts |
| **Member / parent** | Give, find a group, check a child in quickly | Anything that asks for a password on a Sunday morning |

Two of these are decisive and under-served: the **administrator**, who is the actual buyer and the person whose week the product either shortens or lengthens, and the **volunteer**, whose friction is invisible in demos and fatal in production.

---

## 4. Product scope: twelve modules

Each module ships at full MVP depth. "Depth" means it does the job a 200-attender church needs in year one without a workaround.

| # | Module | At MVP | Later | The edge case that decides the design |
|---|---|---|---|---|
| 1 | **People and households** | Person + household model, guardian links, custom fields, duplicate merge, life-cycle stages, timeline | Relationship graph, advanced dedupe scoring | Households split and re-form. Model the *person* as the subject of attendance and giving; households are a grouping with start and end dates |
| 2 | **Groups and ministries** | Group types, leaders, capacity, join requests, leader mobile roster, attendance, absentee list | Group finder, multiplication planning | A leader must be able to run their group from a phone without training, and must not see giving |
| 3 | **Attendance and check-in** | Kiosk, family check-in, room assignment by age rule, labels + guardian tags, 4-character security code per child per occurrence, allergy flags, paper fallback | Pre-check-in QR, self-service kiosks, capacity alerts | The security code must be per child *per occurrence* and expire at close. Reusing last week's code is a safeguarding incident, not a bug |
| 4 | **Events and rooms** | Recurring events, room booking with buffers, conflict detection, ICS feed | Public registration with payments, resource inventory | Recurrence across DST boundaries; per-occurrence cancellation without breaking the series |
| 5 | **Giving** | Funds, split allocations, hosted giving page, recurring gifts, batches with two-person control, payout reconciliation, pledges, annual statements | Text-to-give, donor portal enhancements, campaign thermometers | Posted gifts are immutable — refunds and corrections are new records. Every finance feature is downstream of this one rule |
| 6 | **Communications** | Email from a verified domain, segments, templates, preference centre, consent ledger, SMS with 10DLC registration | Journeys, A/B testing, two-way SMS | SMS cannot send until the tenant's 10DLC brand and campaign clear. Design the UI around a blocked state, not an error toast |
| 7 | **Volunteer scheduling** | Plans per service, positions, ask/accept/decline by tokenised link with no login, reminders, swap board, setlists | Multi-week templates, team health scoring | A swap must re-validate clearance. A swapped-in volunteer without safeguarding clearance is the worst possible failure |
| 8 | **Pastoral care** | Cases with stages and owners, three confidentiality tiers, visit log, prayer requests with expiry | Care pathways, referral tracking | Platform staff must be structurally unable to read care notes. Build the access boundary before the feature |
| 9 | **Workflows** | Five templates: first visit, second visit, new member, birthday, three-week absence. No builder | Visual builder, custom triggers | A deceased or do-not-contact record must stop all automation instantly. Every trigger needs an idempotency key |
| 10 | **Reporting** | Five dashboards with period comparison and a metric dictionary; drill-through to export | Custom report builder, scheduled packs | Two churches with the same attendance will disagree about the definition of "attender". Publish the metric dictionary in-product |
| 11 | **Member self-service** | Mobile-first portal: directory, giving history, recurring gift management, group pages, pre-check-in | Native apps, push, group messaging | Passwordless by default. Every password prompt on a Sunday morning costs a check-in |
| 12 | **Administration** | Six preset roles with campus scope, audit log, CSV import with rollback, exports | Custom role builder, SSO for larger churches | Permissions must be enforced server-side per object and action, with a readable "who can see giving?" screen |

---

## 5. The MVP cut

### 5.1 The acceptance test

> A single-campus church of about 200 attenders can run people, Sunday children's check-in, giving and statements, volunteer scheduling, weekly email and SMS, groups, care follow-up and a Monday dashboard in one system, **without a spreadsheet beside it**.

If a church still needs a spreadsheet for any of those jobs, the MVP has failed regardless of how much shipped.

### 5.2 Four cut principles

1. **Breadth before depth.** All twelve modules at 200-church depth beats nine modules at 2,000-church depth. A missing module kills the switch, which costs more than a shallow one.
2. **One real differentiator.** Check-in, attendance and volunteer scheduling sharing one data model. Everything else needs to be merely competent.
3. **No builders.** No workflow builder, report builder, form builder or custom-role builder. Opinionated templates and fixed dashboards. Builders are how small teams ship nothing for a year.
4. **Single campus in the UI, multi-campus in the schema.** Every table and permission check is campus-aware from day one; the campus switcher arrives with the first multi-campus customer.

### 5.3 Explicitly not in MVP

Native iOS/Android apps · workflow and report builders · group chat · sermon media · public event registration with payment · text-to-give · payroll or general ledger · denomination-level hierarchy · white-label branding · AI features · custom domains per church · multi-language UI.

### 5.4 The switch test

Run this before calling the MVP done: pick three real churches on Planning Center, CCB and a spreadsheet. Import their data on a Monday and run the following Sunday entirely inside the product. Every manual step that survives is a bug in the plan, not a training problem.

---

## 6. Architecture

Full blueprint, schema and ERDs in `research/04-architecture.md`. The decisions that matter:

### 6.1 The stack

**TypeScript modular monolith** — one Next.js application (staff admin, member portal, public giving pages) plus a separate Node worker, PostgreSQL, and a Postgres-backed job queue. One language, one deployable, one on-call rotation.

- *Why not microservices:* a team of three cannot operate a distributed system and ship features. Split at a measured bottleneck, not in advance.
- *The serious alternative:* Laravel. It reaches first paying customer about two weeks faster and has a deep hiring pool, but splits the codebase across two languages once any real-time or client-heavy surface appears. Choose it if the founding team is already strong in PHP; otherwise the TypeScript monolith wins on hiring and surface reuse.
- *Buy, do not build:* authentication primitives, email delivery, SMS, payments, file storage, error tracking. **Build** the permission model and the data model — those are the product.

### 6.2 Tenancy

Shared schema with `tenant_id` on every table, composite foreign keys, and PostgreSQL row-level security as a backstop rather than the primary control. Schema-per-tenant does not pay for itself below several thousand tenants; database-per-tenant makes cross-tenant engineering impossible for a small team. The escape hatch for a large multi-campus customer is a cell-based deployment — a dedicated stack for one tenant — and it should be a commercial decision, not an architectural one.

### 6.3 Three decisions that are expensive to reverse

These must be settled **before the first migration**, because retrofitting them costs a quarter each:

1. **The person, not the household, is the subject of attendance and giving.** Households are a grouping with start and end dates. Churches merge, split and re-form households constantly; a household-centric schema cannot survive a blended family.
2. **Money is an append-only ledger with fund splits.** Gifts are never updated or deleted. Refunds, reversals and corrections are new records referencing the original. This is what makes reconciliation and audit possible, and it cannot be bolted on later.
3. **UUIDv7 identifiers with `tenant_id` in every table, index and foreign key from migration 0001.** Adding tenancy to a live schema is a multi-month project with a data-corruption window.

### 6.4 Payments

**Stripe Connect, direct charges, Standard accounts.** Each church is merchant of record, holds its own balance, and bears its own chargebacks. This keeps the platform out of money transmission, out of KYC on every church, and out of the blast radius of a church's disputes. Express or Custom accounts move that liability onto you — a deliberate choice, not a default.

**PCI scope is an architectural decision.** If any element of the payment page is served from your origin, SAQ A is unavailable and you inherit SAQ A-EP obligations. Use Stripe-hosted Checkout or a full redirect and stay in SAQ A for the life of the company.

### 6.5 Operations and unit cost

Managed Postgres, containers, single region, no dedicated SRE. Infrastructure runs approximately **$300/month at 100 churches, $2,300 at 1,000, and $14,500 at 10,000**, excluding payment and SMS pass-through. Gross margin lands at 80–85% after email, SMS and support.

---

## 7. Compliance, security and trust

Detail and citations in `research/02-compliance.md` — that document labels every requirement `HARD` (statutory), `CONDITIONAL` (triggered by design choices), `CONTRACTUAL` (platform terms) or `BUYER` (expectation, not law). Five findings change the build:

1. **Core church data is special-category data.** A membership roll, a small-group roster and an attendance record all reveal religious belief, which is Article 9 GDPR data by inference. Teams that classify only pastoral notes as sensitive under-scope the entire compliance programme. A DPIA is required, not optional.
2. **The right lawful basis is Art. 9(2)(d), not consent.** The not-for-profit-bodies condition covers members and people in regular contact — but not employees, not first-time visitors, and not disclosure outside the body. Which means **photos, media, and the member directory are consent problems**, handled separately from the membership roll. Using consent as the blanket basis creates a withdrawable foundation for records the church must keep.
3. **Medical and allergy flags cannot rely on vital interests.** That condition applies only where the subject cannot consent. Routine collection of a child's allergy data needs guardian consent.
4. **PCI compliance is a routing decision, and Stripe-hosted payment pages keep you in SAQ A.**
5. **Tenant-level 10DLC registration gates SMS.** Treat "SMS not yet approved" as a first-class product state with a visible timeline, because it will be true for every new church for days.

**The trust bar.** This product holds children's records. One breach ends the company — there is no reputational recovery path for a vendor that lost a church's child check-in data. Non-negotiables before the first paying customer: encryption at rest and in transit, MFA (mandatory, not optional, for finance roles), least-privilege scoped RBAC, append-only audit logs on people/giving/care/roles/exports, tested restores, no PII in application logs, and an external penetration test.

**Certification timing.** SOC 2 Type I after the first ~30 churches (roughly $18–25k with an auditor), Type II once processes have six months of operating history. Most small churches will not ask; every church above 800 attenders and every denominational deal will.

**Accessibility.** WCAG 2.2 AA for the admin app and the kiosk. A check-in kiosk used by a volunteer in a dark lobby with a queue behind them is an accessibility problem before it is a compliance one.

---

## 8. Delivery plan

### 8.1 Phases and exit criteria

| Phase | Weeks | Ships | Exit criterion |
|---|---|---|---|
| **0 — Discovery** | 3 | 15 church interviews, 3 signed design partners, wedge validated against real workflows | Three churches commit to migrating at launch |
| **1 — MVP** | 24 | All twelve modules at 200-church depth; hosted-checkout giving; kiosk; hosted email; CSV import with rollback | Five churches run a real Sunday on it, twice, with no spreadsheet |
| **2 — Switch-ready GA** | 16 | Self-serve signup and billing, migration tooling for the top four incumbents, multi-campus UI, workflow depth, SOC 2 Type I | A church signs up, migrates and goes live without a sales call |
| **3 — Moat** | 16 | Native mobile apps, two-way SMS, report builder, open API and webhook surface, AI assists (natural-language reporting, attendance anomaly detection) | Third-party integrations exist that you did not build |

**Effort: roughly 208 person-weeks to a complete product** (12 + 84 + 56 + 56). At 3.5 effective FTE that is about 59 working weeks plus 20% slack — **15–18 months**. A two-person team should plan on 22–26 months. Treat any plan shorter than this as a plan to ship a demo.

### 8.2 Calendar, aligned to buying seasons

Assuming a November 2026 start:

| Milestone | Target | Why that date |
|---|---|---|
| Design partners signed | Dec 2026 | Interviews must finish before code |
| MVP in five churches | May 2027 | Beta over a summer, including a holiday-period dip |
| First paying customers | Jun–Jul 2027 | Price and support model proven before the August window |
| GA + self-serve | Sep 2027 | Lands on the autumn buying window |
| Complete product | Dec 2027 | Lands on the January fiscal-year window, the largest of the year |

Missing a window costs a quarter of pipeline, not a week of work. Build the calendar backwards from August and January.

### 8.3 Team

| Role | When | Why |
|---|---|---|
| Technical founder (product + eng lead) | Day 0 | Architecture, permissions, data model are founder decisions |
| 2 senior full-stack engineers | Month 1 | One on product surfaces, one on data/payments/jobs |
| Designer (0.5) | Month 1 | Kiosk and volunteer UX cannot be designed by engineers alone |
| Implementation / support (1) | ~25 paying churches | Migration is the conversion event; it cannot be a ticket queue |
| Second support + customer success | ~100 churches | Churn is a support problem in this category |

### 8.4 Build versus buy

| Build | Buy |
|---|---|
| Permission model, data model, check-in state machine, batch reconciliation, statement generation | Payments (Stripe), email (Postmark/SES), SMS (Twilio), file storage, error tracking, uptime monitoring |
| Importers for incumbent formats | Auth primitives — but *not* the authorisation model |
| Metric dictionary and dashboards | Analytics/warehouse below 300 tenants |

---

## 9. Business model

### 9.1 Pricing

Attendance bands, all modules included, unlimited admins, **no platform fee on giving**:

| Weekly attendance | Price/month |
|---|---|
| Up to 150 | $39 |
| 151–400 | $99 |
| 401–800 | $179 |
| 801–1,500 | $259 |
| 1,500+ | $399 |

This sits deliberately between Tithe.ly ($119 flat, shallower) and Planning Center (~$239 for four modules) at 500 attenders, and well below the quote-only suites.

**The fork you must decide consciously:** processing margin is the category's real revenue pool. Waiving a platform fee costs roughly $40–60/church/month at typical giving levels — 25–35% of potential revenue — but it removes the "you are taking a cut of the offering" objection entirely and is the single cheapest trust signal available. **Recommendation: launch subscription-only; revisit at 100 churches with real giving data.** If a free tier is ever added, fund it with a 0.4% platform fee rather than by degrading the paid product.

**No per-module pricing, ever.** It is the category's most-cited frustration and the one differentiator that costs nothing to hold.

### 9.2 Unit economics

- ARPU ≈ $140/month blended across the band → $1,680/year.
- Gross margin 80–85% after infrastructure, email, SMS and support.
- Logo churn 2.5–3%/month (church software is sticky but budget-cycle-driven) → LTV ≈ **$3,000–3,400**.
- **CAC must stay under ~$1,000.** That single constraint rules out paid acquisition as a primary channel and dictates the go-to-market in §9.4.

### 9.3 Cost to GA and funding

| Item | US team | Offshore team |
|---|---|---|
| Team, 18 months | $800k–1.1M | $320k–500k |
| SOC 2 Type I→II, pentest, legal/DPA | $50–75k | $50–75k |
| Infrastructure, tools, design | $40–60k | $40–60k |
| **To GA plus 12 months of selling** | **$900k–1.4M** | **$450–700k** |

Two honest paths: bootstrap with design partners and a small angel round against the $450–700k plan, or raise a pre-seed of $1.0–1.5M and hire the US team. The second buys speed into the January window; the first buys control. Either is defensible — but raising venture money against a $3–8M ARR ceiling is not, unless expansion into denominational networks or adjacent verticals (schools, nonprofits) is part of the plan from the start.

### 9.4 Go-to-market sequence

1. **Design partners** — five churches at 50% lifetime discount, in exchange for migration access, weekly feedback and a named case study. Their data becomes your migration test suite.
2. **Wedge content** — "Planning Center alternative", "church check-in that works when the wifi doesn't", "church software without per-module pricing". Church administrators search these phrases literally.
3. **Denominational and network channels** — one regional network endorsement outperforms a year of advertising, and networks move in blocks.
4. **Review sites** — Capterra, G2, Software Advice. Church buyers genuinely read them, and the incumbents' review scores are mediocre.
5. **Referral loop in-product** — a "recommend to another church" flow at the moment of a successful statement run or first Easter check-in.

---

## 10. Risk register

| # | Risk | Severity | Response |
|---|---|---|---|
| 1 | **Scope sprawl across twelve modules; nothing ships finished** | Critical | Phase gates with written exit criteria. No module starts before the previous phase's criterion is met. The MVP list in §5.3 is a contract with yourself |
| 2 | **An incumbent gives the software away free to win payment margin** | Critical | Never compete on free. Compete on admin hours saved, migration, support responsiveness and price predictability — things a payments-first incumbent structurally will not do |
| 3 | **A breach involving children's data ends the company** | Critical | Security baseline in §7 before GA; pentest; cyber insurance; no PII in logs; care notes unreadable by platform staff by design |
| 4 | **Migration pain blocks every deal** | High | White-glove migration as a service until Phase 2; then importers for the top four incumbents; publish a migration guarantee |
| 5 | **Volunteer admins need hand-holding, and support cost eats margin** | High | Ruthless UX simplicity, in-app onboarding, docs with screenshots, sub-one-business-day support |
| 6 | **GDPR misclassification discovered after launch** | High | Read `02-compliance.md` before building the people module; DPIA at design time; counsel review per jurisdiction; consent separated from the membership roll |
| 7 | **SMS blocked by 10DLC registration at the worst moment** | Medium | Registration surfaced as an onboarding step with a timeline, not a runtime error |
| 8 | **Buying season missed by a quarter** | Medium | Release calendar fixed to July and December; no major release in March or April |
| 9 | **Key-person risk on a small team** | Medium | Architecture decision records; no single-owner subsystems; everything reproducible from the repo |
| 10 | **AI features commoditise the differentiator** | Medium | AI is assistive polish — natural-language reporting, anomaly detection. It is never the reason to buy |

---

## 11. Metrics that tell you it is working

| Metric | Target | Why this one |
|---|---|---|
| Activation: live with people + giving + check-in | Within 14 days of signup | The only proof the product is usable by a volunteer |
| Weekly active admins per church | ≥ 2.5 | One admin means the church is not really using it |
| Check-in sessions per week | Growing week over week | This is the habit; everything else is a report about it |
| Migration completed | < 5 business days | The conversion event |
| Logo churn | < 2%/month by month 18 | Category norm is 2.5–3% |
| Net revenue retention | > 105% | Attendance-band upgrades are the only expansion lever |
| Support load | < 1 ticket/church/month | The leading indicator of margin collapse |
| Giving volume processed | Tracked from day one | Even without a platform fee, it predicts retention better than any engagement metric |

---

## 12. Decisions needed in the next two weeks

| # | Decision | Recommendation |
|---|---|---|
| 1 | Bootstrap or pre-seed | Decide before hiring; it determines team geography and the calendar in §8.2 |
| 2 | US-first or UK-first | US-first — larger band, one currency, one SMS regime. UK second |
| 3 | Wedge for the first release | Integrated attendance + check-in + volunteer scheduling, with giving as the trust anchor |
| 4 | Price floor | $39 entry band; do not chase ChMeetings on price |
| 5 | Platform fee on giving | None at launch; revisit at 100 churches |
| 6 | Hosted checkout vs embedded | Hosted — it keeps PCI scope at SAQ A |
| 7 | Native apps in year one | No. Mobile-first PWA, plus kiosk mode |
| 8 | First migration target | Planning Center exports, because that is where the churning churches are |
| 9 | Design partners | Five named churches signed before any code |
| 10 | Legal counsel | Engage a privacy lawyer in the launch jurisdiction before the people module is built, not before launch |

---

## 13. Companion documents

| File | Contents |
|---|---|
| `research/01-market-competitive.md` | Twelve-product comparison, pricing benchmarks at 200/500/1,000 attenders, buyer objections, market sizing, seasonality — all sourced |
| `research/02-compliance.md` | GDPR/UK GDPR analysis, children's data, PCI and Stripe Connect, US/UK/CA/AU charitable receipt rules, security baseline, WCAG — labelled by obligation type |
| `research/03-functional-spec.md` | Six personas, twelve modules with user stories and edge cases, the consolidated MVP checklist |
| `research/04-architecture.md` | Stack rationale, tenancy, RBAC schema, 40-table data model with ERDs, jobs, integrations, operations, eight reversible-cost decisions |

**What this plan does not settle:** the actual churches you will interview, the founding team's composition, and whether the denominational channel is available to you. Those three determine more than any document can.
