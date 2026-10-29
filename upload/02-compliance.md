# 02 — Compliance, Payments and Security Requirements Baseline

**Product:** Multi-tenant church management SaaS (ChMS), web app + mobile member experience
**Segment:** Churches of ~150–3,000 weekly attenders, single- and multi-campus
**Document status:** Requirements baseline for product and delivery planning. **Not legal advice.** Every item marked `HARD` must be confirmed with counsel in each target jurisdiction before launch.
**Research date:** 29 October 2026. All URLs accessed 29 October 2026 unless stated otherwise.

---

## How to read this document

Each requirement carries one of four labels. The distinction is the point of the document: most "compliance" features that ChMS buyers ask for are not legal requirements at all.

| Label | Meaning | Consequence for the roadmap |
|---|---|---|
| **`HARD`** | Statutory or regulator-enforced obligation, cited to primary text | Must ship before first paying customer in that jurisdiction |
| **`CONDITIONAL`** | Becomes mandatory only if a factual trigger is met (e.g. card data touches your page, EU consumer checkout, US state breach law) | Design decision determines whether it applies |
| **`CONTRACTUAL`** | Imposed by Stripe/platform terms rather than statute | Non-negotiable in practice, but renegotiable in principle |
| **`BUYER`** | Market/procurement expectation, no direct legal mandate | Differentiator; sequence by deal size, not by fear |

One structural finding drives most of Section 1: **a ChMS is not a normal SaaS CRM.** Church membership data reveals religious belief, which is special category data under Art. 9 GDPR. Almost every core record — membership, attendance, small-group membership, giving, pastoral notes — is therefore Art. 9 data, not just the obvious "sensitive" fields. That changes the lawful-basis analysis, the DPIA obligation, the DPO question, and the breach-risk calculus.

---

## 0. Executive conclusions

1. **Core ChMS data is special category data.** GDPR Art. 9(1) lists "religious or philosophical beliefs". A membership roll, a small-group roster, and an attendance record all reveal religious belief by inference. Teams that classify only "pastoral notes" as sensitive will under-scope the entire compliance programme.
2. **The correct Art. 9 condition for a church's own membership data is Art. 9(2)(d) — not-for-profit bodies — not consent.** The ICO gives a church example almost verbatim. But the condition has three sharp edges: it covers only members/former members/people in regular contact, it does **not** cover employees or first-time visitors, and it **does not permit disclosure outside the body without consent**. That last edge is what makes photo publishing and member directories a consent problem.
3. **Consent is the wrong default for membership, and the right tool for publication, media and marketing.** Using consent as the blanket basis creates a withdrawable, re-paperable foundation for records the church must keep. Use Art. 9(2)(d) (+ Art. 6(1)(f)) for the roll; use explicit consent for photos, directory visibility, and marketing.
4. **Vital interests cannot carry allergy/medical flags.** Art. 9(2)(c) applies only where the subject is "physically or legally incapable of giving consent". Routine collection of a child's allergy data needs guardian consent; the vital-interests condition is an emergency fallback, not the design basis.
5. **SAQ A is achievable and worth engineering for.** PCI SSC's rule is binary: if *any* element of the payment page originates from your site, SAQ A is unavailable. Stripe-hosted Checkout or a full redirect keeps you in SAQ A; an embedded iframe keeps SAQ A only with TPSP script-protection confirmation; a self-built card form puts you in SAQ A-EP with 6.4.3/11.6.1 obligations.
6. **Under Stripe Connect direct charges the church is the merchant, and bears chargebacks and refunds** — but only if the account type is Standard. Stripe documents that on Express/Custom legacy accounts "your platform is responsible for disputes and fraud". Account-type choice is a risk-allocation decision, not a UX detail.
7. **Receipting is jurisdiction-specific and cannot be one template.** US: contemporaneous written acknowledgment for single gifts ≥$250 with specific content. UK: Gift Aid declaration content + 6-year retention. Canada: ~15 mandatory receipt fields including CRA registration and serial number. Australia: no universal statutory duty to issue, but prescribed content if you do.
8. **SOC 2 Type II is a buyer expectation, not a legal requirement.** Budget $25k–$50k all-in for a startup first year and 6–12 months including the observation window; the *report* is only as good as the observation period behind it.
9. **72 hours is the breach clock, and it starts at awareness, not at confirmation.** A processor's obligation is different and stricter in practice: notify the controller "without undue delay" (Art. 33(2)) — which in a multi-tenant ChMS means hours, not days.
10. **Accessibility is a procurement requirement before it is a legal one.** US churches are exempt from ADA Title III (42 U.S.C. § 12187), but the vendor is not a religious organisation; EU consumer-facing checkout is in scope of the European Accessibility Act since 28 June 2025; and WCAG 2.2 AA is what buyers will ask you to attest to.

---

## 1. Data protection (GDPR and UK GDPR)

### 1.1 Why religious belief is special category — and why that is the whole product

GDPR Art. 9(1) prohibits processing of personal data revealing "racial or ethnic origin, political opinions, religious or philosophical beliefs, or trade union membership", plus genetic, biometric, health, sex-life and sexual-orientation data, unless an Art. 9(2) condition applies. The ICO's guidance restates this and lists the ten conditions. **[HARD]** — Regulation (EU) 2016/679, Art. 9(1): https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679; ICO, "What are the rules on special category data?" https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-rules-on-special-category-data

Three consequences that are routinely missed:

- **Inference is enough.** The data need not say "Christian". A roster of a church's small groups, a giving record to a church, or a check-in record at a church service reveals religious belief. Design and DPIA scope must treat the member record as Art. 9 data.
- **Art. 9 sits on top of Art. 6, it does not replace it.** The ICO is explicit: "you must identify both a lawful basis under Article 6 and a condition for processing special category data under Article 9." Two decisions, documented separately. **[HARD]**
- **Documentation and DPIA load increases.** A DPIA is required where processing is "likely to result in a high risk"; the ICO states you must carry one out if you process special category data on a large scale. A multi-tenant ChMS is by definition large-scale across its customer base — the platform needs its own DPIA, and should ship a DPIA template to churches. **[HARD]** — GDPR Art. 35; ICO special category guidance, "Do we need to do a DPIA?"

### 1.2 Lawful basis: legitimate interests vs consent, activity by activity

The practical answer for a church is a **matrix, not a single basis**. Art. 6 and Art. 9 are chosen per purpose.

| Processing activity | Art. 6 basis | Art. 9 condition | Notes / evidence |
|---|---|---|---|
| Member roll, contact details, pastoral care of members | 6(1)(f) legitimate interests (or 6(1)(b) where membership carries obligations) | **9(2)(d) not-for-profit body** | ICO's own example: "A church processes personal data of its members and supporters in order to run church activities and provide pastoral care. The church can rely on the not-for-profit condition to process the data which reveals their religious belief." |
| Attendance and check-in (adults) | 6(1)(f) | 9(2)(d) | Attendance of members is within "legitimate activities" |
| Employee/volunteer HR records | 6(1)(b)/(c) | **Not 9(2)(d)** — condition excludes employee data | Need explicit consent or another condition for any belief-revealing element |
| First-time visitor card, event guest, enquirer | 6(1)(f) or consent | **Not 9(2)(d)** — no prior contact | Explicit consent is the practical route; minimise fields at capture |
| Donor who is not a member | 6(1)(f) / 6(1)(c) for tax | 9(2)(d) only if "regular contact … in connection with its purposes" | Gift Aid / CRA receipt data has independent legal-obligation drivers |
| Publishing names/photos on website, social, annual report | Consent | **Explicit consent required** | ICO: "must get explicit consent for any disclosures … to a third party" |
| Email marketing to members | 6(1)(f) + PECR/ePrivacy rules | 9(2)(d) for the belief element | See 1.3 for the UK charity soft opt-in |
| Safeguarding records about a member | 6(1)(f)/(c) | 9(2)(d) or 9(2)(f) legal claims | Highest sensitivity; separate access tier |

**On legitimate interests vs consent.** Consent is not "safer". The ICO is explicit that there is no preference for consent as an Art. 6 basis, and that consent must be freely given and withdrawable. For a membership roll, consent is fragile: withdrawal would strand records the church needs for safeguarding, tax and pastoral continuity. Legitimate interests with a documented Legitimate Interests Assessment (LIA) is the more defensible basis for the roll — and the ICO notes that where you rely on legitimate interests for special category data you must factor the added risk into the LIA and may need stronger safeguards. **[HARD]** — ICO, "Legitimate interests" (updated 23 March 2026): https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/legitimate-interests/

**Art. 9(2)(d) in full, and its three edges.** The condition reads: processing "carried out in the course of its legitimate activities with appropriate safeguards by a foundation, association or any other not-for-profit body with a political, philosophical, religious or trade union aim and on condition that the processing relates solely to the members or to former members of the body or to persons who have regular contact with it in connection with its purposes and that the personal data are not disclosed outside that body without the consent of the data subjects." **[HARD]** — GDPR Art. 9(2)(d); ICO, "What are the conditions for processing?" https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-conditions-for-processing/

The ICO's reading of the edges, which should be encoded as product rules:

1. **Scope of persons** — members, former members, or people in regular contact "in connection with your purposes". The ICO states it "does not therefore apply to processing employee data, or to prospective members or other individuals who have not had any prior contact with your organisation."
2. **No external disclosure without consent** — this is why a member directory shared across campuses, a denominational roll-up, or a public "staff team" page needs consent for the belief-revealing element.
3. **Safeguards required** — the ICO suggests "restricting access to the data, applying shorter retention periods, or providing individuals with an opt-out". These are product features, not policy prose.

**Platform-level implication:** the platform is a **processor** for church data (Art. 28), but becomes a **controller or joint controller** the moment it uses that data for its own purposes — benchmarking, "insights", cross-tenant analytics, model training, or marketing to members. That is an architectural line, not a contract clause. Keep any cross-tenant analytics on aggregated, non-attributable data, and say so in the DPA.

### 1.3 Consent handling — including the UK charity email rule

Where consent is the basis (publication, media, marketing to non-members), the standard is the ordinary GDPR standard plus "explicit" for Art. 9: a clear statement (oral or written), specifying the nature of the special category data, and separate from other consents. It must be freely given, specific, affirmative, unambiguous, and withdrawable. **[HARD]** — ICO, conditions for processing, "(a) Explicit consent".

Product requirements that follow:

- **Granular purposes, not one checkbox.** Directory visibility, photo publication on website, photo use on social media, email newsletter, and SMS are five separate consents. Bundling invalidates the bundle.
- **Withdrawal must be as easy as giving.** A member-facing toggle that propagates to published surfaces within a defined SLA (e.g. 72 hours for web, next scheduled post for social — social cannot be recalled, so warn at capture).
- **Consent records as evidence.** Store: who, what purpose, exact wording version shown, timestamp, channel, IP/user agent, and withdrawal events. This is the artefact you produce in a complaint.
- **No consent-by-default for children.** Pre-ticked boxes and opt-out forms are not consent. See 1.4.

**UK-specific change (2025–2026) that most vendors have not implemented.** The Data (Use and Access) Act 2025 inserted a new PECR reg. 22(3A) giving charities a soft opt-in for email marketing. A charity may send direct marketing email where (a) the sole purpose is to further one or more of its charitable purposes; (b) contact details were obtained in the course of the recipient expressing an interest in those purposes or offering/providing support to further them; and (c) the recipient was given a simple means of refusing at collection and in every subsequent communication. **[HARD, UK]** — Data (Use and Access) Act 2025, s.114: https://www.legislation.gov.uk/ukpga/2025/18/section/114/enacted

This matters commercially: it legitimises "you gave us your email when you signed up for the alpha course" follow-up, which many churches currently do unlawfully. Build the refusal link into every send and record the point-of-collection refusal offer.

> **Watch item.** s.114 applies to "charity" as defined in the Charities Act 2011 (E&W), Charities Act (NI) 2008, or the Scottish Charity Register. A US 501(c)(3) or an unregistered church plant does not qualify. Do not generalise the soft opt-in across tenants.

### 1.4 Children: consent age, scope, and the Art. 8 trap

**Art. 8 is narrow and is routinely misapplied.** It applies only where (i) the processing is in relation to the offer of **information society services directly to a child**, and (ii) the lawful basis is **consent** under Art. 6(1)(a). It sets the age at 16 by default, with Member States permitted to lower it to no less than 13. **[HARD]** — GDPR Art. 8(1): https://gdpr-info.eu/art-8-gdpr/ (mirror of Regulation (EU) 2016/679; canonical text at the EUR-Lex CELEX link above)

**UK:** the age is **13**, fixed in the UK GDPR text itself. The DPA 2018 s.9 provision was repealed as spent on 31 December 2020 by SI 2019/419, and Art. 8(1) as it stands in UK law reads "at least 13 years old". **[HARD, UK]** — https://www.legislation.gov.uk/eur/2016/679/article/8 ; repeal noted at https://www.legislation.gov.uk/ukpga/2018/12/section/9

**New in 2026:** the Children's Wellbeing and Schools Act 2026, s.72 inserted Art. 8(2A)–(2B) into UK law, empowering the Secretary of State to vary the age between 13 and 16 by affirmative regulations, including different ages for different services. Nothing has been changed yet, but the 13 is no longer legislatively fixed forever. **[HARD, UK, monitor]** — same legislation.gov.uk page, textual amendment F4 (in force 29 April 2026).

What this means in practice:

- Art. 8 does **not** authorise processing of a 6-year-old's check-in data. It only sets the age at which a child can consent for an ISS. For a church processing a child's data, the controller still needs an Art. 6 basis and an Art. 9 condition — in practice **guardian consent**, because 9(2)(d) covers the member (the child may be a member) but disclosure and media still need consent, and 9(2)(c) is unavailable (see 1.5).
- **Verification duty.** Art. 8(2) requires "reasonable efforts to verify" parental authorisation "taking into consideration available technology". For a church, the practical standard is a recorded guardian relationship in the ChMS plus an auditable consent event — not an email checkbox with no identity link.
- **UK design duty (new).** DUAA 2025 s.81 inserted Art. 25(1A)–(1B): for information society services likely to be accessed by children, the controller **must** take into account "children's higher protection matters" when assessing appropriate technical and organisational measures. That is a hard design obligation, not guidance. **[HARD, UK]** — https://www.legislation.gov.uk/ukpga/2025/18/section/81/enacted

**US (COPPA).** COPPA imposes requirements on operators of websites or online services "directed to children under 13" and on operators with actual knowledge of collecting personal information from a child under 13. **[HARD, US, if in scope]** — 16 CFR Part 312; FTC rule summary: https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa

The allocation question matters: the church is the operator of the check-in service; the platform is its service provider. Contracts should include the written assurance that the vendor will not collect or use children's data for any other purpose, and the product should not create a child-facing account, profile, chat, or photo upload. **Flagged for counsel:** whether a member-facing app that a 12-year-old uses to view their small group constitutes a service "directed to children" — the answer is fact-specific and I did not find a regulator position on ChMS specifically.

### 1.5 Photos and media of minors

There is no standalone statute saying "get a photo consent form". The obligation is assembled from three places:

1. **Art. 9 disclosure rule.** Publication on a public website or social channel is disclosure outside the body. Under Art. 9(2)(d) that requires consent; the ICO's church example is directly on point ("The church publishes an annual report which is available to third parties. The church must seek explicit consent before naming any of its members"). **[HARD]** — ICO conditions page, "(d) Not-for-profit bodies".
2. **Art. 8 + guardian authority** where the subject is a child (see 1.4).
3. **Art. 5(1)(a) fairness and 5(1)(c) minimisation** — publishing a named child's face alongside a location and a regular time is a safeguarding risk independent of data protection law.

Requirements:

- **Consent is per child, per channel, per period.** "We may use photos of your child" is too broad to be specific and will not survive scrutiny.
- **Opt-in, never opt-out.** A register form that says "tick here to opt out of photography" is not consent; silence is not a signal.
- **Separate the safeguarding decision from the data protection decision.** Some churches operate a "no photo" list for safeguarding reasons (looked-after children, custody disputes). The ChMS must support a hard block that overrides any consent record.
- **Withdrawal must reach the asset.** Deleting a consent record without unpublishing the image is not erasure. Track media assets to consent IDs.
- **Retention.** Publish-date-plus-N-years, then review; do not keep event galleries indefinitely.

### 1.6 Processor obligations and the sub-processor list

**Art. 28 is the operative article.** Key requirements the platform must satisfy as a processor:

- **Documented instructions only**, and no processing for the processor's own purposes (Art. 28(3)(a), Art. 29).
- **Confidentiality** of personnel (Art. 28(3)(b)).
- **Art. 32 security** (Art. 28(3)(c)).
- **Sub-processors:** no engagement without "prior specific or general written authorisation"; under general authorisation the processor must inform the controller of intended additions or replacements "thereby giving the controller the opportunity to object" (Art. 28(2)); the same data protection obligations must be flowed down by contract (Art. 28(4)).
- **Assistance** with data subject rights and with Arts. 32–36 (Art. 28(3)(e)–(f)).
- **Deletion or return** at end of service (Art. 28(3)(g)), and **audit/inspection** rights (Art. 28(3)(h)).
- **Breach notification to the controller "without undue delay"** (Art. 33(2)).
- **Liability** — Art. 28(10): a processor acting outside lawful instructions is treated as a controller for that processing.

**[HARD]** — GDPR Art. 28, Art. 33(2): EUR-Lex CELEX 32016R0679.

**What "good" looks like as a product artefact** (this is what church buyers' advisers actually review):

| Artefact | Minimum content | Cadence |
|---|---|---|
| DPA | Art. 28(3)(a)–(h) terms verbatim-mapped; liability; breach notice window (24–48h contractually); audit method (SOC 2 + questionnaire instead of on-site); deletion/export on termination | Published, versioned, countersigned in-app |
| Sub-processor list | Legal name, function, data categories, hosting region, transfer mechanism | Public URL, change notice 30 days, objection right |
| Security schedule | Encryption, tenancy isolation, access control, backup, pen test summary | Annual |
| DPIA pack | Pre-filled DPIA for a typical church, template for multi-campus | Per release of major feature |
| Data processing register | Purposes, categories, retention, recipients | Maintained |

**Sub-processor list is a live obligation, not a launch artefact.** Every new vendor — email, SMS, video, AI summarisation, error tracking, analytics — is a sub-processor if it touches personal data. Error-tracking tools that capture request bodies are the most common accidental processor.

### 1.7 International transfers

**There is no data localisation requirement in GDPR.** The regulation prohibits transfers to third countries without a transfer mechanism (Art. 44); it does not require EU hosting. This is the single most common misconception in church procurement questionnaires.

The mechanism hierarchy:

| Route | Instrument | Status at 29 Oct 2026 |
|---|---|---|
| Adequacy | Commission adequacy decision | EU→US: **EU–US Data Privacy Framework** (Commission Decision of 10 July 2023). Upheld by the General Court in *Latombe v Commission*, Case T-553/23, 3 September 2025 |
| Appropriate safeguards | 2021 Standard Contractual Clauses (2021/914) + transfer impact assessment | Default route for non-adequate countries |
| UK | UK IDTA, or the Addendum to the EU SCCs; UK adequacy regulations | UK→US covered **only** by the UK Extension to the EU–US DPF (in force 12 October 2023), and only for organisations certified under it |
| Derogations | Art. 49 | Not a basis for systematic, repetitive transfers |

**Evidence:** ICO international transfers guide (updated 29 May 2025) lists the US adequacy as limited to the UK Extension to the EU–US DPF and states the regulations came into effect 12 October 2023 — https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/international-transfers-a-guide/

**On *Latombe*:** two independent law-firm analyses confirm the General Court dismissed the challenge and upheld the 2023 adequacy decision on 3 September 2025 — Skadden, 5 September 2025, https://www.skadden.com/insights/publications/2025/09/eu-court-upholds-eu-us-data-flows ; Hunton, 3 September 2025, https://www.hunton.com/privacy-and-cybersecurity-law-blog/eus-general-court-confirms-adequacy-of-eu-u-s-data-privacy-framework . **Evidence grade: secondary (law-firm analysis), not the judgment itself.** The case number and outcome are consistent across both and with the Curia docket. Note the judgment is first-instance; appeal to the CJEU remains a live risk to the DPF's medium-term stability.

**Transfer impact assessment (TIA).** The EDPB's Recommendations 01/2020 set out the six-step supplementary-measures methodology that EU regulators expect to see documented alongside SCCs — https://www.edpb.europa.eu/our-work-tools/our-documents/recommendations/recommendations-012020-measures-supplement-transfer_en . **[HARD in practice]** — a TIA is not named in the regulation, but supervisory authorities treat its absence as an Art. 46 failure.

**Product requirement:** make the transfer story configurable, not fixed. A US-hosted platform serving a UK church needs (a) DPF certification for the US entity, or (b) SCCs/IDTA plus a TIA, and (c) a sub-processor list that shows region per vendor. Multi-region hosting (EU/UK region pinning) is a **`BUYER`** expectation, and for some denominations a hard procurement gate — see 1.9.

### 1.8 Retention schedules

GDPR does not prescribe retention periods. Art. 5(1)(e) requires that data be kept "no longer than is necessary for the purposes for which the personal data are processed". **[HARD]** — GDPR Art. 5(1)(e). Retention is therefore a documented, defensible decision per data class — and the failure mode is not "keeping too long" in the abstract, it is having no written schedule at all.

Some retention periods **are** fixed by tax law, and those bind the schedule:

| Data class | Suggested default | Driver / status |
|---|---|---|
| Member profile, contact, household | Life of membership + 24 months | Design default; document rationale |
| Pastoral care notes | 24 months from last contact, then review | Design default; highest sensitivity, separate access tier |
| Safeguarding records | Long (often to subject's 25th birthday or 7 years post-incident) | **`CONDITIONAL`** — depends on denominational safeguarding policy and, in the UK, on charity law duties; confirm with counsel |
| Giving / donation records | 7 years | Design default aligned to tax audit windows; UK 6 years + current year is the common charity baseline |
| **UK Gift Aid declarations** | **6 years after the most recent donation claimed** | **`HARD`** — GOV.UK, "Claiming Gift Aid": https://www.gov.uk/claim-gift-aid/gift-aid-declarations |
| **Canadian donation records** | **6 years from the end of the fiscal year covered** | **`HARD`** — CRA, Books and records: https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/books-records.html (requirement confirmed from CRA page summary; full page not opened this pass) |
| Children's check-in attendance | 90 days rolling, then aggregate | Design default; per-event exceptions for incidents |
| Allergy / medical flags | Purge at end of event or season; retain consent record | Design default; ties to 1.5 consent |
| Photos / media | Until consent withdrawn + 30 days | Design default |
| Audit logs | 12 months hot, 36 months cold | Design default; SOC 2 and incident response need ≥12 months |
| Backups | 35 days rolling + 12 monthly | Design default; reconcile with erasure (below) |
| DSAR / erasure request log | 3 years | Design default; accountability evidence |

**Deletion mechanics that survive an audit:**

- **Soft delete → hard delete with a deadline.** A `deleted_at` with no purge job is a finding waiting to happen.
- **Erasure in backups.** The defensible position is: delete from live systems immediately, suppress from restore by re-applying the erasure log after any restore, and let backups expire on their normal rotation. Document this in the DPA and the privacy notice. Do not promise "erasure from backups within 30 days" unless you actually rebuild backup sets.
- **Legal hold.** Erasure must not override a litigation hold or a tax-retention duty (Art. 17(3)(b),(e)). The product needs a hold flag that blocks purge and is itself audited.
- **Tenant-level retention settings.** A multi-campus church may need different retention per campus (e.g. one campus in the EU). Retention must be a policy object scoped to tenant and, ideally, to jurisdiction.

### 1.9 DSAR and erasure handling

**EU:** one month from receipt, extendable by two further months where necessary because of complexity or volume, with notice and reasons inside the first month. **[HARD]** — GDPR Art. 12(3).

**UK: changed in 2025, and most vendors' workflows are now wrong.** DUAA 2025 s.76 replaced the fixed clock with a new Art. 12A. The material changes:

- The period runs from the **"relevant time"**, defined as the latest of: receipt of the request; receipt of information requested to confirm identity; payment of any fee.
- The controller may **delay dealing with the request until identity is confirmed** (new Art. 12(6)(b)).
- **Stop the clock:** where the controller reasonably requires further information to identify the information or processing activities, the period between asking and receiving that information does not count. The example given is "where a controller processes a large amount of information concerning the data subject."
- Extension by two months remains, but notice must be given **before the end of the first month**.

**[HARD, UK]** — https://www.legislation.gov.uk/ukpga/2025/18/section/76/enacted

This is a genuine operational advantage for a ChMS with large pastoral-note volumes: the "reasonable and proportionate search" conversation is now statutorily supported by the stop-the-clock mechanism. But it requires the product to **record the clarification request and its response timestamps** — otherwise you cannot prove the clock stopped.

**Requirements:**

| ID | Requirement | Type |
|---|---|---|
| DP-20 | Self-service export of a member's data (profile, attendance, giving, consents, communications) as machine-readable archive | `HARD` (Art. 15, Art. 20) |
| DP-21 | Case management for DSARs: intake, identity verification, clock with stop-the-clock events, redaction of third-party data, response pack | `HARD` |
| DP-22 | Redaction tooling for pastoral notes referring to third parties (Art. 15(4) — rights of others) | `HARD` |
| DP-23 | Erasure workflow: legal-hold check, cascade across modules, suppression list, backup re-apply | `HARD` (Art. 17) |
| DP-24 | Exemption handling: safeguarding/legal-claims retention with documented reason | `HARD` (Art. 17(3)) |
| DP-25 | Children's erasure: guardian-initiated, with audit trail | `HARD` (Art. 17 + Art. 8) |
| DP-26 | Refusal logging with reasons (manifestly unfounded/excessive) | `HARD` (Art. 12(5)) |

**Erasure vs the membership roll.** A member leaving does not automatically mean erasure — the church may have a legitimate interest in a minimal historical record (who was a member when, for safeguarding and governance). The correct pattern is **two-tier erasure**: purge contact details, giving history beyond tax retention, and all special-category detail; retain a minimal, access-restricted membership-history record with a documented basis. This must be explained in the privacy notice, or the first erasure request becomes a complaint.

### 1.10 Data residency expectations: EU/UK churches vs US churches

This is where legal requirement and buyer expectation diverge most sharply.

| Expectation | EU / UK churches | US churches |
|---|---|---|
| Legal requirement to keep data in-region | **None.** GDPR/UK GDPR regulate transfers, not location | **None** federally. No general church data-residency law |
| What buyers actually ask | "Where is our data hosted?" and "Is it in the EU/UK?" — increasingly a board-level question, and a hard gate for some dioceses and denominational bodies | "Is it in the US?" — mainly a latency and vendor-stability question, not a sovereignty one |
| Transfer paperwork they expect | DPA + SCCs/IDTA + sub-processor list + TIA summary | DPA + sub-processor list; SCCs only if they have EU/UK members |
| Practical driver | Schrems-era caution, denominational policy, school/partner contracts | State breach-notification exposure, cyber-insurance questionnaires |
| Recommended product answer | EU and UK region options; region shown in-app; contractual commitment to region pinning for named tenants | US region default; US-only sub-processors where feasible |

**The commercial read:** region pinning is expensive (data gravity, per-region support, cross-region admin). Do not build it at launch. Do build the *abstraction* — a `data_region` attribute on tenant, region-aware storage buckets and database routing — so that the first six-figure EU denominational deal does not require a re-platform. Meanwhile, satisfy the 90% case with a truthful, specific answer to "where is our data" and a sub-processor list that names regions.

**US state privacy laws — not verified in this pass.** Most comprehensive state statutes are drafted around for-profit "businesses"/"controllers" and churches are commonly outside scope, but the position varies by state and some laws reach nonprofits. **I did not verify this state by state and it should not be asserted to customers.** Treat as an open item (Section 7).

---

## 2. Children's check-in data

Check-in is the highest-risk feature in the product and the one buyers evaluate most emotionally. It is also the feature where "what is legal" and "what is safe" diverge most.

### 2.1 What may be collected

Collect the minimum that makes the room safe. Every additional field increases Art. 9 exposure and breach impact.

| Field | Necessity | Classification | Basis |
|---|---|---|---|
| Child's first name + last initial | Yes — identification in room | Personal data; belief-revealing in context → Art. 9 | Guardian consent / 9(2)(d) if member |
| Date of birth or school grade | Yes — room allocation and safeguarding ratios | Personal data | Same |
| Guardian name, mobile, relationship | Yes — emergency contact and release authority | Personal data | Same |
| Authorised pickup list | Yes — release control | Personal data | Same |
| Allergy / medical flag | **Only if the church will act on it** | **Health data → Art. 9** | **Explicit guardian consent** (not vital interests — see 2.2) |
| Photo consent status | Yes — to honour refusals | Consent record | — |
| Custody / court-order restriction | Yes, where notified | Highly sensitive; may reveal legal claims | Guardian-provided, restricted access |
| Address, email of child, school, NHS/insurance number | **No** | — | Do not collect |

**Design rule:** every field on the check-in form must have a named person who will act on it and an action they will take. If the answer is "we just collect it", remove the field. This is Art. 5(1)(c) minimisation expressed as a product review gate.

### 2.2 Allergy and medical flags — the trap

The intuitive answer ("we need it for vital interests") is wrong as a routine basis. Art. 9(2)(c) permits processing "necessary to protect the vital interests of the data subject or of another natural person **where the data subject is physically or legally incapable of giving consent**". The ICO is explicit that this is "very limited" and "generally only applies to matters of life and death", and that "if a data subject refuses consent, you cannot rely on vital interests as a fallback condition, unless they are not legally competent to make that decision." **[HARD]** — ICO, conditions for processing, "(c) Vital interests".

So:

- **Routine collection** of a child's allergy data requires the guardian's **explicit consent** (Art. 9(2)(a)), separately presented, with the consequence of refusal explained (the church may not be able to admit the child to a room with food).
- **Vital interests** covers the emergency itself: a child collapses, is unconscious, and a leader discloses the allergy to a paramedic. That is a different processing operation from storing the flag.
- **Do not** allow a church to make allergy disclosure mandatory for attendance. Consent must be freely given; a mandatory field converts the basis to something else and undermines the consent for the whole form.
- **Access control:** allergy data visible only to the specific room's leaders for the specific session, not to all staff, not to the congregation, not in a printable "all allergies" report left at the desk. Time-boxed visibility is the security control that makes the consent defensible.

### 2.3 Guardian authorisation

Requirements:

- **Model the guardian relationship, not a single "parent" field.** A child may have two parents with different contact rights, a foster carer, a grandparent, and a court order restricting one party.
- **Consent must come from a person with parental responsibility.** In England & Wales this is a legal concept (not simply "the mother"); the product should record the basis on which the person is authorised, not assume it.
- **Separated parents:** the ChMS must support "do not release to X" flags that are visible at the pickup screen and that override an authorised-pickup list.
- **Verification:** at least one verified contact channel per guardian, and a re-verification prompt annually. An unverified email is not evidence of guardian authority for Art. 8(2) purposes.
- **Audit:** who added the guardian, when, from what source (form, in-person, import).

### 2.4 Pickup security codes

There is **no statutory requirement** for a pickup code. It is `BUYER` expectation and safeguarding good practice — which means it should be designed to a safety standard, not a compliance minimum.

Design specification worth committing to:

| Control | Requirement | Rationale |
|---|---|---|
| Code generation | Cryptographically random, ≥6 characters, unambiguous alphabet (no O/0, I/1) | Shoulder-surfing at a busy desk |
| Scope | Per child per session, not per family | Prevents one sibling's code releasing another |
| Rotation | New code each session; invalidate on release | Limits replay |
| Display | Code on the child's label and the guardian's confirmation — **never the child's full name on a public screen** | Privacy at the desk |
| Verification | Leader confirms code **and** visually confirms the person; code is a second factor, not the only factor | Codes get shared in WhatsApp groups |
| Duress/exception | A documented override path with a second leader's authorisation and an incident log | Real life: guardian sends a friend |
| Offline mode | Check-in must work when the Wi-Fi fails — local cache with encrypted storage, sync on reconnect, conflict resolution | Sunday-morning reality |
| No PII in the code | The code must not encode name, DOB, or member ID | Codes get photographed |

**Anti-pattern to avoid:** a "search by child name" kiosk with a public screen. It turns the check-in desk into a directory of every child in the building.

### 2.5 Photo policies at check-in

- **No photo on the check-in label or badge** unless the church has a specific safeguarding reason and guardian consent. Photo labels end up in bins, car parks and social media.
- **No photo capture at the kiosk** for "security" unless there is a documented DPIA, signage, retention period (typically days, not months), and a lawful basis. CCTV-style capture in a children's area is a high-risk processing operation.
- **Consent status must be visible to the leader at the point of capture** — a camera icon with a red slash on the child's row — otherwise volunteers will photograph the one child whose guardian refused.
- **Class/group photos** are publication, not check-in. Treat under 1.5.

### 2.6 Check-in requirements register

| ID | Requirement | Type |
|---|---|---|
| CHK-01 | Minimum-field check-in form, configurable per campus, with field-level justification | `BUYER` / design |
| CHK-02 | Allergy/medical flag on explicit guardian consent, separately presented, with time-boxed visibility | `HARD` (Art. 9(2)(a)) |
| CHK-03 | Guardian relationship model with parental-responsibility basis and release restrictions | `HARD` (Art. 8(2)) |
| CHK-04 | Random per-child per-session pickup code; no PII encoded; visual confirmation required | `BUYER` |
| CHK-05 | Offline-capable check-in with encrypted local cache and sync reconciliation | `BUYER` (safety) |
| CHK-06 | Photo-consent flag surfaced at every capture point; hard block for safeguarding holds | `HARD` (Art. 9 disclosure) |
| CHK-07 | No child-facing account, chat, or profile; no photo upload by children | `CONDITIONAL` (COPPA exposure reduction) |
| CHK-08 | 90-day attendance retention default, per-tenant configurable | design |
| CHK-09 | Incident log for release overrides, with second-leader authorisation | `BUYER` (safeguarding) |
| CHK-10 | Kiosk session auto-lock and no persistent PII on screen | `HARD` (Art. 32) |

---

## 3. Payments

### 3.1 PCI DSS: SAQ A vs SAQ A-EP

The eligibility rule is architectural and unforgiving. PCI SSC states it plainly:

> "To be eligible for SAQ A, all elements of the payment pages must only originate from PCI DSS compliant service provider(s), and no single element of a payment page can originate from the merchant's website."
> "To be eligible for SAQ A-EP, each individual element of the payment page must originate from *either* the merchant website or from a PCI DSS compliant service provider."

**[HARD, contractual/network rules]** — PCI SSC FAQ: https://www.pcisecuritystandards.org/faqs/if-a-merchant-s-e-commerce-implementation-meets-the-criteria-that-all-elements-of-payment-pages-originate-from-a-pci-dss-compliant-service-provider-is-the-merchant-eligible-to-complete-saq-a-or-saq-a-ep

| Architecture | SAQ | What you take on |
|---|---|---|
| Redirect to Stripe-hosted Checkout, or fully hosted payment link | **SAQ A** | Minimal; no card data touches your origin |
| Embedded iframe / Stripe Elements where all payment fields come from Stripe | **SAQ A** *if* you meet the v4.0.1 script criterion | Must confirm site is "not susceptible to attacks from scripts" |
| Your page collects card fields, or your JS handles the PAN before tokenising | **SAQ A-EP** | 6.4.3 (payment-page script management) + 11.6.1 (change/tamper detection) and a much larger control set |
| You store, process or transmit PAN | SAQ D / full ROC | Do not do this |

**The 2025 change that caught vendors out.** PCI DSS v4.0.1 SAQ A r1 added an eligibility criterion: "The merchant has confirmed that their site is not susceptible to attacks from scripts that could affect the merchant's e-commerce system(s)." PCI SSC FAQ 1588 (published 28 February 2025) clarifies this can be met either by applying techniques such as those in 6.4.3 and 11.6.1 yourself, **or** by obtaining confirmation from the PCI DSS-compliant TPSP/payment processor that, when implemented per its instructions, its solution includes techniques protecting the payment page from script attacks. The criterion applies only to merchants with an embedded payment page/iframe — **not** to redirects or fully outsourced payment.

**[HARD]** — PCI SSC, "FAQ Clarifies New SAQ A Eligibility Criteria for E-Commerce Merchants", 28 February 2025: https://blog.pcisecuritystandards.org/faq-clarifies-new-saq-a-eligibility-criteria-for-e-commerce-merchants

**Decision for this product:** use **Stripe-hosted Checkout via redirect** for donation and event payments, and **do not** build a custom card form. That keeps every church tenant in SAQ A, removes 6.4.3/11.6.1 from their scope, and makes the security questionnaire answer one sentence. If embedded Elements are required for conversion reasons, obtain and retain Stripe's written script-protection confirmation, and put the SAQ A eligibility evidence in the trust centre.

**Important scope note:** SAQ A is the *merchant's* self-assessment. It does not make the platform "PCI compliant" in a way that transfers to tenants. Each church is its own merchant, with its own acquirer relationship. The platform's job is to make SAQ A true and easy to evidence — not to certify the church.

### 3.2 Stripe Connect: who is the merchant, who eats the chargeback

Stripe's Connect documentation does not use the phrase "merchant of record" for direct charges; it uses **"business of record"**, settable via `on_behalf_of`. The operative facts are in the charge-type documentation:

| | **Direct charges** | **Destination charges / separate charges and transfers** |
|---|---|---|
| Where the charge sits | Connected account (the church) | Platform account |
| Statement descriptor / branding | Connected account's | Platform's, unless `on_behalf_of` is set |
| Funds settle | In the connected account's country | Platform's balance, then transferred |
| Refunds | Debited from the **connected account's** balance; if insufficient, refund goes `pending` | Debited from the **platform's** balance; you may reverse the transfer |
| Chargebacks | Debited from the **connected account's** balance | Debited from the **platform's** balance |
| Stripe fees | Platform chooses whether Stripe bills the connected account or the platform | Platform's pricing plan, assessed on the platform |
| Merchant-of-record read | **Church** | **Platform** |

**[CONTRACTUAL]** — Stripe, "Charges in a Connect integration": https://docs.stripe.com/connect/charges ; "Disputes on Connect": https://docs.stripe.com/connect/disputes

**The liability trap.** Stripe's disputes documentation adds: "If you're using Express or Custom legacy account types, your platform is responsible for disputes and fraud." And on pricing: "When a platform or marketplace creates direct charges on a connected account, the connected account is responsible for the cost of Stripe fees, refunds, and chargebacks. Stripe covers loss liability for these connected accounts." — https://stripe.com/connect/pricing

Read together: **direct charges + Standard accounts** puts chargeback and refund liability on the church, with Stripe covering loss liability. **Express/Custom** moves dispute and fraud responsibility to the platform. For a ChMS where the platform is a software vendor and not a payments business, **Standard accounts with direct charges** is the defensible default: the church owns its donor relationship, its statement descriptor, its refunds, and its chargebacks.

**What the platform still owns even with Standard accounts:**

- Application fee collection, and the refund decision — "Application fees aren't automatically refunded when issuing a refund. Your platform must explicitly refund the application fee or the connected account … loses that amount." Pass `refund_application_fee: true` by default, or you will quietly claw back fees from churches on every refund.
- Onboarding quality. With API onboarding, "your platform is responsible for all interactions with your connected accounts and for collecting all the information needed to verify each account. You must plan on reviewing and updating onboarding requirements at least every 6 months." Hosted/embedded onboarding "automatically update to handle changing requirements". — https://docs.stripe.com/connect/onboarding
- KYC is performed by Stripe, but **the platform remains responsible for its own AML/sanctions obligations and for the accuracy of what it submits**. Do not describe Stripe as "handling compliance" in customer-facing material.

**Recommended configuration:**

1. Standard connected accounts, direct charges, `application_fee_amount` for platform revenue.
2. Stripe-hosted onboarding (not API onboarding) — it absorbs requirement changes across countries, which is the single largest maintenance cost in a multi-country ChMS.
3. `refund_application_fee: true` default, with an admin override for policy exceptions.
4. Never use destination charges for donations — it makes the platform the merchant and the chargeback bearer.

### 3.3 Fees and the economics of small recurring gifts

Current published US pricing (29 October 2026):

- Payments: **2.9% + 30¢** per successful card charge.
- Connect, "you handle pricing" model: **$2 per monthly active account** (active = a month in which payouts are sent) + **0.25% + 25¢ per payout**; Instant Payouts 1%; cross-border payouts from 0.25%; funds routing 0.25% of payout volume; 1099 e-filing $2.99 each.
- Connect, "Stripe handles pricing" model: **no platform fee**; Stripe bills the connected accounts directly and the platform may earn a revenue share.

**[CONTRACTUAL, price-sensitive]** — https://stripe.com/connect/pricing

**Fee math that should drive the product, not the pricing page.** On a $10 weekly gift, 2.9% + 30¢ = 59¢, i.e. **5.9%** of the gift. On a $2,000 gift the same fee is 1.05%. Small recurring gifts are the worst case for card processing, and they are the modal church donation. Consequences:

- Offer **ACH (US) / SEPA Direct Debit (EU) / Bacs (UK)** for recurring gifts — materially cheaper per transaction and better retention. Confirm current pricing with Stripe before modelling.
- Show the fee to the donor as an optional "cover the fees" uplift; this is standard nonprofit practice and converts well.
- Do not let the platform's application fee be a percentage of small gifts without modelling the all-in cost to the church — a 1% platform fee on a $10 gift is a 10% surcharge on the processor's 5.9%.
- Reconcile per-gift, not per-batch. Churches audit against bank deposits.

### 3.4 Donor-facing recurring gifts

Requirements:

- **SCA/3DS handling** for EU/UK cards, including re-authentication on mandate changes. Stripe handles the flow; the product must handle the `requires_action` state gracefully in the member portal.
- **Mandate storage and evidence** — who authorised, when, amount, frequency, and the exact wording of the authorisation. This is the artefact in a chargeback.
- **Dunning and card-expiry recovery** — retry schedule, donor notification, and a self-service "update card" link. Failed recurring gifts are the largest silent revenue leak in church giving.
- **Pause/stop in one click** from the member portal, honoured immediately. A donor who cannot stop a gift disputes it instead.
- **Pledge vs gift distinction** — a pledge is not a payment; do not create a receipt until money moves.
- **Designated funds** — restrict how a gift can be reallocated; this is a donor-intent and, for some churches, a trust-law question. **`CONDITIONAL`**, flag to counsel.

### 3.5 Charitable receipts and tax acknowledgments

This is the area where a generic payments integration fails most visibly. Each jurisdiction has a different document, trigger and retention rule, and the church — not the platform — is the issuer.

#### United States — 501(c)(3) contemporaneous written acknowledgment

A donor may deduct a contribution of **$250 or more** only with a **written acknowledgment** from the charity. The IRS specifies the required content:

- name of the organisation;
- amount of cash contribution;
- description (but not value) of non-cash contribution;
- a statement that no goods or services were provided, if that is the case;
- description and good faith estimate of the value of goods or services provided, if any; and
- a statement that goods or services consisted entirely of **intangible religious benefits**, if that was the case.

**[HARD, US]** — IRS, "Charitable contributions: Written acknowledgments" (page last reviewed 28 June 2026): https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments ; see also IRS Publication 1771, "Charitable Contributions — Substantiation and Disclosure Requirements": https://www.irs.gov/pub/irs-pdf/p1771.pdf

Product implications:

- The **$250 test is per single gift**, not per year — so the acknowledgment engine must evaluate each gift, not an annual total. (A single gift can be satisfied by one acknowledgment covering multiple payments if the donor's records are adequate — confirm with counsel; the safe default is per-gift.)
- **Timing:** the donor must have the acknowledgment by the earlier of the date they file the return or the due date (including extensions). Practically, issue at year-end and on demand.
- **Quid pro quo** — a dinner ticket, auction item, or merchandise changes the document. The engine needs a "goods/services received" field with a good-faith value, and must produce the "intangible religious benefits" statement where applicable (e.g. a mass intention or membership benefit that is religious in nature).
- **Do not** issue a tax receipt for a payment that is really a purchase (book, ticket, coffee).

#### United Kingdom — Gift Aid

A charity can reclaim **25p for every £1** donated, provided the donor has paid enough UK Income Tax or Capital Gains Tax in that tax year and has made a **Gift Aid declaration**. The declaration must state that the donor has paid the same amount or more in tax and agrees to Gift Aid being claimed, and must include:

- a description of the gift;
- the name of the charity or CASC;
- the donor's full name;
- the donor's full home address **including postcode** (or a statement that they are a "non-UK donor" if they do not live in the UK).

Records of declarations must be kept for **6 years after the most recent donation claimed**. Where there is no declaration, a charity may still claim on **cash donations of £30 or less** under the small donations scheme.

**[HARD, UK]** — GOV.UK, "Claiming Gift Aid as a charity or CASC": https://www.gov.uk/claim-gift-aid ; declarations: https://www.gov.uk/claim-gift-aid/gift-aid-declarations ; overview: https://www.gov.uk/claim-gift-aid

Product implications:

- The declaration is a **durable, auditable object** — not a checkbox on a payment form. It needs versioned wording, the date and channel of declaration, the address as given, and an end-date when withdrawn.
- **Aggregation is where money is lost.** Gift Aid claims are made per donation; the product should produce a claim-ready export per tax year, flagging donations with no valid declaration at the time of gift.
- **Postcode is mandatory** — a free-text address field without a postcode lookup will fail audits.
- **Withdrawal** must stop future claims but not invalidate past ones (past claims stand if valid when made — confirm with counsel).

#### Canada — CRA official donation receipts

An official donation receipt must be readable and not easily altered, and for cash gifts must include:

- a statement that it is an official receipt for income tax purposes;
- the name and address of the charity as on file with CRA;
- a **unique serial number**;
- the **CRA registration number**;
- the location where the receipt was issued (city/town/municipality);
- the date or year the gift was received, and the date the receipt was issued;
- the donor's full name (including middle initial) and address;
- the amount of the gift;
- the amount and description of any **advantage** received by the donor;
- the **eligible amount** of the gift;
- the signature of an individual authorised by the charity to acknowledge gifts;
- the name and website address of the CRA.

Non-cash gifts add the gift date, a brief description, and the appraiser's name and address where appraised; value is fair market value at the time of the gift.

**[HARD, CA]** — CRA, "What information must be on an official donation receipt": https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/issuing-receipts/what-information-must-on-official-donation-receipt-a-registered-charity.html

Product implications: **serial number uniqueness and sequencing** must be enforced per charity; the "advantage" and "eligible amount" fields must exist even if usually zero; and receipts must be immutable once issued (void-and-reissue, never edit).

#### Australia — DGR

A deduction requires a gift to an organisation with **deductible gift recipient (DGR) status at the time of the gift**, made voluntarily with no material benefit, of money or property. ATO guidance states: "Most DGRs will issue you with a receipt for your donation, but not all DGRs are required to." Where a DGR does issue a receipt for a deductible gift, it must state:

- the name of the fund, authority or institution;
- the DGR's **ABN** (some DGRs listed by name may not have one);
- that it is for a gift;
- the donor's name, if the donation was to a community charity or ancillary fund.

**[HARD, AU — content if issued]** — ATO, "Gifts and donations": https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/deductions-you-can-claim/gifts-and-donations

Two current-Australia details worth encoding:

- **The $2 threshold has been removed.** From 1 July 2026 the minimum $2 threshold for claiming a deduction was removed, backdated to apply to gifts made from **1 July 2024** (political donations excluded). **`HARD`, AU** — same ATO page.
- **DGR status is entity-specific.** ATO lists "religious organisations" among the categories for which a deduction cannot be claimed without DGR status. A church must be endorsed or listed; the platform should capture and display DGR status and ABN per tenant, and refuse to issue a "tax deductible" receipt where status is unverified.

#### Receipting requirements register

| ID | Requirement | Type |
|---|---|---|
| PAY-10 | Jurisdiction-aware receipt engine: US CWA ($250 per gift), UK Gift Aid declaration, CA official receipt, AU DGR receipt | `HARD` |
| PAY-11 | Immutable issued receipts with void/reissue, not edit | `HARD` (CA, and audit hygiene) |
| PAY-12 | CA per-charity serial number sequence; CRA registration number; advantage + eligible amount fields | `HARD` |
| PAY-13 | UK postcode validation; declaration versioning, withdrawal, 6-year retention and claim export | `HARD` |
| PAY-14 | US goods/services + intangible-religious-benefits statements; per-gift $250 evaluation | `HARD` |
| PAY-15 | AU ABN + DGR status capture; "tax deductible" labelling gated on verified status | `HARD` |
| PAY-16 | Annual statement and on-demand duplicate receipt for donors | `BUYER` |
| PAY-17 | Fees-covered uplift and designated-fund accounting in the receipt total | `BUYER` |

> **Framing for the founder:** the platform should describe itself as **receipt tooling**, not as providing tax advice. Every receipt template should be reviewed by local counsel or a charity-tax adviser before launch in that jurisdiction, and the tenant should be able to edit the wording within a constrained template.

---

## 4. Security baseline

Security is where `HARD` and `BUYER` interleave most tightly: the law sets an outcome ("appropriate technical and organisational measures"), and the market has converged on a specific evidence set. Build to the evidence set; cite the law.

### 4.1 The legal floor

| Obligation | Source | What it actually requires |
|---|---|---|
| Appropriate technical and organisational measures, risk-based | GDPR Art. 32(1) | "a level of security appropriate to the risk", including as appropriate: encryption, ongoing confidentiality/integrity/availability/resilience, and **"the ability to restore the availability and access to personal data in a timely manner in the event of a physical or technical incident"** |
| Encryption expressly contemplated | Art. 32(1)(a) | "the pseudonymisation and encryption of personal data" |
| Regular testing and evaluation | Art. 32(1)(d) | "a process for regularly testing, assessing and evaluating the effectiveness of technical and organisational measures" — this is the legal hook for penetration testing and restore testing |
| Staff process only on instructions | Art. 29, Art. 32(4) | "ensuring that any natural person acting under the authority of the controller or processor … does not process them except on instructions from the controller" — the legal hook for RBAC and least privilege |
| Processor assists the controller | Art. 28(3)(f) | Assistance with Arts. 32–36 |
| Breach notification | Art. 33 | Controller: 72 hours. Processor: "without undue delay" |
| Records of processing | Art. 30 | Including categories of data and security measures |

**[HARD]** — GDPR Arts. 28–33: EUR-Lex CELEX 32016R0679.

Note the asymmetry that matters commercially: **Art. 32 does not name MFA, RBAC, SIEM, or SOC 2.** It names outcomes. That is why the sales conversation is about evidence, not statute — and why a vendor who can only say "GDPR compliant" loses to one who can produce a SOC 2 Type II and a pen-test summary.

### 4.2 Controls a church buyer will actually ask about

| # | Control | Minimum bar | Type | Evidence to hold |
|---|---|---|---|---|
| SEC-01 | **MFA** | Enforced for all admin/staff accounts; TOTP or passkey; SMS only as fallback; recovery codes; **paste and password-manager support** (see 5.3) | `HARD` if card data in scope (PCI DSS 8.4); otherwise `BUYER` + Art. 32 | Screenshot, policy, enforcement report |
| SEC-02 | **RBAC** | Role templates (admin, staff, leader, volunteer, finance, safeguarding); least privilege; per-campus scoping; no shared logins; break-glass account with alerting | `HARD` (Art. 29/32(4)) | Role matrix, access review log |
| SEC-03 | **Audit logging** | Immutable, append-only; who/what/when/before-after for auth, permission changes, record views on sensitive data, exports, receipt voids, erasure; retained ≥12 months; tenant-visible | `HARD` (Art. 5(2), 32; PCI 10 if in scope) | Log schema, retention config, sample export |
| SEC-04 | **Encryption in transit** | TLS 1.2+ (1.3 preferred), HSTS, no mixed content, strong cipher suites | `HARD` (Art. 32(1)(a)) | Scan report / SSL Labs grade |
| SEC-05 | **Encryption at rest** | AES-256 at rest for DB, object storage, backups; **field-level encryption for Art. 9 fields** (pastoral notes, allergy, safeguarding) with separate key scope | `HARD` (Art. 32(1)(a)) | KMS config, key policy |
| SEC-06 | **Key management** | KMS/HSM, annual rotation, separation of duties, no keys in code or env plaintext | `HARD` (Art. 32) | Key policy, rotation log |
| SEC-07 | **Backups** | Encrypted, cross-region or cross-AZ, immutable/object-lock for ransomware, RPO/RTO documented per tenant tier | `HARD` (Art. 32(1)(c)) | Backup policy, restore test record |
| SEC-08 | **Restore testing** | **Quarterly** restore of a real tenant dataset into an isolated environment, timed against RTO, with a written result | `HARD` (Art. 32(1)(c)–(d)) | Signed test reports |
| SEC-09 | **Tenant isolation** | Row-level security or schema-per-tenant; isolation tests in CI; no cross-tenant query path; pen-test scope item | `HARD` (Art. 32; multi-tenancy risk) | Architecture doc, test results |
| SEC-10 | **Vulnerability management** | Dependency scanning, SAST, container scanning, critical patch SLA (e.g. 7 days critical, 30 high) | `HARD` (Art. 32(1)(d)) | Scan history, SLA report |
| SEC-11 | **Penetration testing** | **Annual external + application test**, plus after major architectural change; remediation tracked to closure; summary available to customers under NDA | `HARD` if PCI in scope (PCI DSS 11.4: at least annually and after significant change); otherwise `BUYER` | Report + retest letter |
| SEC-12 | **Incident response plan** | Roles, severity matrix, comms templates, 72-hour clock runbook, processor→controller notification procedure, tabletop **annually** | `HARD` (Arts. 33–34) | Plan, tabletop record |
| SEC-13 | **Breach notification** | Controller: 72h to supervisory authority; processor: to controller without undue delay, contractually 24h; documented decision log for "not notifiable" | `HARD` | Runbook, contract clause |
| SEC-14 | **Access reviews** | Quarterly review of admin access; leavers within 24h; MFA reset on role change | `HARD` (Art. 32(4)) | Review evidence |
| SEC-15 | **Secure SDLC** | Threat modelling for new features touching Art. 9 data; code review; secrets scanning; dependency pinning | `HARD` (Art. 25, 32) | SDLC policy |
| SEC-16 | **Sub-processor security** | Security review before onboarding; annual reassessment; contractual flow-down | `HARD` (Art. 28(2),(4)) | Vendor register |
| SEC-17 | **Data deletion** | Tenant offboarding: export, then deletion within a contracted window, with certificate | `HARD` (Art. 28(3)(g)) | Offboarding runbook |
| SEC-18 | **Admin hardening** | Separate admin plane, IP allow-listing optional, no admin access from member-facing app, session timeout, device trust | `BUYER` + Art. 32 | Config evidence |

### 4.3 SOC 2 Type II: timing, cost, and what it does not do

**SOC 2 is not a legal requirement.** It is an AICPA attestation report — a CPA's opinion on controls relevant to Security, Availability, Processing Integrity, Confidentiality or Privacy. It is a `BUYER` requirement, and in the 500+ attender segment it is increasingly a gate.

- **Type I** = design of controls at a point in time. Fast, cheaper, and worth little to a sophisticated buyer.
- **Type II** = operating effectiveness **over a period**. This is what buyers want, because it tests that you actually did the thing for months.

**Timing.** A Type II report cannot be produced faster than its observation window. Market practice: first audit 3–6 months of observation, subsequent audits 12 months, with auditor fieldwork 4–6 weeks after the window closes. End-to-end, plan **6–12 months** from "starting the programme" to "report in hand".

**Cost (market estimates, not quotes).** Vendor benchmarks put the Type II audit fee at **$12,000–$20,000 for small/mid-size companies** and **$30,000–$100,000+ for larger organisations**, with total first-year cost (audit + readiness + tooling + internal time) of roughly **$25,000–$200,000+**; a 25-person startup scenario is benchmarked at **~$28,000 all-in**, and ongoing maintenance at **$15,000–$40,000/year**.

**Evidence grade: low-to-medium.** These are vendor marketing pages, not audited data — Drata, "SOC 2 Compliance Cost: Complete Breakdown for 2026": https://drata.com/learn/soc-2/cost (accessed 29 Oct 2026). Corroborating ranges from other vendors (Strac, RedSecLabs, Modus) are broadly consistent. Treat as a budgeting range, and get three quotes.

**What SOC 2 does not do:** it does not certify GDPR compliance, does not cover the churches' own configurations, and does not substitute for a DPA. Do not let it crowd out the Art. 28 paperwork.

**Sequencing recommendation:** Year 1 — Type I plus a clean pen test plus a public trust centre. Year 2 — Type II with a 6-month window, timed to the first enterprise/denominational deal. Starting Type II before the product stabilises wastes the observation window on controls you will change.

### 4.4 Penetration testing cadence

- **PCI DSS** requires penetration testing at least annually and after any significant change to the environment (Requirement 11.4 in v4.0.1; standard text via https://www.pcisecuritystandards.org/). **[HARD if card data in scope]** — requirement number asserted from v4.0.1; the standard document itself was not opened this pass.
- Otherwise, annual is the market bar. `BUYER`.
- **Practical cadence for this product:** annual external + web app test by an independent firm; a lighter authenticated test after any change to authentication, permissions, or the payment flow; continuous automated scanning in CI.
- **Scope must include:** tenant-isolation attempts, IDOR on member/child records, privilege escalation via role assignment, receipt tampering, kiosk offline cache, and file-upload paths (photos are the classic vector).
- Budget: vendor benchmarks put a pen test at **$5,000–$15,000** (Drata, above). For a multi-tenant app with a kiosk surface, expect the upper half.

### 4.5 Incident response and breach notification windows

| Regime | Clock | Trigger | Source |
|---|---|---|---|
| **EU GDPR** | **72 hours** to the supervisory authority, "without undue delay and, where feasible, not later than 72 hours after having become aware of it" | Awareness of a personal data breach, unless unlikely to result in a risk | GDPR Art. 33(1): https://gdpr-info.eu/art-33-gdpr/ |
| **EU GDPR — processor** | **"Without undue delay"** to the controller | Processor becoming aware | GDPR Art. 33(2) |
| **EU GDPR — data subjects** | Without undue delay | Where the breach is likely to result in **high risk** to rights and freedoms | GDPR Art. 34 |
| **UK GDPR** | 72 hours to the ICO | Same structure as EU | UK GDPR Art. 33 (as retained/amended); ICO breach reporting guidance |
| **US states** | Varies — typically "without unreasonable delay", with some statutes setting outer limits (30/45/60 days) | Breach of personal information as defined by each statute | **Not verified in this pass — see Section 7** |
| **Contractual (typical)** | 24–48 hours to the controller | Any confirmed or suspected breach | Market practice; put 24h in your DPA |

**Operational requirements that follow:**

1. **The clock starts at awareness, not confirmation.** A support ticket saying "I can see another church's member list" is awareness. The runbook must start the timer at triage, not at root cause.
2. **A documented "not notifiable" decision is as important as a notification.** Art. 33(5) requires you to document all breaches, including those you decide not to notify, with reasons.
3. **Multi-tenant breach = many controllers.** A single platform incident may require notifying hundreds of churches, each of whom has its own 72-hour clock. Pre-build a tenant notification console: affected-tenant determination, per-tenant fact sheet, and a single send.
4. **Do not speculate in the first notification.** Art. 33(4) permits phased notification. Send facts, scope, containment, and next update time; resist attributing cause early.
5. **Tabletop annually**, including a scenario where the processor (you) must notify 300 churches within 24 hours.

---

## 5. Accessibility

### 5.1 WCAG 2.2 AA as the target

WCAG 2.2 was published as a W3C Recommendation on 5 October 2023 and is backwards-compatible with 2.1 and 2.0: content conforming to 2.2 also conforms to 2.1. **[Standard, not law]** — https://www.w3.org/TR/WCAG22/

Choosing 2.2 AA rather than 2.1 AA is a deliberate `BUYER` decision: 2.1 is what the ADA Title II rule references, but 2.2 is what sophisticated buyers and EU procurement now ask for, and it adds criteria that matter specifically for an admin-heavy app.

**The WCAG 2.2 additions that hit this product hardest:**

| SC | Level | Why it matters here |
|---|---|---|
| **2.4.11 Focus Not Obscured (Minimum)** | AA | Sticky headers, modals, and toast notifications in a dense admin UI routinely cover the focused control |
| **2.5.7 Dragging Movements** | AA | Drag-and-drop seating charts, roster assignment, and giving-category sorting need a non-drag alternative (up/down buttons, "move to" menu) |
| **2.5.8 Target Size (Minimum)** | AA | 24×24 CSS px minimum — breaks icon-only action columns in tables and small close buttons in modals |
| **3.2.6 Consistent Help** | A | Help/contact must appear in the same relative order on every page — easy to violate with per-page widgets |
| **3.3.7 Redundant Entry** | A | Multi-step check-in and volunteer onboarding must not re-ask for information already given in the same process |
| **3.3.8 Accessible Authentication (Minimum)** | AA | **No cognitive function test** — this constrains MFA design: allow paste into code fields, support password managers, and do not use puzzle CAPTCHAs |

### 5.2 What "AA" means for an admin-heavy app

The failure modes are predictable, and they are mostly about tables, forms, and state:

- **Data tables** — real `<table>` semantics with `<th scope>`, not div grids; sortable headers must expose `aria-sort`; row selection must be keyboard-operable; pagination must announce the new page.
- **Forms** — every input programmatically labelled; errors identified in text and linked to the field (3.3.1); error suggestions provided (3.3.3); no placeholder-as-label.
- **Focus management** — focus moves to the modal on open and returns to the trigger on close; no focus traps outside modals (2.1.2); visible focus indicator meeting 2.4.7 and preferably 2.4.13.
- **Status messages** — "Saved", "12 records deleted", "Payment failed" must be announced via live regions (4.1.3), not just shown as a coloured toast.
- **Colour** — 4.5:1 for text (1.4.3), 3:1 for UI components and graphical objects (1.4.11). Church brands are frequently low-contrast pastels; the theming layer must **block** non-conforming brand colours or auto-correct them.
- **Zoom and reflow** — usable at 400% zoom / 320 CSS px width (1.4.10); admin tables are the usual casualty.
- **Keyboard completeness** — every action reachable without a mouse (2.1.1), including bulk actions, filters, and date pickers.

**The hardest structural issue:** a per-tenant theming system is an accessibility liability. If churches can set their own brand colours, some will produce 2.5:1 contrast. The product needs a contrast validator in the theme editor that refuses to save a failing palette — cheaper than remediating 3,000 tenant themes later.

### 5.3 What "AA" means for a kiosk UI

Kiosks add physical context that the guidelines anticipate but do not spell out. WCAG's own abstract notes the guidelines address content "on any kind of device (including desktops, laptops, kiosks, and mobile devices)" — https://www.w3.org/TR/WCAG22/

| Constraint | Design requirement | WCAG hook |
|---|---|---|
| Standing, one-handed, possibly holding a child | Primary targets **≥44×44 px** (exceeding the 24 px minimum); large hit areas; no precision gestures | 2.5.8, 2.5.5 (AAA as design goal) |
| Bright lobby, glare, cheap screens | Contrast target **7:1** for critical text; avoid thin fonts; dark-on-light default; test at 100% brightness | 1.4.3 / 1.4.6 |
| Queue pressure and timeouts | Session timeout **≥ 2 minutes** with a warning and a way to extend; no data loss on timeout | 2.2.1, 2.2.6 |
| Shared device, privacy | Auto-clear screen after each transaction; no residual names, codes, or allergy data on screen | Art. 32; 2.2.6 |
| Gloves, wet hands, accessibility switches | Support keyboard/switch input and an on-screen numeric keypad; do not rely on capacitive multi-touch | 2.1.1, 2.5.1 |
| Screen readers on shared devices | Kiosk mode should not trap AT users; provide a "use my phone instead" QR path | 2.1.2, 1.3.1 |
| Sound | Never rely on audio alone for success/failure; pair with visual + haptic where available | 1.1.1, 1.2.x |
| Flashing/animation | No celebratory flashing on check-in success | 2.3.1 |

**Kiosk-specific trap:** the check-in flow is often built as a single-page app with custom divs for speed. That fails 1.3.1, 2.1.1 and 4.1.2 simultaneously. Build the kiosk on the same component library as the web app, not as a bespoke screen.

### 5.4 The legal position, jurisdiction by jurisdiction

| Jurisdiction | Position | Type |
|---|---|---|
| **US — ADA Title III** | Title III does not apply to "religious organizations or entities controlled by religious organizations, including places of worship" (42 U.S.C. § 12187). **Churches are exempt.** The platform vendor is not a religious organisation, so it cannot rely on the same exemption | `HARD` (exemption), https://www.law.cornell.edu/uscode/text/42/12187 |
| **US — ADA Title II** | Applies to state and local government, not churches. Technical standard is **WCAG 2.1 AA**. Compliance dates were **extended on 20 April 2026** by Interim Final Rule: **26 April 2027** for entities ≥50,000 population, **26 April 2028** for smaller/special districts | `HARD` (for public entities), https://www.ada.gov/resources/2024-03-08-web-rule/ |
| **US — state law** | State civil-rights statutes (e.g. Unruh in California) may reach business establishments; application to a SaaS vendor and to a church is fact-specific | `CONDITIONAL` — **not verified in this pass** |
| **EU — European Accessibility Act** | Directive (EU) 2019/882 applies to products and services placed on the market / provided **on or after 28 June 2025**, including e-commerce services. Consumer-facing donation checkout is the exposure; a B2B admin console is likely out of scope | `CONDITIONAL` — Directive: https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32019L0882 ; application date confirmed by Irish Government guidance (4 Nov 2025): https://www.gov.ie/en/department-of-children-disability-and-equality/publications/european-accessibility-act |
| **UK** | Equality Act 2010 requires reasonable adjustments; no private-sector web accessibility regulations equivalent to the public-sector 2018 Regulations. Enforcement is complaint-driven | `HARD` (general duty), no technical standard specified |
| **Procurement reality** | Buyers ask for a **VPAT / Accessibility Conformance Report** against WCAG 2.2 AA, plus an accessibility statement and a remediation roadmap | `BUYER` |

**The practical read for the founder:** accessibility will not be enforced against your church customers in the US. It will be enforced against **you** in the EU if you sell donation checkout to EU consumers, and it will be used as a **procurement discriminator** everywhere. The cheapest strategy is to build to WCAG 2.2 AA from the component library up, publish an ACR, and treat the kiosk as a first-class surface rather than an afterthought.

### 5.5 Accessibility requirements register

| ID | Requirement | Type |
|---|---|---|
| ACC-01 | WCAG 2.2 AA conformance target across web app, member portal, and kiosk | `BUYER` / `CONDITIONAL` (EAA) |
| ACC-02 | Accessible component library with automated axe-core checks in CI and a11y review gate on PRs | `BUYER` |
| ACC-03 | Contrast validator in tenant theme editor that blocks non-conforming palettes | `BUYER` |
| ACC-04 | Keyboard-complete admin tables, including bulk actions and filters | `HARD` (EAA) / `BUYER` |
| ACC-05 | Drag-and-drop alternatives for every drag interaction | `BUYER` (2.5.7) |
| ACC-06 | MFA that permits paste and password managers; no puzzle CAPTCHA | `BUYER` (3.3.8) |
| ACC-07 | Kiosk: ≥44 px targets, 2-minute minimum timeout with warning, auto-clear, no PII residue | `BUYER` |
| ACC-08 | Published Accessibility Conformance Report (VPAT) against WCAG 2.2 AA, refreshed annually | `BUYER` |
| ACC-09 | Public accessibility statement with feedback channel and remediation SLA | `BUYER` / `HARD` (EAA) |
| ACC-10 | Manual screen-reader testing (NVDA + VoiceOver) each release for core flows | `BUYER` |

---

## 6. Consolidated requirements register (launch-critical subset)

The rows below are the ones that should be in the v1 scope conversation. Everything else can follow.

| ID | Requirement | Type | Jurisdiction | Phase |
|---|---|---|---|---|
| DP-01 | Tenant-level DPA with Art. 28(3) terms, published and countersignable in-app | `HARD` | EU/UK | v1 |
| DP-02 | Public sub-processor list with 30-day change notice and objection right | `HARD` | EU/UK | v1 |
| DP-03 | DPIA template shipped to churches; platform DPIA maintained | `HARD` | EU/UK | v1 |
| DP-04 | Consent ledger: purpose, wording version, timestamp, channel, withdrawal | `HARD` | All | v1 |
| DP-05 | Art. 9 field-level encryption for pastoral notes, allergy, safeguarding | `HARD` | All | v1 |
| DP-06 | DSAR case management with stop-the-clock events (UK Art. 12A) | `HARD` | UK | v1 |
| DP-07 | Erasure workflow with legal hold and backup re-apply | `HARD` | All | v1 |
| DP-08 | Retention policy engine, per data class, per tenant | `HARD` | All | v1 |
| DP-09 | Region-pinning abstraction (`data_region` on tenant) even if only one region at launch | `BUYER`/design | EU/UK | v1 (abstraction) |
| CHK-01 | Guardian relationship model + release restrictions | `HARD` | All | v1 |
| CHK-02 | Allergy flag on explicit consent, time-boxed visibility | `HARD` | EU/UK | v1 |
| CHK-03 | Per-child per-session pickup code, no PII encoded | `BUYER` | All | v1 |
| CHK-04 | Offline check-in with encrypted cache | `BUYER` | All | v1 |
| PAY-01 | Stripe-hosted Checkout redirect; no custom card form; SAQ A evidence pack | `HARD` | All | v1 |
| PAY-02 | Standard connected accounts, direct charges, `refund_application_fee: true` | `CONTRACTUAL` | All | v1 |
| PAY-03 | Hosted/embedded Connect onboarding (not API onboarding) | `CONTRACTUAL` | All | v1 |
| PAY-04 | Receipt engine: US CWA, UK Gift Aid, CA official receipt, AU DGR | `HARD` | Per market | v1 (US/UK), v2 (CA/AU) |
| PAY-05 | Immutable receipts with void/reissue | `HARD` | All | v1 |
| SEC-01 | MFA enforced for all staff/admin accounts | `HARD`/`BUYER` | All | v1 |
| SEC-02 | RBAC with campus scoping and break-glass | `HARD` | All | v1 |
| SEC-03 | Immutable audit log, tenant-visible, ≥12 months | `HARD` | All | v1 |
| SEC-04 | Encryption in transit and at rest, KMS-managed keys | `HARD` | All | v1 |
| SEC-05 | Quarterly restore test with signed evidence | `HARD` | All | v1 |
| SEC-06 | Tenant-isolation tests in CI and in pen-test scope | `HARD` | All | v1 |
| SEC-07 | IR runbook with 72h/24h clocks and multi-tenant notification console | `HARD` | All | v1 |
| SEC-08 | Annual pen test + retest letter | `BUYER`/`HARD` (PCI) | All | v1 |
| SEC-09 | SOC 2 Type I in year 1, Type II in year 2 | `BUYER` | All | v2 |
| ACC-01 | WCAG 2.2 AA component library + CI checks | `BUYER` | All | v1 |
| ACC-02 | Kiosk accessibility spec (targets, timeout, contrast, no PII residue) | `BUYER` | All | v1 |
| ACC-03 | VPAT/ACR published | `BUYER` | All | v1 (draft), v2 (audited) |

---

## 7. Open items and things I could not verify

These are deliberately listed rather than smoothed over. Each is a real gap that affects a claim a buyer or counsel may test.

1. **US state privacy statutes and nonprofits.** I did not verify, state by state, whether comprehensive privacy laws reach nonprofit churches or the platform. Most are drafted around for-profit "businesses", but this is not uniform. **Suggested check:** start with California (CCPA/CPRA definitions), Colorado, Virginia, Texas, and any state where >10% of pipeline sits; ask counsel for a coverage matrix. Do not assert nonprofit exemption in sales material until verified.
2. **US state breach-notification deadlines.** I asserted only that they vary. The specific outer limits (30/45/60 days) differ by state and by data type. **Suggested check:** build the matrix from the state AG summaries or a maintained service (e.g. BakerHostetler/IAPP trackers), not from memory.
3. **Whether a member-facing app used by under-13s is a service "directed to children"** for COPPA. I found no regulator position on ChMS specifically. **Suggested check:** counsel opinion before launching any child-facing login; in the meantime, keep children's experience guardian-mediated.
4. **UK Gift Aid: per-gift vs aggregated declarations.** The declaration content is verified; the granularity of "description of the gift" for a recurring online giving mandate is not, and HMRC guidance on digital declarations should be checked. **Suggested check:** HMRC Gift Aid guidance for online donations and the Charities Online service.
5. **US $250 CWA: single gift vs aggregated payments.** The threshold is "a single contribution of $250 or more"; whether multiple instalments of one pledge aggregate is fact-specific. **Suggested check:** IRS Pub 1771 worked examples plus counsel.
6. **EAA scope for B2B SaaS with consumer-facing checkout.** I read the Directive's scope as covering e-commerce services to consumers; whether a church's donation page served through your platform pulls you in, and whether the microenterprise exemption applies to you, needs counsel in each member state. **Suggested check:** member-state transposition (Germany, France, Ireland, Netherlands first).
7. **DSA/eCommerce information duties** for the donation flow (trader identification, pre-contract information) were out of scope for this pass but are adjacent. **Suggested check:** eCommerce Directive 2000/31/EC and national implementations.
8. **State charitable-solicitation registration** (US) — charities soliciting online in multiple states may need registration; this is a church/tenant obligation, but a multi-state donation flow makes it visible. Out of scope here; worth a separate note.
9. **VAT/GST treatment of platform fees** across jurisdictions was not researched. It affects invoicing to churches and should be a finance workstream, not a compliance afterthought.
10. **DPF stability.** *Latombe* is a first-instance judgment (3 September 2025). An appeal to the CJEU would re-open the transfer analysis. Monitor; keep SCCs as a fallback in the DPA so a DPF invalidation is a paperwork event, not a re-architecture.

---

## 8. Sources

All accessed 29 October 2026 unless a different date is shown. URLs are given only for pages opened during this research, except where a row is explicitly marked as summary-only. Where a requirement number is cited without a deep link (e.g. PCI DSS v4.0.1 Req. 11.4, 8.4, 6.4.3, 11.6.1), the number is asserted from the standard and should be checked against the current PCI SSC document library before it appears in customer-facing material.

### Primary law and regulators

| Source | URL | Used for |
|---|---|---|
| Regulation (EU) 2016/679 (GDPR), full text | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 | Arts. 5, 9, 28, 32, 33, 44–46 |
| GDPR Art. 8 (mirror) | https://gdpr-info.eu/art-8-gdpr/ | Child consent age, 16 default / 13 floor |
| GDPR Art. 33 (mirror) | https://gdpr-info.eu/art-33-gdpr/ | 72-hour breach notification |
| UK GDPR Art. 8 (as amended) | https://www.legislation.gov.uk/eur/2016/679/article/8 | UK age 13; 2026 power to vary |
| Data Protection Act 2018, s.9 | https://www.legislation.gov.uk/ukpga/2018/12/section/9 | Repeal of the UK's separate child-consent provision |
| Data (Use and Access) Act 2025, s.76 | https://www.legislation.gov.uk/ukpga/2025/18/section/76/enacted | New Art. 12A SAR clock, stop-the-clock |
| Data (Use and Access) Act 2025, s.81 | https://www.legislation.gov.uk/ukpga/2025/18/section/81/enacted | Children's higher protection matters in Art. 25 |
| Data (Use and Access) Act 2025, s.114 | https://www.legislation.gov.uk/ukpga/2025/18/section/114/enacted | PECR reg. 22(3A) charity email soft opt-in |
| ICO — special category data: the rules | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-rules-on-special-category-data | Art. 6 + Art. 9 two-step; DPIA triggers |
| ICO — conditions for processing | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-conditions-for-processing/ | Art. 9(2)(a), (c), (d) text and church example |
| ICO — legitimate interests (updated 23 Mar 2026) | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/legitimate-interests/ | LIA, no preference for consent, DUAA update |
| ICO — international transfers guide (updated 29 May 2025) | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/international-transfers-a-guide/ | Adequacy list, UK Extension to DPF (12 Oct 2023), IDTA |
| ICO — children and the UK GDPR (updated 15 May 2026) | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/ | Children's lawful bases, DUAA impacts |
| EDPB — Recommendations 01/2020 on supplementary transfer measures | https://www.edpb.europa.eu/our-work-tools/our-documents/recommendations/recommendations-012020-measures-supplement-transfer_en | Six-step TIA methodology |
| European Accessibility Act, Directive (EU) 2019/882 | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32019L0882 | Accessibility requirements, e-commerce scope |
| Irish Government — European Accessibility Act guidance (4 Nov 2025) | https://www.gov.ie/en/department-of-children-disability-and-equality/publications/european-accessibility-act | 28 June 2025 application date |
| 42 U.S.C. § 12187 | https://www.law.cornell.edu/uscode/text/42/12187 | ADA Title III religious-organisation exemption |
| ADA.gov — Title II web rule fact sheet (updated with 2026 IFR) | https://www.ada.gov/resources/2024-03-08-web-rule/ | WCAG 2.1 AA; compliance dates 26 Apr 2027 / 2028 |
| FTC — COPPA rule (16 CFR Part 312) | https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa | Under-13 scope and operator duties |

### Tax and charitable receipting

| Source | URL | Used for |
|---|---|---|
| IRS — Charitable contributions: written acknowledgments (reviewed 28 Jun 2026) | https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments | $250 CWA contents, intangible religious benefits |
| IRS Publication 1771 | https://www.irs.gov/pub/irs-pdf/p1771.pdf | Substantiation and disclosure |
| GOV.UK — Claiming Gift Aid (overview) | https://www.gov.uk/claim-gift-aid | 25p per £1; £30 small donations |
| GOV.UK — Gift Aid declarations | https://www.gov.uk/claim-gift-aid/gift-aid-declarations | Declaration contents; 6-year retention |
| CRA — Official donation receipt contents | https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/issuing-receipts/what-information-must-on-official-donation-receipt-a-registered-charity.html | Mandatory receipt fields |
| CRA — Books and records | https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/books-records.html | 6-year retention (summary only; full page not opened) |
| ATO — Gifts and donations | https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/deductions-you-can-claim/gifts-and-donations | DGR, receipt content, $2 threshold removal |

### Payments and standards

| Source | URL | Used for |
|---|---|---|
| PCI SSC — SAQ A vs SAQ A-EP eligibility FAQ | https://www.pcisecuritystandards.org/faqs/if-a-merchant-s-e-commerce-implementation-meets-the-criteria-that-all-elements-of-payment-pages-originate-from-a-pci-dss-compliant-service-provider-is-the-merchant-eligible-to-complete-saq-a-or-saq-a-ep | The origin-of-elements rule |
| PCI SSC — FAQ 1588 blog (28 Feb 2025) | https://blog.pcisecuritystandards.org/faq-clarifies-new-saq-a-eligibility-criteria-for-e-commerce-merchants | SAQ A r1 script criterion; 6.4.3/11.6.1 |
| Stripe — Charges in a Connect integration | https://docs.stripe.com/connect/charges | Charge types, refunds, chargebacks, business of record |
| Stripe — Disputes on Connect | https://docs.stripe.com/connect/disputes | Who is debited; Express/Custom liability |
| Stripe — Direct charges | https://docs.stripe.com/connect/direct-charges | Application fees, refund_application_fee |
| Stripe — Onboarding connected accounts | https://docs.stripe.com/connect/onboarding | Hosted vs embedded vs API onboarding; 6-month review |
| Stripe — Connect pricing | https://stripe.com/connect/pricing | $2/MAU, 0.25%+25¢ per payout, 2.9%+30¢, platform fee model |

### Standards, assurance and benchmarks

| Source | URL | Used for |
|---|---|---|
| W3C — WCAG 2.2 Recommendation | https://www.w3.org/TR/WCAG22/ | SC list, kiosk applicability, conformance levels |
| AICPA & CIMA — SOC suite of services | https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services | SOC 2 scope and nature |
| Drata — SOC 2 cost breakdown 2026 | https://drata.com/learn/soc-2/cost | Cost and timeline ranges (vendor estimate) |
| Skadden — *Latombe* analysis (5 Sep 2025) | https://www.skadden.com/insights/publications/2025/09/eu-court-upholds-eu-us-data-flows | DPF upheld, Case T-553/23 |
| Hunton — *Latombe* analysis (3 Sep 2025) | https://www.hunton.com/privacy-and-cybersecurity-law-blog/eus-general-court-confirms-adequacy-of-eu-u-s-data-privacy-framework | Corroboration of outcome and date |

---

## 9. Suggested next steps

1. **Commission a counsel opinion on three questions only** (cheapest, highest leverage): (a) does Art. 9(2)(d) cover the platform's role when it hosts a member directory across campuses; (b) is the children's check-in flow a service "directed to children" under COPPA; (c) EAA scope for donation checkout in the first two EU markets. Everything else can be handled by template.
2. **Write the DPA and sub-processor list before the first EU/UK pilot**, not before launch. They are sales blockers earlier than most founders expect.
3. **Make the checkout architecture decision now** (hosted redirect, Standard accounts, direct charges). Reversing it later means re-onboarding every church and re-papering every donor mandate.
4. **Build the consent ledger and retention engine as platform primitives**, not per-feature logic. They are the two objects every jurisdiction-specific requirement reads from.
5. **Defer SOC 2 Type II to year two**, but start the evidence habit in year one (access reviews, restore tests, pen test). The report is a by-product of the habit.
6. **Treat accessibility as a component-library decision, not a QA phase.** Retrofitting AA into an admin app after 50 screens is a quarter of work; building it in is a sprint of setup plus discipline.
