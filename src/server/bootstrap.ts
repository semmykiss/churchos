import { scryptSync, randomBytes } from "crypto";
import { db } from "@/server/db";
import { ROLE_TEMPLATES, SYSTEM_ROLES, serializeAccessMatrix } from "@/server/permissions";
import { provisionDefaults } from "@/server/services/tenant/defaults";

/**
 * First-run production bootstrap (serverless/Vercel friendly).
 *
 * Local dev seeds the database with `prisma/seed.ts`. On a fresh hosted
 * deployment (Vercel + Neon/Postgres) the database starts EMPTY — the owner
 * would be locked out with "Invalid email or password" and nothing to seed
 * it with. This module closes that gap: the first login attempt on an empty
 * database provisions the minimum viable tenant:
 *
 *   • Organization "Grace Chapel" + primary campus + license
 *   • System roles from ROLE_TEMPLATES (single source of truth) + the
 *     worship_team custom role demo
 *   • Default funds/accounts (tenant defaults)
 *   • The 10 standing departments (owner's fixed list — keep spellings)
 *   • EXACTLY the four standing portal users (OWNER INSTRUCTION: never more):
 *       david@gracechapel.demo  → owner            (grace2026)
 *       tom@gracechapel.demo    → finance          (grace2026)
 *       grace@gracechapel.demo  → ministry_leader  (grace2026)
 *       marcus@gracechapel.demo → volunteer (+ worship_team) (grace2026)
 *   • The partner console account (separate auth system):
 *       partner@gracechms.demo / partner2026
 *
 * Idempotent + race-safe: double-checked inside a transaction and guarded by
 * the unique User.email constraint, so concurrent serverless cold starts
 * cannot double-seed. Never throws into the caller — login proceeds either
 * way.
 */

// OWNER INSTRUCTION (standing): maintain only these departments, spellings verbatim.
const STANDING_DEPARTMENTS = [
  "Media", "choir", "Ushring", "Pastorate", "sunday school",
  "Evangelism", "Bible study", "Children Department", "Tennage Church",
  "Youth & Young Adult",
];

// Same scrypt format as auth.ts hashPassword (kept verbatim here — importing
// auth.ts from this module would create a require cycle: auth → bootstrap).
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

let bootstrapped = false;

export async function ensureFirstRunBootstrap(): Promise<void> {
  if (bootstrapped) return;
  try {
    if ((await db.user.count()) > 0) {
      bootstrapped = true;
      return;
    }

    await db.$transaction(
      async (tx) => {
        // double-check inside the transaction — a concurrent cold start may
        // have committed the seed between our outer check and here
        if ((await tx.user.count()) > 0) return;

        const org = await tx.organization.create({
          data: {
            name: "Grace Chapel", slug: "grace-chapel", timezone: "Africa/Lagos", currency: "NGN",
            plan: "growth", fiscalYearStartMonth: 1, taxYearStartMonth: 1,
            settings: JSON.stringify({ monthlyBudgetCents: 2000000, quietHours: { start: "21:00", end: "08:00" }, smsRegion: "NG", aiAssistantEnabled: true }),
          },
        });
        const campus = await tx.campus.create({
          data: {
            orgId: org.id, name: "Grace Chapel — Ikeja Main", code: "MAIN", isPrimary: true,
            address: "24 Allen Avenue, Ikeja", city: "Lagos", region: "Lagos", postal: "101233",
            phone: "+2348031234500", serviceTimes: JSON.stringify(["09:00", "11:00"]),
          },
        });
        await tx.license.create({
          data: {
            orgId: org.id, key: "GCHMS-DEMO-2026-GRAC", plan: "growth", seats: 250,
            status: "active", issuedAt: new Date(), expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
            notes: "Founding church — founding-partner annual license",
          },
        });

        // roles — from ROLE_TEMPLATES so grants stay in lockstep with the
        // permission catalogue (same construction as prisma/seed.ts)
        const roles: Record<string, string> = {};
        for (const [key, perms] of Object.entries(ROLE_TEMPLATES)) {
          const preset = SYSTEM_ROLES[key];
          const r = await tx.role.create({
            data: {
              orgId: org.id, key,
              name: preset?.name ?? key,
              description: preset?.description ?? null,
              isSystem: true,
              accessMatrix: preset ? serializeAccessMatrix(preset.matrix) : null,
              permissions: { create: perms.map((p) => ({ permission: p })) },
            },
          });
          roles[key] = r.id;
        }
        const worshipRole = await tx.role.create({
          data: {
            orgId: org.id, key: "worship_team", name: "Worship Team",
            description: "Custom role — scheduling, check-in and comms visibility for worship team members.",
            isSystem: false,
            accessMatrix: JSON.stringify({ dashboard: 1, checkin: 1, events: 1, volunteers: 1, comms: 1, portal: 1, ai: 1 }),
            permissions: { create: ["schedule.view", "schedule.respond", "serving.view.own", "checkin.view", "comms.view", "comms.chat.use", "events.view", "reports.view", "portal.use"].map((p) => ({ permission: p })) },
          },
        });
        roles["worship_team"] = worshipRole.id;

        // default funds + GL accounts for a brand-new tenant
        await provisionDefaults(tx, org.id);

        // the 10 standing departments (Groups, type "ministry")
        for (const name of STANDING_DEPARTMENTS) {
          await tx.group.create({ data: { orgId: org.id, campusId: campus.id, name, type: "ministry" } });
        }

        // the four standing portal users — never more (OWNER INSTRUCTION)
        const pwd = hashPassword("grace2026");
        async function mkUser(
          email: string, first: string, last: string, roleKey: string,
          extra?: { title?: string; occupation?: string; phone?: string; gender?: string },
        ) {
          const person = await tx.person.create({
            data: {
              orgId: org.id, firstName: first, lastName: last, email,
              phone: extra?.phone, phoneE164: extra?.phone,
              title: extra?.title, occupation: extra?.occupation, gender: extra?.gender,
              lifecycleStage: "leader", membershipStatus: "member", homeCampusId: campus.id,
            },
          });
          const u = await tx.user.create({ data: { email, name: `${first} ${last}`, passwordHash: pwd } });
          const m = await tx.membership.create({ data: { orgId: org.id, userId: u.id, personId: person.id, defaultCampusId: campus.id } });
          await tx.roleAssignment.create({ data: { orgId: org.id, membershipId: m.id, roleId: roles[roleKey], scopeType: "campus", scopeId: campus.id } });
          return m.id;
        }
        await mkUser("david@gracechapel.demo", "David", "Okonkwo", "owner", { title: "Pastor", occupation: "Teaching Pastor", phone: "+2348031234501", gender: "m" });
        await mkUser("tom@gracechapel.demo", "Tom", "Balogun", "finance", { title: "Mr", occupation: "Accountant", phone: "+2348111234503", gender: "m" });
        await mkUser("grace@gracechapel.demo", "Grace", "Eze", "ministry_leader", { title: "Miss", occupation: "Family Ministry Lead", phone: "+2348161234504", gender: "f" });
        const marcusM = await mkUser("marcus@gracechapel.demo", "Marcus", "Nwosu", "volunteer", { title: "Mr", occupation: "Media Team Lead", phone: "+2349021234505", gender: "m" });
        await tx.roleAssignment.create({ data: { orgId: org.id, membershipId: marcusM, roleId: roles["worship_team"], scopeType: "campus", scopeId: campus.id } });

        // partner console account (separate PartnerUser auth system)
        await tx.partnerUser.create({
          data: { email: "partner@gracechms.demo", name: "Grace ChMS Partner", passwordHash: hashPassword("partner2026") },
        });
      },
      { timeout: 30_000, maxWait: 20_000 },
    );

    // register the tenant subdomain for branding (non-fatal if taken)
    const org = await db.organization.findFirst({ where: { slug: "grace-chapel" }, select: { id: true } });
    if (org) {
      await db.subdomainRegistry.create({ data: { subdomain: "grace-chapel", orgId: org.id } }).catch(() => {});
    }

    bootstrapped = true;
    console.log("[bootstrap] first-run bootstrap complete — Grace Chapel tenant, 4 portal users, 10 departments.");
  } catch (e) {
    // A concurrent cold start may have finished first (unique email wins);
    // treat that as success. Anything else: log and let login proceed —
    // the next attempt retries while the DB is still empty.
    if ((await db.user.count()) > 0) {
      bootstrapped = true;
      return;
    }
    console.error("[bootstrap] first-run bootstrap failed (will retry on next login):", e);
  }
}
