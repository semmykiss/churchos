// ─────────────────────────────────────────────────────────────────────────────
// scripts/cleanup-demo-data.ts — ONE-OFF MAINTENANCE SCRIPT (backend only)
//
// Removes all seeded DEMO content from the database while preserving:
//   • every Organization / License / SubdomainRegistry / ChurchTrustee /
//     TenantOnboardingAudit row          (the tenants themselves)
//   • every User + Membership + Session  (all default logins & portal access)
//   • PartnerUser + PartnerSession       (partner console access)
//   • Role / RolePermission / RoleAssignment + Campus (RBAC scaffolding that
//     portal access depends on — campus-scoped grants, staff person profiles)
//   • Person rows linked to portal users (people with portal access)
//   • the standard fresh-tenant defaults (4 funds incl. the system Tithe fund
//     + 15 chart-of-accounts accounts) — the same skeleton self-signup
//     provisions, so a cleaned org is indistinguishable from a new signup.
//
// Everything else — demo people, households, donations, pledges, events,
// attendance, groups, care cases, comms, chat, volunteering, check-ins,
// workflows, tags, custom fields, import jobs, demo audit history — is wiped.
//
// Deletion order mirrors deleteTenantOrg() (children → parents) inside ONE
// transaction; any failure rolls the whole cleanup back.
//
// Run:  bun scripts/cleanup-demo-data.ts
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../src/server/db";
import { provisionDefaults } from "../src/server/services/tenant/defaults";

async function countAll() {
  const rows: Record<string, number> = {};
  for (const model of [
    "organization", "user", "membership", "person", "partnerUser", "session",
    "partnerSession", "license", "subdomainRegistry", "churchTrustee",
    "tenantOnboardingAudit", "role", "rolePermission", "roleAssignment",
    "campus", "fund", "account", "donation", "donationSplit", "pledge",
    "recurringGift", "paymentMethod", "batch", "givingCommitment",
    "givingStatement", "onlinePayment", "journalEntry", "journalLine", "bill",
    "billLine", "billPayment", "bankAccount", "bankTransaction", "budget",
    "vendor", "event", "attendanceRecord", "checkinSession", "service",
    "volunteerRole", "assignment", "blockoutDate", "group", "groupMember",
    "joinRequest", "careCase", "careNote", "prayerRequest", "message",
    "messageRecipient", "communicationPreference", "chatConversation",
    "chatMessage", "chatParticipant", "workflow", "workflowRun", "tag",
    "personTag", "personRelationship", "household", "householdMember",
    "stageHistory", "customFieldDefinition", "importJob", "notification",
    "fileRecord", "auditLog", "aiConversation", "aiMessage", "aiCrisisFlag",
    "aiToolAuditLog",
  ]) {
    rows[model] = await (db as unknown as Record<string, { count(): Promise<number> }>)[model].count();
  }
  return rows;
}

async function main() {
  const before = await countAll();

  // Demo tenants = the seeded ones (never created via self-signup).
  const demoOrgs = await db.organization.findMany({ where: { onboardedVia: null } });
  if (demoOrgs.length === 0) {
    console.log("No seeded demo organizations found — nothing to clean.");
    return;
  }

  const report: Record<string, number> = {};

  for (const org of demoOrgs) {
    console.log(`\nCleaning demo content for: ${org.name} (${org.id})`);

    // People with portal access survive — their Person profiles must survive too.
    const memberships = await db.membership.findMany({
      where: { orgId: org.id },
      select: { personId: true, userId: true },
    });
    const keptPersonIds = memberships
      .filter((m) => m.userId !== null && m.personId !== null)
      .map((m) => m.personId as string);
    console.log(`  keeping ${keptPersonIds.length} person profile(s) linked to portal users`);

    const wiped = await db.$transaction(async (tx) => {
      const wipe = async (model: string, where: Record<string, unknown>) => {
        const n = await (tx as unknown as Record<string, { deleteMany(a: unknown): Promise<{ count: number }> }>)[model].deleteMany({ where });
        if (n.count > 0) report[model] = (report[model] ?? 0) + n.count;
        return n.count;
      };
      const orgScope = { orgId: org.id };

      // ai assistant
      await wipe("aiMessage", { conversation: { orgId: org.id } });
      await wipe("aiToolAuditLog", orgScope);
      await wipe("aiCrisisFlag", orgScope);
      await wipe("aiConversation", orgScope);

      // workflows
      await wipe("workflowRun", orgScope);
      await wipe("workflow", orgScope);

      // care
      await wipe("careNote", orgScope);
      await wipe("prayerRequest", orgScope);
      await wipe("careCase", orgScope);

      // comms
      await wipe("messageRecipient", orgScope);
      await wipe("message", orgScope);
      await wipe("communicationPreference", orgScope);

      // chat
      await wipe("chatMessage", orgScope);
      await wipe("chatParticipant", orgScope);
      await wipe("chatConversation", orgScope);

      // giving (children → parents); funds are re-provisioned below
      await wipe("onlinePayment", orgScope);
      await wipe("donationSplit", orgScope);
      await wipe("recurringGift", orgScope);
      await wipe("paymentMethod", orgScope);
      await wipe("pledge", orgScope);
      await wipe("donation", orgScope);
      await wipe("givingStatement", orgScope);
      await wipe("givingCommitment", orgScope);
      await wipe("batch", orgScope);
      await wipe("fund", orgScope);

      // accounting (children → parents); CoA re-provisioned below
      await wipe("bankTransaction", orgScope);
      await wipe("bankAccount", orgScope);
      await wipe("billPayment", orgScope);
      await wipe("billLine", orgScope);
      await wipe("bill", orgScope);
      await wipe("vendor", orgScope);
      await wipe("budget", orgScope);
      await wipe("journalLine", orgScope);
      await wipe("journalEntry", orgScope);
      await wipe("account", orgScope);

      // check-in, events, volunteering
      await wipe("attendanceRecord", orgScope);
      await wipe("checkinSession", orgScope);
      await wipe("assignment", orgScope);
      await wipe("event", orgScope);
      await wipe("service", orgScope);
      await wipe("volunteerRole", orgScope);
      await wipe("blockoutDate", orgScope);

      // groups
      await wipe("joinRequest", orgScope);
      await wipe("groupMember", orgScope);
      await wipe("group", orgScope);

      // people & households (join tables without orgId filtered via relations)
      await wipe("stageHistory", orgScope);
      await wipe("personTag", { person: { orgId: org.id } });
      await wipe("customFieldDefinition", orgScope);
      await wipe("personRelationship", orgScope);
      await wipe("householdMember", { household: { orgId: org.id } });
      await wipe("household", orgScope);
      await wipe("person", { orgId: org.id, id: { notIn: keptPersonIds } });
      await wipe("tag", orgScope); // after personTag (join table has no orgId)

      // platform tables
      await wipe("notification", orgScope);
      await wipe("importJob", orgScope);
      await wipe("fileRecord", orgScope);

      // demo audit history (self-signup tenants keep their real lifecycle log)
      await wipe("auditLog", orgScope);

      // re-provision the standard fresh-tenant skeleton — the cleaned org is
      // now indistinguishable from a just-signed-up church
      await provisionDefaults(tx, org.id);

      return report;
    });

    Object.entries(wiped)
      .sort((a, b) => b[1] - a[1])
      .forEach(([m, n]) => console.log(`  wiped ${String(n).padStart(6)} × ${m}`));
  }

  const after = await countAll();

  console.log("\n════════ BEFORE → AFTER ════════");
  for (const m of Object.keys(before)) {
    if (before[m] !== after[m]) {
      console.log(`  ${m.padEnd(26)} ${String(before[m]).padStart(6)} → ${String(after[m]).padStart(6)}`);
    }
  }

  const preserved = [
    "organization", "user", "membership", "partnerUser", "session",
    "partnerSession", "license", "subdomainRegistry", "churchTrustee",
    "tenantOnboardingAudit", "role", "rolePermission", "roleAssignment",
    "campus",
  ];
  console.log("\n════════ PRESERVED (logins & portal access) ════════");
  for (const m of preserved) {
    console.log(`  ${m.padEnd(26)} ${String(after[m]).padStart(6)}`);
  }
  const fundCount = after["fund"];
  const accountCount = after["account"];
  const personKept = after["person"];
  console.log(`\n  person (portal-linked)    ${String(personKept).padStart(6)}`);
  console.log(`  fund (fresh defaults)     ${String(fundCount).padStart(6)}`);
  console.log(`  account (fresh CoA)       ${String(accountCount).padStart(6)}`);
}

main()
  .then(async () => {
    await db.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("CLEANUP FAILED — transaction rolled back, nothing changed:", err);
    await db.$disconnect();
    process.exit(1);
  });
