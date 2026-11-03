import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const MAIN = "cmvu5zyeo0000rcc602zcnf83";

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true, slug: true } });
  const extra = orgs.filter((o) => o.id !== MAIN);
  console.log("Orgs:", orgs.map((o) => `${o.slug}(${o.id === MAIN ? "MAIN" : "extra"})`).join(", "));

  // licenses: main org must keep whatever it had; extra orgs already wiped
  console.log("licenses in DB:", await db.license.count());
  for (const o of extra) {
    const kids: Record<string, number> = {};
    for (const m of ["membership", "campus", "fund", "license", "role", "auditLog", "person", "group", "donation"] as const) {
      kids[m] = await (db as unknown as Record<string, { count: (a: object) => Promise<number> }>)[m].count({ where: { orgId: o.id } });
    }
    console.log(`extra org ${o.slug} residual:`, JSON.stringify(kids));
  }

  await db.$transaction(async (tx) => {
    for (const o of extra) {
      // final defensive sweep of org-scoped children (order matters)
      const tables = [
        "AiToolAuditLog", "AuditLog", "RiskFlagHistory", "MemberRiskFlag", "ServingConfig", "ConnectionNote",
        "FollowUpExecution", "FollowUpTask", "WhatsAppGivingLink", "WhatsAppContact", "PersonPipelinePosition",
        "GivingStatement", "GivingCommitment", "RecurringGift", "OnlinePayment", "PaymentMethod", "PrayerRequest",
        "BlockoutDate", "MessageRecipient", "CommunicationPreference", "PersonConsent", "PersonMilestone", "PersonNote",
        "StageHistory", "PersonRelationship", "JoinRequest", "GroupMember", "Assignment", "AttendanceRecord", "CareNote",
        "CareCase", "DonationSplit", "Donation", "Batch", "ChatMessage", "ChatParticipant", "ChatConversation",
        "RolePermission", "RoleAssignment", "Membership", "SavedView", "ImportRow", "ImportJob", "ImportMappingTemplate",
        "PersonExportLog", "PublicFormSubmission", "PublicForm", "FileRecord", "WorkflowRun", "Workflow", "Group",
        "CheckinSession", "Event", "VolunteerRole", "Service", "Pledge", "Fund", "CustomFieldDefinition", "Tag",
        "Person", "Campus", "License", "SubdomainRegistry", "TenantOnboardingAudit", "ChurchTrustee", "Role", "Notification",
      ];
      for (const t of tables) {
        const n = await tx.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "orgId" = ?`, o.id);
        if (n > 0) console.log(`  residual ${t}: ${n}`);
      }
      // no-orgId children of org rows
      await tx.$executeRawUnsafe(`DELETE FROM "RolePermission" WHERE "roleId" IN (SELECT id FROM "Role" WHERE "orgId" = ?)`, o.id);
      await tx.$executeRawUnsafe(`DELETE FROM "HouseholdMember" WHERE "householdId" IN (SELECT id FROM "Household" WHERE "orgId" = ?)`, o.id);
      await tx.$executeRawUnsafe(`DELETE FROM "PersonTag" WHERE "tagId" IN (SELECT id FROM "Tag" WHERE "orgId" = ?)`, o.id);
      await tx.$executeRawUnsafe(`DELETE FROM "Household" WHERE "orgId" = ?`, o.id);
      const del = await tx.organization.deleteMany({ where: { id: o.id } });
      console.log(`ORGANIZATION ${o.slug} deleted:`, del.count);
    }
  });

  console.log("\nFINAL orgs:", (await db.organization.findMany({ select: { slug: true } })).map((o) => o.slug).join(", "));
  console.log("FINAL licenses:", await db.license.count());
  const mainLicense = await db.license.findFirst({ where: { orgId: MAIN } });
  console.log("main org license:", mainLicense ? `${mainLicense.plan}/${mainLicense.status}/${mainLicense.key}` : "(none — pre-existing state)");
}

main().then(() => db.$disconnect()).catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
