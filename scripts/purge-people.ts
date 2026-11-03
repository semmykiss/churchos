/**
 * Purge People-module data — leave only 4 portal test users + partner console user.
 *
 * KEEP (portal users for testing, roles unchanged):
 *   david@gracechapel.demo  (owner)
 *   tom@gracechapel.demo    (finance)
 *   grace@gracechapel.demo  (ministry_leader)
 *   marcus@gracechapel.demo (volunteer)
 * KEEP (separate principal, partner console): partner@gracechms.demo — untouched.
 *
 * REMOVE:
 *   • All other Person rows (45) in Grace Chapel + every person-scoped child row
 *     (households, attendance, group members, care, comms recipients, pledges,
 *     payment methods, …). Donations survive with personId = NULL (giving ledger
 *     stays intact & balanced; gifts merely become anonymous).
 *   • Portal users not in the keep list (renee, sarah, aisha, smallchurch+test,
 *     tiny+1) with their sessions, role assignments and memberships.
 *   • The two dev-scaffold tenants ("Grace Chapel Testing", "Tiny Fellowship")
 *     whose only users are being removed — partner console keeps one clean tenant.
 *
 * Rollback: restore db/custom.backup-*.db
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const KEEP_EMAILS = [
  "david@gracechapel.demo",
  "tom@gracechapel.demo",
  "grace@gracechapel.demo",
  "marcus@gracechapel.demo",
];

async function raw(sql: string, ...params: unknown[]): Promise<number> {
  return db.$executeRawUnsafe(sql, ...params);
}

function ph(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true, slug: true } });
  const mainOrg = orgs.find((o) => o.slug === "grace-chapel");
  if (!mainOrg) throw new Error("Grace Chapel org not found");
  const extraOrgs = orgs.filter((o) => o.id !== mainOrg.id);

  const keepUsers = await db.user.findMany({
    where: { email: { in: KEEP_EMAILS } },
    select: { id: true, email: true },
  });
  if (keepUsers.length !== KEEP_EMAILS.length) {
    throw new Error(`Expected ${KEEP_EMAILS.length} keep users, found ${keepUsers.length}`);
  }
  const keepUserIds = keepUsers.map((u) => u.id);

  const keepMemberships = await db.membership.findMany({
    where: { orgId: mainOrg.id, userId: { in: keepUserIds } },
    select: { id: true, userId: true, personId: true },
  });
  const keepPersonIds = keepMemberships.map((m) => m.personId).filter((x): x is string => !!x);
  if (keepPersonIds.length !== 4) throw new Error(`Expected 4 kept persons, found ${keepPersonIds.length}`);

  const allUsers = await db.user.findMany({ select: { id: true, email: true } });
  const delUsers = allUsers.filter((u) => !KEEP_EMAILS.includes(u.email));
  const delUserIds = delUsers.map((u) => u.id);
  const delMemberships = await db.membership.findMany({
    where: { userId: { in: delUserIds } },
    select: { id: true },
  });
  const delMembershipIds = delMemberships.map((m) => m.id);

  console.log(`Main org: ${mainOrg.name} (${mainOrg.id})`);
  console.log(`Extra orgs to remove: ${extraOrgs.map((o) => o.name).join(", ")}`);
  console.log(`Keep users: ${keepUsers.map((u) => u.email).join(", ")}`);
  console.log(`Delete users: ${delUsers.map((u) => u.email).join(", ")}`);
  console.log(`Keep person ids: ${keepPersonIds.length}`);

  await db.$transaction(
    async (tx) => {
      const q = (sql: string, ...params: unknown[]) => tx.$executeRawUnsafe(sql, ...params);

      // ─────────────────────────────────────────────────────────────────────
      // PHASE 1 — dev-scaffold tenants: wipe every org-scoped row, children first
      // (these tenants hold no persons/households — just campus/fund/license/etc.)
      // ─────────────────────────────────────────────────────────────────────
      const orgIn = ph(extraOrgs.length);
      const orgParams = extraOrgs.map((o) => o.id);
      // RolePermission has no orgId — child of Role (RESTRICT), must go first
      let nRP = await q(
        `DELETE FROM "RolePermission" WHERE "roleId" IN (SELECT id FROM "Role" WHERE "orgId" IN (${orgIn}))`,
        ...orgParams
      );
      if (nRP > 0) console.log(`  [org-wipe] RolePermission: ${nRP}`);
      const orgScopedOrder = [
        "AiToolAuditLog", "AiMessage", "AiConversation", "AuditLog",
        "RiskFlagHistory", "MemberRiskFlag", "ServingConfig", "ConnectionNote",
        "FollowUpExecution", "FollowUpTask", "WhatsAppGivingLink", "WhatsAppContact",
        "PersonPipelinePosition", "GivingStatement", "GivingCommitment", "RecurringGift",
        "OnlinePayment", "PaymentMethod", "PrayerRequest", "BlockoutDate",
        "MessageRecipient", "CommunicationPreference", "PersonConsent", "PersonMilestone",
        "PersonNote", "StageHistory", "PersonRelationship", "JoinRequest", "GroupMember",
        "Assignment", "AttendanceRecord", "CareNote", "CareCase", "DonationSplit",
        "Donation", "Batch", "ChatMessage", "ChatParticipant", "ChatConversation",
        "RoleAssignment", "Session", "AuthToken", "Membership", "SavedView",
        "ImportRow", "ImportJob", "ImportMappingTemplate", "PersonExportLog",
        "PublicFormSubmission", "PublicForm", "FileRecord", "WorkflowRun", "Workflow",
        "Group", "CheckinSession", "Event", "VolunteerRole", "Service", "Pledge",
        "Fund", "CustomFieldDefinition", "Tag", "Person", "Campus", "License",
        "SubdomainRegistry", "TenantOnboardingAudit", "ChurchTrustee", "Role", "Notification",
      ];
      for (const t of orgScopedOrder) {
        const n = await q(`DELETE FROM "${t}" WHERE "orgId" IN (${orgIn})`, ...orgParams);
        if (n > 0) console.log(`  [org-wipe] ${t}: ${n}`);
      }
      // no-orgId children of wiped rows (defensive — likely 0 rows)
      await q(
        `DELETE FROM "HouseholdMember" WHERE "householdId" IN (SELECT id FROM "Household" WHERE "orgId" IN (${orgIn}))`,
        ...orgParams
      );
      await q(
        `DELETE FROM "PersonTag" WHERE "tagId" IN (SELECT id FROM "Tag" WHERE "orgId" IN (${orgIn}))`,
        ...orgParams
      );

      // ─────────────────────────────────────────────────────────────────────
      // PHASE 2 — sessions / AI data / role assignments / memberships of
      // soon-to-be-deleted users (before User delete: Session FK is RESTRICT)
      // ─────────────────────────────────────────────────────────────────────
      if (delUserIds.length) {
        const uIn = ph(delUserIds.length);
        let n = await q(`DELETE FROM "Session" WHERE "userId" IN (${uIn})`, ...delUserIds);
        console.log(`[users] Session: ${n}`);
        n = await q(`DELETE FROM "AuthToken" WHERE "userId" IN (${uIn})`, ...delUserIds);
        console.log(`[users] AuthToken: ${n}`);
        n = await q(
          `DELETE FROM "AiMessage" WHERE "conversationId" IN (SELECT id FROM "AiConversation" WHERE "userId" IN (${uIn}))`,
          ...delUserIds
        );
        n = await q(`DELETE FROM "AiConversation" WHERE "userId" IN (${uIn})`, ...delUserIds);
        console.log(`[users] AiConversation: ${n}`);
        n = await q(`DELETE FROM "SavedView" WHERE "ownerId" IN (${uIn})`, ...delUserIds);
        console.log(`[users] SavedView: ${n}`);
        if (delMembershipIds.length) {
          const mIn = ph(delMembershipIds.length);
          n = await q(`DELETE FROM "RoleAssignment" WHERE "membershipId" IN (${mIn})`, ...delMembershipIds);
          console.log(`[users] RoleAssignment: ${n}`);
          n = await q(`DELETE FROM "Membership" WHERE "id" IN (${mIn})`, ...delMembershipIds);
          console.log(`[users] Membership: ${n}`);
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // PHASE 3 — main-org person purge: delete every person-scoped child row
      // for the 45 non-kept persons, then the persons themselves.
      // ─────────────────────────────────────────────────────────────────────
      const kIn = ph(keepPersonIds.length);
      const kParams = keepPersonIds;
      const notKept = `"personId" NOT IN (${kIn})`;
      const steps: [string, string, unknown[]][] = [
        ["PrayerRequest", `DELETE FROM "PrayerRequest" WHERE "orgId" = ? AND "personId" IS NOT NULL AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["Pledge", `DELETE FROM "Pledge" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["PersonRelationship", `DELETE FROM "PersonRelationship" WHERE "orgId" = ? AND ("fromPersonId" NOT IN (${kIn}) OR "toPersonId" NOT IN (${kIn}))`, [mainOrg.id, ...kParams, ...kParams]],
        ["StageHistory", `DELETE FROM "StageHistory" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["PersonMilestone", `DELETE FROM "PersonMilestone" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["PersonNote", `DELETE FROM "PersonNote" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["PersonConsent", `DELETE FROM "PersonConsent" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["PersonTag", `DELETE FROM "PersonTag" WHERE ${notKept}`, [...kParams]],
        ["GroupMember", `DELETE FROM "GroupMember" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["JoinRequest", `DELETE FROM "JoinRequest" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["ChatParticipant", `DELETE FROM "ChatParticipant" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["AttendanceRecord", `DELETE FROM "AttendanceRecord" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["Assignment", `DELETE FROM "Assignment" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["CommunicationPreference", `DELETE FROM "CommunicationPreference" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["MessageRecipient", `DELETE FROM "MessageRecipient" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["BlockoutDate", `DELETE FROM "BlockoutDate" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["CareNote", `DELETE FROM "CareNote" WHERE "orgId" = ? AND "careCaseId" IN (SELECT id FROM "CareCase" WHERE "orgId" = ? AND "personId" NOT IN (${kIn}))`, [mainOrg.id, mainOrg.id, ...kParams]],
        ["CareCase", `DELETE FROM "CareCase" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["PaymentMethod", `DELETE FROM "PaymentMethod" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["RecurringGift", `DELETE FROM "RecurringGift" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["OnlinePayment", `DELETE FROM "OnlinePayment" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["GivingStatement", `DELETE FROM "GivingStatement" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["GivingCommitment", `DELETE FROM "GivingCommitment" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["FollowUpTask", `DELETE FROM "FollowUpTask" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["ConnectionNote", `DELETE FROM "ConnectionNote" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["MemberRiskFlag", `DELETE FROM "MemberRiskFlag" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["RiskFlagHistory", `DELETE FROM "RiskFlagHistory" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["ServingConfig", `DELETE FROM "ServingConfig" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["PersonPipelinePosition", `DELETE FROM "PersonPipelinePosition" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["WhatsAppGivingLink", `DELETE FROM "WhatsAppGivingLink" WHERE "orgId" = ? AND ${notKept}`, [mainOrg.id, ...kParams]],
        ["ImportRow", `DELETE FROM "ImportRow" WHERE "orgId" = ? AND "createdPersonId" IS NOT NULL AND "createdPersonId" NOT IN (${kIn})`, [mainOrg.id, ...kParams]],
        ["ImportJob", `DELETE FROM "ImportJob" WHERE "orgId" = ?`, [mainOrg.id]],
        ["WorkflowRun", `DELETE FROM "WorkflowRun" WHERE "orgId" = ? AND "subjectType" = 'person' AND "subjectId" NOT IN (${kIn})`, [mainOrg.id, ...kParams]],
        // HouseholdMember references Person (RESTRICT) — must go BEFORE Person delete.
        // Kept people are in no household, so all main-org household links are purgeable.
        ["HouseholdMember", `DELETE FROM "HouseholdMember" WHERE "householdId" IN (SELECT id FROM "Household" WHERE "orgId" = ?)`, [mainOrg.id]],
      ];
      for (const [name, sql, params] of steps) {
        const n = await q(sql, ...params);
        if (n > 0) console.log(`[people] ${name}: ${n}`);
      }

      // anonymous-ize gifts + prayer history of removed people (FK is SET NULL,
      // but do it explicitly so it works with or without FK enforcement)
      let n = await q(`UPDATE "Donation" SET "personId" = NULL WHERE "orgId" = ? AND "personId" IS NOT NULL AND "personId" NOT IN (${kIn})`, mainOrg.id, ...kParams);
      console.log(`[people] Donation.anonymized: ${n}`);
      n = await q(`UPDATE "WhatsAppContact" SET "personId" = NULL WHERE "orgId" = ? AND "personId" IS NOT NULL AND "personId" NOT IN (${kIn})`, mainOrg.id, ...kParams);
      n = await q(`UPDATE "Person" SET "assignedShepherdId" = NULL WHERE "assignedShepherdId" IS NOT NULL AND "assignedShepherdId" NOT IN (${kIn})`, ...kParams);
      n = await q(`UPDATE "Person" SET "invitedByPersonId" = NULL WHERE "invitedByPersonId" IS NOT NULL AND "invitedByPersonId" NOT IN (${kIn})`, ...kParams);
      n = await q(`UPDATE "Person" SET "mergedIntoId" = NULL WHERE "mergedIntoId" IS NOT NULL AND "mergedIntoId" NOT IN (${kIn})`, ...kParams);
      n = await q(`UPDATE "Group" SET "leaderPersonId" = NULL WHERE "leaderPersonId" IS NOT NULL AND "leaderPersonId" NOT IN (${kIn})`, ...kParams);
      console.log(`[people] dangling refs cleared (donation/whatsapp/shepherd/invitedBy/mergedInto/group-leader)`);

      // now the persons themselves
      n = await q(`DELETE FROM "Person" WHERE "orgId" = ? AND "id" NOT IN (${kIn})`, mainOrg.id, ...kParams);
      console.log(`[people] Person deleted: ${n}`);

      // households (kept people are in none → wipe all in main org)
      n = await q(`DELETE FROM "Household" WHERE "orgId" = ?`, mainOrg.id);
      console.log(`[people] Household: ${n}`);

      // tags that no longer label anyone
      n = await q(`DELETE FROM "Tag" WHERE "orgId" = ? AND "id" NOT IN (SELECT "tagId" FROM "PersonTag")`, mainOrg.id);
      console.log(`[people] orphan Tags: ${n}`);

      // ─────────────────────────────────────────────────────────────────────
      // PHASE 4 — remove the non-kept portal users
      // ─────────────────────────────────────────────────────────────────────
      if (delUserIds.length) {
        const uIn = ph(delUserIds.length);
        n = await q(`DELETE FROM "User" WHERE "id" IN (${uIn})`, ...delUserIds);
        console.log(`[users] User deleted: ${n}`);
      }
    },
    { timeout: 60_000, maxWait: 10_000 }
  );

  console.log("\n=== POST-PURGE STATE ===");
  console.log("persons:", await db.person.count());
  console.log("users:", await db.user.count());
  console.log("memberships:", await db.membership.count());
  console.log("orgs:", await db.organization.count());
  console.log("partnerUsers:", await db.partnerUser.count());
  console.log("donations:", await db.donation.count(), "(personId null:", await db.donation.count({ where: { personId: null } }), ")");
  console.log("donationSplits:", await db.donationSplit.count());
  console.log("batches:", await db.batch.count());
  console.log("groups:", await db.group.count());
  console.log("groupMembers:", await db.groupMember.count());
  console.log("attendance:", await db.attendanceRecord.count());
  console.log("households:", await db.household.count());
  console.log("tags:", await db.tag.count());
  console.log("roles:", await db.role.count());
  console.log("roleAssignments:", await db.roleAssignment.count());
  console.log("sessions:", await db.session.count());
  console.log("licenses:", await db.license.count());

  const kept = await db.user.findMany({
    where: { email: { in: KEEP_EMAILS } },
    select: { email: true, status: true, memberships: { select: { personId: true, roleAssignments: { select: { role: { select: { key: true } } } } } } },
  });
  for (const u of kept) {
    console.log("KEPT", u.email, u.status, u.memberships[0]?.personId ? "person-linked" : "NO PERSON!", u.memberships[0]?.roleAssignments.map((r) => r.role.key).join("+"));
  }
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    db.$disconnect();
    process.exit(1);
  });
