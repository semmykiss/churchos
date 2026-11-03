import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound, conflict, forbidden } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { pushNotifications, userIdsWithPermission } from "@/server/services/notifications";
import { startOfYear } from "date-fns";
import { randomBytes } from "node:crypto";
import { processorFeeCents } from "@/lib/giving-fees";
import { assertOnlineGivingAllowed } from "@/server/services/tenant/onboarding";
import { journalDonation } from "@/server/services/accounting";
import {
  stripeEnabled, getStripe, ensureCustomer, createGiftIntent,
  createSetupIntent, attachAndDescribeMethod,
} from "@/server/services/stripe-provider";

/**
 * Giving service (backend only — no HTTP, no React).
 * Business rules honored:
 *  • donations are APPEND-ONLY — corrections happen as reversal records, never edits
 *  • splits must sum exactly to the gift amount
 *  • open batch ⇒ pending donation; posting a batch = two-person control
 *  • statements group by statement unit (household, falling back to person) with
 *    the required IRS "no goods or services" language
 *  • every mutation is audited in the same logical step
 */

function parseDay(s?: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s);
  return isNaN(d.getTime()) ? undefined : d;
}

/* ── count-sheet notifications (giving ↔ finance loop) ───────────────────────
 * Fire-and-forget: a notification failure must NEVER break the financial
 * transaction, so every push is awaited inside a caught helper. */

/** Kobo → "₦12,500" (kobo shown only when non-zero) for notification bodies. */
function naira(cents: number): string {
  const n = Math.round(Number(cents) || 0) / 100;
  const opts = Number.isInteger(n)
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return `₦${n.toLocaleString("en-NG", opts)}`;
}

function sheetDay(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

/** Finance approvers for this org — accountant verifiers + accounting managers, minus the actor. */
async function financeApproverIds(orgId: string, excludeUserId?: string): Promise<string[]> {
  const ids = new Set<string>([
    ...(await userIdsWithPermission(orgId, "giving.verify.accountant")),
    ...(await userIdsWithPermission(orgId, "accounting.manage")),
  ]);
  if (excludeUserId) ids.delete(excludeUserId);
  return [...ids];
}

/** User.id behind a membershipId (batch.verifiedByUsherId), if any. */
async function userIdForMembership(membershipId: string | null | undefined): Promise<string | null> {
  if (!membershipId) return null;
  const m = await db.membership.findUnique({ where: { id: membershipId }, select: { userId: true, user: { select: { status: true } } } });
  return m && m.user.status === "active" ? m.userId : null;
}

function dayEnd(s?: string | null): Date | undefined {
  if (!s) return undefined;
  const d = parseDay(s);
  if (!d) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(d.getTime() + 86400000 - 1) : d;
}

export function money(cents: number): string {
  // Nigerian Naira (₦) — amounts are kobo (minor units, 1 ₦ = 100 kobo).
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const body = (abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? "-" : ""}₦${body}`;
}

// ── ROLE-BASED DATA SCOPING (server-side, never trust the client) ───────────
// giving.view.all        → unrestricted
// giving.view.own        → every query is FORCED to personId = viewer's own
//                          person record; any client-supplied personId is ignored
// neither                → 403
export function givingScope(user: SessionUser): "all" | "own" {
  if (can(user, "giving.view.all")) return "all";
  if (can(user, "giving.view.own")) return "own";
  throw forbidden("You do not have permission to view giving records.");
}

function scopedPersonId(user: SessionUser): string {
  givingScope(user);
  return user.personId ?? "__none__"; // member with no linked person record sees nothing
}

/** Enforce the scoping rule on any list query. Mutates/returns the scoped where. */
export function scopeGivingQuery(user: SessionUser, where: Record<string, unknown>, personField = "personId"): Record<string, unknown> {
  if (givingScope(user) === "all") return where;
  where[personField] = user.personId ?? "__none__";
  return where;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── funds ────────────────────────────────────────────────────────────────────

const FUND_TYPES = ["tithe", "general", "designated", "restricted", "building", "missions"] as const;

/**
 * Every church gets a non-deletable "Tithes" fund (isSystemFund) — tithing is
 * the dominant revenue stream and must always exist for the Give-now flow.
 * Idempotent; runs on first funds read per process.
 */
async function ensureSystemFunds(orgId: string) {
  const existing = await db.fund.findFirst({ where: { orgId, type: "tithe" }, select: { id: true } });
  if (existing) return;
  await db.fund.create({
    data: { orgId, name: "Tithes", code: "100-T", type: "tithe", isSystemFund: true, isTaxDeductible: true, sortOrder: -10 },
  }).catch(() => {}); // race with another request seeding it — harmless
}

export async function listFunds(user: SessionUser) {
  await ensureSystemFunds(user.orgId);
  const yearStart = startOfYear(new Date());
  const [funds, splits] = await Promise.all([
    db.fund.findMany({ where: { orgId: user.orgId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.donationSplit.findMany({
      where: { orgId: user.orgId, donation: { status: "posted", receivedOn: { gte: yearStart } } },
      select: { fundId: true, amountCents: true },
    }),
  ]);
  const ytd: Record<string, number> = {};
  for (const s of splits) ytd[s.fundId] = (ytd[s.fundId] ?? 0) + s.amountCents;
  return {
    items: funds.map((f) => ({
      id: f.id,
      name: f.name,
      code: f.code,
      type: f.type,
      isSystemFund: f.isSystemFund,
      isTaxDeductible: f.isTaxDeductible,
      glAccountCode: f.glAccountCode,
      revenueAccountId: f.revenueAccountId,
      defaultCashAccountId: f.defaultCashAccountId,
      restriction: f.restriction,
      goalCents: f.goalCents,
      isActive: f.isActive,
      receivedCentsYTD: ytd[f.id] ?? 0,
    })),
  };
}

export async function createFund(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.funds.manage")) throw forbidden("Requires giving.funds.manage permission.");
  if (!input?.name?.trim() || !input?.code?.trim()) throw badRequest("Fund name and code are required.");
  const type = input.type || "general";
  if (!(FUND_TYPES as readonly string[]).includes(type)) throw badRequest(`Unknown fund type "${type}".`);
  const restriction = input.restriction || "unrestricted";
  if (!["unrestricted", "temp_restricted", "perm_restricted"].includes(restriction)) throw badRequest("restriction must be unrestricted, temp_restricted or perm_restricted.");
  const fund = await db.fund.create({
    data: {
      orgId: user.orgId,
      name: input.name.trim(),
      code: input.code.trim(),
      type,
      isTaxDeductible: input.isTaxDeductible ?? true,
      goalCents: input.goalCents ?? undefined,
      glAccountCode: input.glAccountCode?.trim() || undefined,
      revenueAccountId: input.revenueAccountId || undefined,
      defaultCashAccountId: input.defaultCashAccountId || undefined,
      restriction,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "fund.create", entityType: "fund", entityId: fund.id,
    after: { name: fund.name, code: fund.code, revenueAccountId: fund.revenueAccountId, defaultCashAccountId: fund.defaultCashAccountId, restriction }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: fund.id, name: fund.name, code: fund.code, type: fund.type, isTaxDeductible: fund.isTaxDeductible, goalCents: fund.goalCents, isActive: fund.isActive };
}

/** Update a fund's GL mapping (revenue account, default cash account, restriction). */
export async function updateFundGLMapping(user: SessionUser, fundId: string, input: any, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.funds.manage")) throw forbidden("Requires giving.funds.manage permission.");
  const fund = await db.fund.findFirst({ where: { id: fundId, orgId: user.orgId } });
  if (!fund) throw notFound("Fund not found.");
  const restriction = input.restriction || fund.restriction;
  if (!["unrestricted", "temp_restricted", "perm_restricted"].includes(restriction)) throw badRequest("restriction must be unrestricted, temp_restricted or perm_restricted.");
  const updated = await db.fund.update({
    where: { id: fund.id },
    data: {
      revenueAccountId: input.revenueAccountId ?? null,
      defaultCashAccountId: input.defaultCashAccountId ?? null,
      glAccountCode: input.glAccountCode?.trim() || null,
      restriction,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "fund.glmap", entityType: "fund", entityId: fund.id, after: { revenueAccountId: updated.revenueAccountId, defaultCashAccountId: updated.defaultCashAccountId, restriction }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: fund.id };
}

// ── donations ────────────────────────────────────────────────────────────────

interface DonationListQuery {
  search?: string; fundId?: string; method?: string; status?: string;
  from?: string; to?: string; batchId?: string; personId?: string; page?: number; pageSize?: number;
}

async function donationMapContext(donations: any[]) {
  const personIds = [...new Set(donations.map((d) => d.personId).filter(Boolean))] as string[];
  const householdIds = [...new Set(donations.map((d) => d.householdId).filter(Boolean))] as string[];
  const batchIds = [...new Set(donations.map((d) => d.batchId).filter(Boolean))] as string[];
  const fundIds = [...new Set(donations.flatMap((d) => ((d.splits ?? []) as any[]).map((s) => s.fundId)))] as string[];
  const [persons, households, batches, funds] = await Promise.all([
    personIds.length ? db.person.findMany({ where: { id: { in: personIds } } }) : Promise.resolve([] as any[]),
    householdIds.length ? db.household.findMany({ where: { id: { in: householdIds } } }) : Promise.resolve([] as any[]),
    batchIds.length ? db.batch.findMany({ where: { id: { in: batchIds } } }) : Promise.resolve([] as any[]),
    fundIds.length ? db.fund.findMany({ where: { id: { in: fundIds } } }) : Promise.resolve([] as any[]),
  ]);
  return {
    persons: new Map(persons.map((p) => [p.id, p] as const)),
    households: new Map(households.map((h) => [h.id, h] as const)),
    batches: new Map(batches.map((b) => [b.id, b] as const)),
    funds: new Map(funds.map((f) => [f.id, f] as const)),
  };
}

function toDonationDTO(d: any, ctx: Awaited<ReturnType<typeof donationMapContext>>) {
  const person = d.personId ? ctx.persons.get(d.personId) : null;
  const batch = d.batchId ? ctx.batches.get(d.batchId) : null;
  return {
    id: d.id,
    person: person ? { id: person.id, name: `${person.firstName} ${person.lastName}` } : null,
    householdName: d.householdId ? ctx.households.get(d.householdId)?.name ?? null : null,
    amountCents: d.amountCents,
    currency: d.currency,
    method: d.method,
    status: d.status,
    receivedOn: d.receivedOn,
    source: d.source,
    feeCents: d.feeCents,
    netCents: d.netCents,
    checkNumber: d.checkNumber,
    memo: d.memo,
    isAnonymous: d.isAnonymous,
    batch: batch ? { id: batch.id, name: batch.name, status: batch.status, serviceName: batch.serviceName, countedByOne: batch.countedByOne } : null,
    splits: ((d.splits ?? []) as any[]).map((s) => ({
      fundId: s.fundId,
      fundName: ctx.funds.get(s.fundId)?.name ?? "Unknown fund",
      amountCents: s.amountCents,
    })),
    reversalOfId: d.reversalOfId,
    createdByName: d.createdByName,
    verificationStatus: d.verificationStatus ?? null,
    verifiedByUsherAt: d.verifiedByUsherAt ?? null,
    verifiedByAccountantAt: d.verifiedByAccountantAt ?? null,
    rejectionNote: d.rejectionNote ?? null,
  };
}

export async function listDonations(user: SessionUser, q: DonationListQuery) {
  const where: any = { orgId: user.orgId };
  if (givingScope(user) === "own") {
    // FORCE self-scope — ignore any personId/search the client passes
    where.personId = user.personId ?? "__none__";
  } else if (q.personId) {
    where.personId = q.personId;
  }
  if (q.fundId) where.splits = { some: { fundId: q.fundId } };
  if (q.method) where.method = q.method;
  if (q.status) where.status = q.status;
  if (q.batchId) where.batchId = q.batchId;
  if (q.from || q.to) {
    where.receivedOn = {
      ...(parseDay(q.from) ? { gte: parseDay(q.from) } : {}),
      ...(dayEnd(q.to) ? { lte: dayEnd(q.to) } : {}),
    };
  }
  if (q.search?.trim() && givingScope(user) === "all") {
    const s = q.search.trim();
    const matchedPeople = await db.person.findMany({
      where: {
        orgId: user.orgId,
        OR: [{ firstName: { contains: s } }, { lastName: { contains: s } }, { email: { contains: s } }],
      },
      select: { id: true },
      take: 60,
    });
    where.OR = [
      { checkNumber: { contains: s } },
      { memo: { contains: s } },
      { personId: { in: matchedPeople.map((p) => p.id) } },
    ];
  }

  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, q.pageSize ?? 25));
  const [total, rows] = await Promise.all([
    db.donation.count({ where }),
    db.donation.findMany({
      where,
      orderBy: { receivedOn: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { splits: true },
    }),
  ]);
  const ctx = await donationMapContext(rows);
  return { total, page, pageSize, items: rows.map((d) => toDonationDTO(d, ctx)) };
}

export async function createDonation(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("amountCents must be a positive whole number of kobo.");
  const splits = Array.isArray(input?.splits) ? input.splits : [];
  if (!splits.length) throw badRequest("At least one fund split is required.");
  const splitSum = splits.reduce((a: number, s: any) => a + Math.round(Number(s.amountCents) || 0), 0);
  if (splitSum !== amount) throw badRequest(`Fund splits total ${splitSum} kobo but the gift is ${amount} kobo — they must match exactly.`);

  // ── posting is RESTRICTED (finance approval gate) ───────────────────────────
  // Every user-created gift lands as `pending` — NEVER `posted` at creation.
  // It only reaches the ledger (Dr Cash / Cr Revenue) when finance confirms it:
  //  • open batch     → pending, owned by the batch's two-person flow
  //                     (usher sign-off → accountant approve posts it)
  //  • closed batch   → pending as a standalone gift (not bound to a closed batch)
  //  • no batch       → pending + flagged for the accountant verification queue
  let status = "pending";
  let verificationStatus: string | null = "pending_verification";
  let batchId: string | null = null;
  if (input.batchId) {
    const batch = await db.batch.findFirst({ where: { id: input.batchId, orgId: user.orgId } });
    if (!batch) throw notFound("Batch not found.");
    if (batch.status === "open") {
      batchId = batch.id;
      verificationStatus = null; // the batch carries the verification state
    }
  }

  const donation = await db.donation.create({
    data: {
      orgId: user.orgId,
      personId: input.personId || null,
      householdId: input.householdId || null,
      batchId,
      amountCents: amount,
      method: input.method || "card",
      status,
      verificationStatus,
      receivedOn: input.receivedOn ? new Date(input.receivedOn) : new Date(),
      source: input.source || "admin",
      checkNumber: input.checkNumber || undefined,
      memo: input.memo || undefined,
      isAnonymous: !!input.isAnonymous,
      createdByName: user.name,
    },
  });
  await db.donationSplit.createMany({
    data: splits.map((s: any) => ({
      orgId: user.orgId,
      donationId: donation.id,
      fundId: s.fundId,
      amountCents: Math.round(Number(s.amountCents)),
    })),
  });
  await audit({
    orgId: user.orgId, actor: user, action: "gift.create", entityType: "donation", entityId: donation.id,
    after: { amountCents: amount, method: donation.method, status, verificationStatus, batchId, splits }, ip: meta.ip, userAgent: meta.userAgent,
  });
  // NOTE: no GL entry here on purpose. `journalDonation` runs ONLY when finance
  // approves the gift (approveDonationToGL) or its batch (approveBatchToGL).
  return { id: donation.id, status, verificationStatus };
}

export async function reverseDonation(user: SessionUser, donationId: string, reason: string, meta: { ip?: string; userAgent?: string }) {
  if (!reason?.trim()) throw badRequest("A reason is required to reverse a gift.");
  const original = await db.donation.findFirst({ where: { id: donationId, orgId: user.orgId }, include: { splits: true } });
  if (!original) throw notFound("Donation not found.");
  if (original.reversalOfId) throw badRequest("That record is already a reversal entry.");
  const existing = await db.donation.findUnique({ where: { reversalOfId: donationId } });
  if (existing) throw conflict("This gift has already been reversed.");

  // APPEND-ONLY: the original is never touched — a new reversal record is created.
  const reversal = await db.donation.create({
    data: {
      orgId: user.orgId,
      personId: original.personId,
      householdId: original.householdId,
      amountCents: original.amountCents,
      currency: original.currency,
      method: original.method,
      status: "reversed",
      receivedOn: new Date(),
      source: "admin",
      memo: reason.trim(),
      reversalOfId: original.id,
      reversalReason: reason.trim(),
      createdByName: user.name,
    },
  });
  if (original.splits.length) {
    await db.donationSplit.createMany({
      data: original.splits.map((s) => ({ orgId: user.orgId, donationId: reversal.id, fundId: s.fundId, amountCents: s.amountCents })),
    });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "gift.reverse", entityType: "donation", entityId: reversal.id,
    before: { id: original.id, amountCents: original.amountCents, status: original.status },
    after: { reversalId: reversal.id, reason: reason.trim() },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { reversalId: reversal.id };
}

// ── accountant confirmation of individual gifts (Giving↔GL gate) ────────────
// Pending gifts (member bank-transfer claims, clerk entries, batch leftovers)
// only hit the GL when a user with giving.verify.accountant (or
// accounting.manage) confirms them here or via the batch approve.

/** Accountant confirms ONE pending gift → posted + journal entry. */
export async function approveDonationToGL(user: SessionUser, donationId: string, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.verify.accountant") && !can(user, "accounting.manage")) {
    throw forbidden("Requires giving.verify.accountant or accounting.manage permission.");
  }
  const donation = await db.donation.findFirst({ where: { id: donationId, orgId: user.orgId }, include: { splits: true } });
  if (!donation) throw notFound("Donation not found.");
  if (donation.reversalOfId) throw badRequest("Reversal records cannot be approved.");
  if (donation.status === "posted") {
    // idempotent-friendly: make sure the journal exists, then report already posted
    await journalDonation(user, donation.id).catch(() => {});
    return { id: donation.id, status: "posted", alreadyPosted: true };
  }
  if (donation.status !== "pending") throw badRequest(`Only pending gifts can be approved (current: ${donation.status}).`);

  await db.donation.update({
    where: { id: donation.id },
    data: {
      status: "posted",
      verificationStatus: "accountant_verified",
      verifiedByAccountantId: user.membershipId,
      verifiedByAccountantAt: new Date(),
      rejectionNote: null,
    },
  });
  // GL posting MUST succeed — if the journal fails, roll the gift back to
  // pending so it stays in the accountant's queue instead of silently
  // disappearing from the ledger.
  try {
    const entry = await journalDonation(user, donation.id);
    if (!entry) throw new Error("Journal entry was not created for this gift.");
  } catch (err) {
    await db.donation.update({
      where: { id: donation.id },
      data: { status: "pending", verificationStatus: donation.verificationStatus ?? null, verifiedByAccountantId: null, verifiedByAccountantAt: null },
    }).catch(() => {});
    throw err instanceof Error ? err : badRequest("Could not post this gift to the GL.");
  }
  await audit({
    orgId: user.orgId, actor: user, action: "gift.approve_gl", entityType: "donation", entityId: donation.id,
    before: { status: "pending", amountCents: donation.amountCents },
    after: { status: "posted", accountant: user.name },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: donation.id, status: "posted" };
}

/** Bulk-approve pending gifts (skips failures, reports per-id results). */
export async function approveDonationsToGL(user: SessionUser, donationIds: string[], meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.verify.accountant") && !can(user, "accounting.manage")) {
    throw forbidden("Requires giving.verify.accountant or accounting.manage permission.");
  }
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of donationIds) {
    try {
      await approveDonationToGL(user, id, meta);
      results.push({ id, ok: true });
    } catch (e: any) {
      results.push({ id, ok: false, error: e?.message ?? String(e) });
    }
  }
  await audit({
    orgId: user.orgId, actor: user, action: "gift.approve_gl_bulk", entityType: "donation",
    after: { count: donationIds.length, succeeded: results.filter((r) => r.ok).length },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { results };
}

/** Accountant returns a pending gift with a mandatory query note (stays in queue). */
export async function rejectDonation(user: SessionUser, donationId: string, note: string, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.verify.accountant") && !can(user, "accounting.manage")) {
    throw forbidden("Requires giving.verify.accountant or accounting.manage permission.");
  }
  if (!note?.trim()) throw badRequest("A query note is required to return a gift.");
  const donation = await db.donation.findFirst({ where: { id: donationId, orgId: user.orgId } });
  if (!donation) throw notFound("Donation not found.");
  if (donation.status === "posted") throw conflict("A posted gift cannot be returned — reverse it instead.");
  await db.donation.update({
    where: { id: donation.id },
    data: { verificationStatus: "rejected", rejectionNote: note.trim() },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "gift.reject", entityType: "donation", entityId: donation.id,
    after: { note: note.trim() },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: donation.id, verificationStatus: "rejected" };
}

// ── batches ──────────────────────────────────────────────────────────────────

function toBatchDTO(b: any, donationCount: number, pendingCount: number) {
  return {
    id: b.id, name: b.name, kind: b.kind, serviceDate: b.serviceDate, status: b.status,
    verificationStatus: b.verificationStatus, serviceName: b.serviceName,
    totalCents: b.totalCents, donationCount, pendingCount, depositAccount: b.depositAccount,
    countedByOne: b.countedByOne, countedByTwo: b.countedByTwo, postedByName: b.postedByName, postedAt: b.postedAt,
  };
}

export async function listBatches(user: SessionUser) {
  const batches = await db.batch.findMany({ where: { orgId: user.orgId }, orderBy: { serviceDate: "desc" }, take: 60 });
  const donations = batches.length
    ? await db.donation.findMany({
        where: { orgId: user.orgId, batchId: { in: batches.map((b) => b.id) } },
        select: { batchId: true, amountCents: true, status: true },
      })
    : [];
  const agg: Record<string, { count: number; pending: number }> = {};
  for (const d of donations) {
    if (!d.batchId) continue;
    agg[d.batchId] ??= { count: 0, pending: 0 };
    agg[d.batchId].count += 1;
    if (d.status === "pending") agg[d.batchId].pending += 1;
  }
  return { items: batches.map((b) => toBatchDTO(b, agg[b.id]?.count ?? 0, agg[b.id]?.pending ?? 0)) };
}

export async function createBatch(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  if (!input?.name?.trim()) throw badRequest("Batch name is required.");
  if (!input?.serviceDate) throw badRequest("serviceDate is required.");
  const campusId = input.campusId || user.campusId || (await db.campus.findFirst({ where: { orgId: user.orgId }, select: { id: true } }))?.id;
  if (!campusId) throw badRequest("No campus available for this organization.");
  const batch = await db.batch.create({
    data: {
      orgId: user.orgId,
      campusId,
      name: input.name.trim(),
      kind: input.kind || "offering",
      serviceDate: new Date(input.serviceDate),
      depositAccount: input.depositAccount || undefined,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "batch.create", entityType: "batch", entityId: batch.id,
    after: { name: batch.name }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return toBatchDTO(batch, 0, 0);
}

export async function postBatch(user: SessionUser, batchId: string, countedByTwo: string, meta: { ip?: string; userAgent?: string }) {
  // Legacy two-person post path — now under the SAME finance approval gate as
  // individual gifts: posting moves pending gifts into the ledger, so it
  // requires giving.verify.accountant or accounting.manage. The canonical
  // batch flow (usher sign-off → approveBatchToGL) remains preferred.
  if (!can(user, "giving.verify.accountant") && !can(user, "accounting.manage")) {
    throw forbidden("Posting a batch to the ledger requires finance approval (giving.verify.accountant or accounting.manage).");
  }
  const batch = await db.batch.findFirst({ where: { id: batchId, orgId: user.orgId } });
  if (!batch) throw notFound("Batch not found.");
  if (batch.status !== "open") throw badRequest("Only open batches can be posted.");
  if (!countedByTwo?.trim()) throw badRequest("A second counter is required (two-person control).");
  if (batch.countedByOne && countedByTwo.trim() === batch.countedByOne) {
    throw badRequest("The second counter must be a different person than the first (two-person control).");
  }
  const donations = await db.donation.findMany({
    where: { batchId: batch.id, orgId: user.orgId },
    select: { amountCents: true, status: true },
  });
  const issues = donations.filter((d) => d.status === "failed");
  if (issues.length) throw badRequest(`Batch has ${issues.length} donation(s) with issues — resolve them before posting.`);

  await db.donation.updateMany({ where: { batchId: batch.id, status: "pending" }, data: { status: "posted" } });
  // journal the newly-posted gifts (Dr Cash / Cr Revenue per fund)
  const postedIds = await db.donation.findMany({ where: { batchId: batch.id, status: "posted" }, select: { id: true } });
  for (const d of postedIds) {
    await journalDonation(user, d.id).catch(() => {});
  }
  const totalCents = donations.reduce((a, d) => a + d.amountCents, 0);
  const updated = await db.batch.update({
    where: { id: batch.id },
    data: { status: "posted", countedByTwo: countedByTwo.trim(), postedByName: user.name, postedAt: new Date(), totalCents },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "batch.post", entityType: "batch", entityId: batch.id,
    before: { status: batch.status },
    after: { status: "posted", donationCount: donations.length, totalCents, countedByOne: batch.countedByOne, countedByTwo: countedByTwo.trim() },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return toBatchDTO(updated, donations.length, 0);
}

// ── pledges & recurring ──────────────────────────────────────────────────────

export async function listPledges(user: SessionUser, q: { fundId?: string; campaign?: string }) {
  const where: any = { orgId: user.orgId };
  if (givingScope(user) === "own") {
    where.personId = user.personId ?? "__none__"; // FORCE self-scope
  }
  if (q.fundId) where.fundId = q.fundId;
  if (q.campaign) where.campaign = { contains: q.campaign };
  const pledges = await db.pledge.findMany({ where, orderBy: { startsOn: "desc" }, take: 100 });
  const personIds = [...new Set(pledges.map((p) => p.personId))];
  const fundIds = [...new Set(pledges.map((p) => p.fundId))];
  const [persons, funds, donations] = await Promise.all([
    personIds.length ? db.person.findMany({ where: { id: { in: personIds } } }) : Promise.resolve([] as any[]),
    fundIds.length ? db.fund.findMany({ where: { id: { in: fundIds } } }) : Promise.resolve([] as any[]),
    personIds.length
      ? db.donation.findMany({
          where: { orgId: user.orgId, personId: { in: personIds }, status: "posted" },
          include: { splits: true },
        })
      : Promise.resolve([] as any[]),
  ]);
  const pMap = new Map(persons.map((p) => [p.id, p] as const));
  const fMap = new Map(funds.map((f) => [f.id, f] as const));
  return {
    items: pledges.map((pl) => {
      const progressCents = donations
        .filter((d) => d.personId === pl.personId && d.receivedOn.getTime() >= pl.startsOn.getTime())
        .flatMap((d) => d.splits)
        .filter((s) => s.fundId === pl.fundId)
        .reduce((a, s) => a + s.amountCents, 0);
      const fund = fMap.get(pl.fundId);
      return {
        id: pl.id,
        person: pMap.has(pl.personId)
          ? { id: pl.personId, name: `${pMap.get(pl.personId)!.firstName} ${pMap.get(pl.personId)!.lastName}` }
          : null,
        fund: fund ? { id: fund.id, name: fund.name } : null,
        campaign: pl.campaign,
        amountCents: pl.amountCents,
        frequency: pl.frequency,
        startsOn: pl.startsOn,
        endsOn: pl.endsOn,
        status: pl.status,
        progressCents,
        progressPct: pl.amountCents > 0 ? Math.min(999, Math.round((progressCents / pl.amountCents) * 100)) : 0,
      };
    }),
  };
}

export async function createPledge(user: SessionUser, input: any, meta: { ip?: string; userAgent?: string }) {
  const amount = Math.round(Number(input?.amountCents));
  if (!input?.fundId) throw badRequest("fundId is required.");
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("amountCents must be a positive whole number of kobo.");
  // staff (giving.pledges.manage) may pledge FOR anyone; a member may only
  // pledge for themselves and must hold giving.give — never trust client personId
  let personId = input.personId;
  if (!can(user, "giving.pledges.manage")) {
    if (!can(user, "giving.give")) throw forbidden("You do not have permission to create pledges.");
    if (!user.personId) throw forbidden("Your account is not linked to a people record.");
    personId = user.personId; // FORCE self
  }
  if (!personId) throw badRequest("personId is required.");
  const fund = await db.fund.findFirst({ where: { id: input.fundId, orgId: user.orgId, isActive: true } });
  if (!fund) throw notFound("Fund not found.");
  const pledge = await db.pledge.create({
    data: {
      orgId: user.orgId,
      personId,
      fundId: input.fundId,
      campaign: input.campaign ? String(input.campaign) : "General",
      amountCents: amount,
      frequency: input.frequency || "one_time",
      startsOn: input.startsOn ? new Date(input.startsOn) : new Date(),
      endsOn: input.endsOn ? new Date(input.endsOn) : undefined,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "pledge.create", entityType: "pledge", entityId: pledge.id,
    after: { campaign: pledge.campaign, amountCents: pledge.amountCents }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: pledge.id };
}

export async function listRecurringGifts(user: SessionUser) {
  const where: any = { orgId: user.orgId };
  if (givingScope(user) === "own") {
    where.personId = user.personId ?? "__none__"; // FORCE self-scope
  }
  const gifts = await db.recurringGift.findMany({ where, orderBy: { startedOn: "desc" }, take: 100 });
  const personIds = [...new Set(gifts.map((g) => g.personId))];
  const fundIds = [...new Set(gifts.map((g) => g.fundId))];
  const [persons, funds] = await Promise.all([
    personIds.length ? db.person.findMany({ where: { id: { in: personIds } } }) : Promise.resolve([] as any[]),
    fundIds.length ? db.fund.findMany({ where: { id: { in: fundIds } } }) : Promise.resolve([] as any[]),
  ]);
  const pMap = new Map(persons.map((p) => [p.id, p] as const));
  const fMap = new Map(funds.map((f) => [f.id, f] as const));
  return {
    items: gifts.map((g) => {
      const p = pMap.get(g.personId);
      const fund = fMap.get(g.fundId);
      return {
        id: g.id,
        person: p ? { id: p.id, name: `${p.firstName} ${p.lastName}` } : null,
        fund: fund ? { id: fund.id, name: fund.name } : null,
        amountCents: g.amountCents,
        frequency: g.frequency,
        nextRunAt: g.nextRunAt,
        status: g.status,
        failureCount: g.failureCount,
      };
    }),
  };
}

function addFrequency(from: Date, frequency: string): Date {
  const d = new Date(from);
  switch (frequency) {
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "annual": d.setFullYear(d.getFullYear() + 1); break;
    default: d.setMonth(d.getMonth() + 1); // monthly
  }
  return d;
}

/** Shared ownership rule for self-service recurring-gift management. */
function assertRecurringOwnership(user: SessionUser, gift: { personId: string }) {
  if (can(user, "giving.view.all")) return; // staff may manage any
  if (can(user, "giving.give") && gift.personId === user.personId) return;
  throw forbidden("You can only manage your own recurring gifts.");
}

export async function pauseRecurringGift(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const gift = await db.recurringGift.findFirst({ where: { id, orgId: user.orgId } });
  if (!gift) throw notFound("Recurring gift not found.");
  assertRecurringOwnership(user, gift);
  if (gift.status !== "active") throw badRequest("Only active recurring gifts can be paused.");
  await db.recurringGift.update({ where: { id: gift.id }, data: { status: "paused" } });
  await audit({
    orgId: user.orgId, actor: user, action: "recurring.pause", entityType: "recurring_gift", entityId: gift.id,
    before: { status: gift.status }, after: { status: "paused" }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, status: "paused" };
}

export async function resumeRecurringGift(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const gift = await db.recurringGift.findFirst({ where: { id, orgId: user.orgId } });
  if (!gift) throw notFound("Recurring gift not found.");
  assertRecurringOwnership(user, gift);
  if (gift.status !== "paused") throw badRequest("Only paused recurring gifts can be resumed.");
  // if the next run lapsed while paused, roll it forward one cadence from now
  const nextRunAt = gift.nextRunAt && gift.nextRunAt.getTime() > Date.now() ? gift.nextRunAt : addFrequency(new Date(), gift.frequency);
  await db.recurringGift.update({ where: { id: gift.id }, data: { status: "active", nextRunAt } });
  await audit({
    orgId: user.orgId, actor: user, action: "recurring.resume", entityType: "recurring_gift", entityId: gift.id,
    before: { status: gift.status }, after: { status: "active" }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, status: "active", nextRunAt };
}

export async function cancelRecurringGift(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  const gift = await db.recurringGift.findFirst({ where: { id, orgId: user.orgId } });
  if (!gift) throw notFound("Recurring gift not found.");
  // self-service: a member may cancel their OWN recurring gift; staff (view.all) may cancel any
  if (!(can(user, "giving.view.all") || (can(user, "giving.give") && gift.personId === user.personId))) {
    throw forbidden("You can only manage your own recurring gifts.");
  }
  await db.recurringGift.update({ where: { id: gift.id }, data: { status: "canceled", canceledAt: new Date() } });
  await audit({
    orgId: user.orgId, actor: user, action: "recurring.cancel", entityType: "recurring_gift", entityId: gift.id,
    before: { status: gift.status }, after: { status: "canceled" }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ── giving statements ────────────────────────────────────────────────────────

export async function listStatements(user: SessionUser, taxYear?: number) {
  const where: any = { orgId: user.orgId, ...(taxYear ? { taxYear } : {}) };
  if (givingScope(user) === "own") {
    // a member's statements are keyed by the STATEMENT UNIT (household head's
    // personId) — scope to their personId OR the household they belong to
    if (user.personId) {
      const memberships = await db.householdMember.findFirst({
        where: { personId: user.personId, endedAt: null },
        select: { householdId: true },
      });
      where.OR = [{ personId: user.personId }, ...(memberships ? [{ householdId: memberships.householdId }] : [])];
    } else {
      where.personId = "__none__";
    }
  }
  const statements = await db.givingStatement.findMany({ where, orderBy: [{ taxYear: "desc" }, { totalCents: "desc" }], take: 200 });
  const personIds = [...new Set(statements.map((s) => s.personId))];
  const householdIds = [...new Set(statements.map((s) => s.householdId).filter(Boolean))] as string[];
  const [persons, households] = await Promise.all([
    personIds.length ? db.person.findMany({ where: { id: { in: personIds } } }) : Promise.resolve([] as any[]),
    householdIds.length ? db.household.findMany({ where: { id: { in: householdIds } } }) : Promise.resolve([] as any[]),
  ]);
  const pMap = new Map(persons.map((p) => [p.id, p] as const));
  const hMap = new Map(households.map((h) => [h.id, h] as const));
  return {
    items: statements.map((s) => {
      const p = pMap.get(s.personId);
      return {
        id: s.id,
        personId: s.personId,
        personName: p ? `${p.firstName} ${p.lastName}` : "Unknown",
        householdName: s.householdId ? hMap.get(s.householdId)?.name ?? null : null,
        taxYear: s.taxYear,
        totalCents: s.totalCents,
        status: s.status,
        generatedAt: s.generatedAt,
        sentAt: s.sentAt,
      };
    }),
  };
}

/** Group the year's posted, non-reversed donations per statement unit and upsert statements. */
export async function generateStatements(user: SessionUser, taxYear: number, meta: { ip?: string; userAgent?: string }) {
  const year = Math.round(Number(taxYear));
  if (!Number.isFinite(year) || year < 1990 || year > 2100) throw badRequest("A valid taxYear is required.");
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  const donations = await db.donation.findMany({
    where: { orgId: user.orgId, status: "posted", receivedOn: { gte: from, lt: to } },
    select: { id: true, personId: true, householdId: true, amountCents: true },
  });
  const reversalTargets = await db.donation.findMany({
    where: { orgId: user.orgId, reversalOfId: { in: donations.map((d) => d.id) } },
    select: { reversalOfId: true },
  });
  const reversedIds = new Set(reversalTargets.map((r) => r.reversalOfId));
  const eligible = donations.filter((d) => !reversedIds.has(d.id));

  const personIds = [...new Set(eligible.map((d) => d.personId).filter(Boolean))] as string[];
  const links = personIds.length
    ? await db.householdMember.findMany({ where: { personId: { in: personIds }, endedAt: null } })
    : [];
  const householdOf = new Map(links.map((l) => [l.personId, l.householdId] as const));
  const householdIds = [...new Set(eligible.map((d) => d.householdId ?? householdOf.get(d.personId ?? "") ?? null).filter(Boolean))] as string[];
  const households = householdIds.length ? await db.household.findMany({ where: { id: { in: householdIds } } }) : [];
  const hMap = new Map(households.map((h) => [h.id, h] as const));

  // group by statement unit: household when known, else the individual person
  const units = new Map<string, { householdId: string | null; personId: string; totalCents: number }>();
  for (const d of eligible) {
    const householdId = d.householdId ?? householdOf.get(d.personId ?? "") ?? null;
    const key = householdId ? `h:${householdId}` : `p:${d.personId}`;
    const unit = units.get(key);
    if (unit) {
      unit.totalCents += d.amountCents;
    } else {
      let statementPersonId = d.personId ?? "";
      if (householdId) {
        const h = hMap.get(householdId);
        statementPersonId = h?.headPersonId ?? d.personId ?? "";
      }
      units.set(key, { householdId, personId: statementPersonId, totalCents: d.amountCents });
    }
  }

  let created = 0;
  for (const unit of units.values()) {
    if (!unit.personId) continue;
    await db.givingStatement.upsert({
      where: { orgId_personId_taxYear_kind: { orgId: user.orgId, personId: unit.personId, taxYear: year, kind: "annual" } },
      create: {
        orgId: user.orgId, personId: unit.personId, householdId: unit.householdId,
        taxYear: year, kind: "annual", totalCents: unit.totalCents, status: "generated",
      },
      update: { totalCents: unit.totalCents, householdId: unit.householdId },
    });
    created += 1;
  }
  await audit({
    orgId: user.orgId, actor: user, action: "statements.generate", entityType: "giving_statement",
    after: { taxYear: year, created }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { created };
}

/** Printable HTML statement with per-gift lines + the required IRS language. */
export async function previewStatement(user: SessionUser, statementId: string) {
  const stmt = await db.givingStatement.findFirst({ where: { id: statementId, orgId: user.orgId } });
  if (!stmt) throw notFound("Statement not found.");
  // staff with statements.manage may preview any; everyone else only their own
  // household/unit (statements are keyed to the household head's personId)
  if (!can(user, "giving.statements.manage")) {
    let allowed = user.personId != null && stmt.personId === user.personId;
    if (!allowed && user.personId) {
      const link = await db.householdMember.findFirst({
        where: { personId: user.personId, endedAt: null, householdId: stmt.householdId ?? "__none__" },
        select: { id: true },
      });
      allowed = !!link;
    }
    if (!allowed) throw forbidden("You can only view your own giving statements.");
  }
  const org = await db.organization.findUnique({ where: { id: user.orgId } });

  const year = stmt.taxYear;
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  let memberIds: string[] = [stmt.personId];
  let issuedTo = "";
  if (stmt.householdId) {
    const links = await db.householdMember.findMany({ where: { householdId: stmt.householdId, endedAt: null } });
    memberIds = links.map((l) => l.personId);
    const h = await db.household.findUnique({ where: { id: stmt.householdId } });
    issuedTo = h?.name ?? "";
  }
  const people = await db.person.findMany({ where: { id: { in: memberIds } } });
  if (!issuedTo) {
    const primary = people.find((p) => p.id === stmt.personId) ?? people[0];
    issuedTo = primary ? `${primary.firstName} ${primary.lastName}` : "Giving statement";
  }

  const donations = await db.donation.findMany({
    where: { orgId: user.orgId, status: "posted", receivedOn: { gte: from, lt: to }, personId: { in: memberIds } },
    include: { splits: true },
    orderBy: { receivedOn: "asc" },
  });
  const reversalTargets = await db.donation.findMany({
    where: { orgId: user.orgId, reversalOfId: { in: donations.map((d) => d.id) } },
    select: { reversalOfId: true },
  });
  const reversedIds = new Set(reversalTargets.map((r) => r.reversalOfId));
  const gifts = donations.filter((d) => !reversedIds.has(d.id));

  const fundIds = [...new Set(gifts.flatMap((d) => d.splits.map((s) => s.fundId)))];
  const funds = fundIds.length ? await db.fund.findMany({ where: { id: { in: fundIds } } }) : [];
  const fMap = new Map(funds.map((f) => [f.id, f] as const));

  const total = gifts.reduce((a, d) => a + d.amountCents, 0);
  const rows = gifts
    .map((d) => {
      const fundNames = [...new Set(d.splits.map((s) => fMap.get(s.fundId)?.name ?? "Fund"))].join(", ");
      return `<tr><td>${escapeHtml(d.receivedOn.toISOString().slice(0, 10))}</td><td>${escapeHtml(fundNames)}</td><td class="amt">${escapeHtml(money(d.amountCents))}</td></tr>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Giving Statement ${year} — ${escapeHtml(issuedTo)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; margin: 40px auto; max-width: 680px; color: #1a1a1a; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 16px; font-weight: normal; color: #444; margin: 4px 0 24px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; font-size: 14px; }
  th { border-bottom: 2px solid #999; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  td.amt, th.amt { text-align: right; }
  tfoot td { font-weight: bold; border-top: 2px solid #999; border-bottom: none; }
  .irs { margin-top: 28px; font-size: 13px; color: #333; border-top: 1px solid #ccc; padding-top: 12px; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <h1>${escapeHtml(org?.name ?? "Church")}</h1>
  <h2>Annual Giving Statement — Tax Year ${year}</h2>
  <p>Issued to: <strong>${escapeHtml(issuedTo)}</strong></p>
  <table>
    <thead><tr><th>Date received</th><th>Fund</th><th class="amt">Amount</th></tr></thead>
    <tbody>
      ${rows || `<tr><td colspan="3">No contributions recorded for ${year}.</td></tr>`}
    </tbody>
    <tfoot><tr><td colspan="2">Total contributions for ${year}</td><td class="amt">${escapeHtml(money(total))}</td></tr></tfoot>
  </table>
  <p class="irs">No goods or services were provided in exchange for this contribution.</p>
</body>
</html>`;
  return { html };
}

// ═════════════════════ MEMBER SELF-SERVICE GIVING (giving.give) ═════════════
// Demo payment processor: tokens only, never PAN. The seam mirrors Stripe —
// payment methods tokenize client-side (SetupIntent equivalent), gifts go
// through an intent (PaymentIntent equivalent) with an idempotency key, and
// only SETTLED payments create rows in the immutable donations ledger.

interface PaymentMethodDTO {
  id: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  provider: string;
}

function toPaymentMethodDTO(pm: {
  id: string; type: string; brand: string | null; last4: string | null;
  expMonth: number | null; expYear: number | null; isDefault: boolean; provider: string;
}): PaymentMethodDTO {
  return {
    id: pm.id, type: pm.type, brand: pm.brand, last4: pm.last4,
    expMonth: pm.expMonth, expYear: pm.expYear, isDefault: pm.isDefault, provider: pm.provider,
  };
}

export async function listMyPaymentMethods(user: SessionUser) {
  if (!user.personId) return { items: [] as PaymentMethodDTO[] };
  const methods = await db.paymentMethod.findMany({
    where: { orgId: user.orgId, personId: user.personId, status: "active" },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
  });
  return { items: methods.map(toPaymentMethodDTO) };
}

/**
 * Tokenize a new payment method. The client (Elements equivalent) sends ONLY
 * display metadata + a processor token — raw card/bank numbers never reach
 * this server. The demo provider generates the token server-side from the
 * display fields, exactly like a SetupIntent would.
 */
export async function addMyPaymentMethod(
  user: SessionUser,
  input: { type?: string; brand?: string; last4?: string; expMonth?: number; expYear?: number; makeDefault?: boolean },
  meta: { ip?: string; userAgent?: string },
) {
  if (!can(user, "giving.give")) throw forbidden("You do not have permission to manage payment methods.");
  if (!user.personId) throw forbidden("Your account is not linked to a people record.");
  const type = input?.type === "ach" ? "ach" : "card";
  const brand = String(input?.brand ?? "").trim().toLowerCase();
  const last4 = String(input?.last4 ?? "").trim();
  if (type === "card" && !["visa", "mastercard", "amex", "discover"].includes(brand)) {
    throw badRequest("Card brand must be visa, mastercard, amex or discover.");
  }
  if (!/^\d{4}$/.test(last4)) throw badRequest("Provide exactly the last 4 digits — full card numbers are never sent to the server.");
  if (type === "card") {
    const m = Math.round(Number(input?.expMonth));
    let y = Math.round(Number(input?.expYear));
    if (Number.isFinite(y) && y > 0 && y < 100) y += 2000; // tolerate 2-digit years
    if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(y) || y < 2024 || y > 2100) {
      throw badRequest("A valid expiry month and year are required.");
    }
  }
  const count = await db.paymentMethod.count({ where: { orgId: user.orgId, personId: user.personId, status: "active" } });
  const makeDefault = input?.makeDefault || count === 0;
  if (makeDefault) {
    await db.paymentMethod.updateMany({ where: { orgId: user.orgId, personId: user.personId, status: "active" }, data: { isDefault: false } });
  }
  const pm = await db.paymentMethod.create({
    data: {
      orgId: user.orgId,
      personId: user.personId,
      provider: "demo",
      providerMethodId: `pm_demo_${randomBytes(10).toString("hex")}`,
      type,
      brand: type === "card" ? brand : null,
      last4,
      expMonth: type === "card" ? Math.round(Number(input?.expMonth)) : null,
      expYear: type === "card"
        ? (Math.round(Number(input?.expYear)) < 100
          ? Math.round(Number(input?.expYear)) + 2000
          : Math.round(Number(input?.expYear)))
        : null,
      isDefault: makeDefault,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "payment_method.add", entityType: "payment_method", entityId: pm.id,
    after: { type, brand: pm.brand, last4 }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return toPaymentMethodDTO(pm);
}

export async function setDefaultPaymentMethod(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.give")) throw forbidden("You do not have permission to manage payment methods.");
  const pm = await db.paymentMethod.findFirst({ where: { id, orgId: user.orgId, personId: user.personId ?? "__none__", status: "active" } });
  if (!pm) throw notFound("Payment method not found.");
  await db.paymentMethod.updateMany({ where: { orgId: user.orgId, personId: user.personId, status: "active" }, data: { isDefault: false } });
  await db.paymentMethod.update({ where: { id: pm.id }, data: { isDefault: true } });
  await audit({ orgId: user.orgId, actor: user, action: "payment_method.default", entityType: "payment_method", entityId: pm.id, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

export async function removeMyPaymentMethod(user: SessionUser, id: string, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.give")) throw forbidden("You do not have permission to manage payment methods.");
  const pm = await db.paymentMethod.findFirst({ where: { id, orgId: user.orgId, personId: user.personId ?? "__none__", status: "active" } });
  if (!pm) throw notFound("Payment method not found.");
  await db.paymentMethod.update({ where: { id: pm.id }, data: { status: "archived", isDefault: false } });
  await audit({ orgId: user.orgId, actor: user, action: "payment_method.remove", entityType: "payment_method", entityId: pm.id, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

export interface GiveNowInput {
  amountCents?: number;
  splits?: { fundId: string; amountCents: number }[];
  channel?: "online" | "cash"; // online = processor charge (default); cash = hand in at church
  paymentMethodId?: string;
  coverFee?: boolean;
  idempotencyKey?: string;
  memo?: string;
  recurring?: { frequency: string; anchorDay?: number } | null;
}

/**
 * Give now — the member-facing gift flow.
 * • channel "cash" records a physical-money gift with NO processor charge
 *   (see giveNowCash); channel "online" (default) charges the saved method.
 * • Idempotency: a repeated key returns the SAME result instead of double-charging.
 * • Splits must balance to the kobo (same rule as the staff ledger).
 * • Only a SETTLED payment creates a donation row; the OnlinePayment row keeps
 *   the processor-side lifecycle (failed attempts never touch the ledger).
 * • Processor seam: demo processor settles synchronously; when STRIPE_SECRET_KEY
 *   is configured the same request runs through a real Stripe PaymentIntent —
 *   SCA/ACH flows return a clientSecret the member confirms in-browser, and the
 *   signed webhook completes settlement (see settleOnlinePayment).
 */
export async function giveNow(user: SessionUser, input: GiveNowInput, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.give")) throw forbidden("You do not have permission to give online.");
  if (!user.personId) throw forbidden("Your account is not linked to a people record.");
  // CASH channel: physical money handed to an usher / the church office — no
  // processor involved, so the online-payment KYC gate does NOT apply (it
  // explicitly keeps cash recording available before verification). The gift
  // still lands as pending and goes through the SAME finance confirmation
  // queue as online gifts — nothing posts to the GL until finance approves.
  if (input?.channel === "cash") return giveNowCash(user, input, meta);
  // Tenant-onboarding KYC gate (spec §6): online payment processing requires
  // the church to be verified AND to have a settlement bank account on file.
  await assertOnlineGivingAllowed(user.orgId);
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount < 100) throw badRequest("Minimum online gift is ₦1.");
  const splits = Array.isArray(input?.splits) ? input.splits.filter((s: any) => s?.fundId) : [];
  if (!splits.length) throw badRequest("Choose at least one fund.");
  const splitSum = splits.reduce((a: number, s: any) => a + Math.round(Number(s.amountCents) || 0), 0);
  if (splitSum !== amount) throw badRequest(`Fund splits total ${splitSum} kobo but the gift is ${amount} kobo — they must match exactly.`);
  const funds = await db.fund.findMany({ where: { orgId: user.orgId, id: { in: splits.map((s: any) => s.fundId) }, isActive: true } });
  if (funds.length !== new Set(splits.map((s: any) => s.fundId)).size) throw badRequest("One or more funds are unavailable.");
  if (!input?.idempotencyKey?.trim()) throw badRequest("idempotencyKey is required.");

  const key = input.idempotencyKey.trim();
  const existing = await db.onlinePayment.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    return {
      paymentId: existing.id, status: existing.status, donationId: existing.donationId,
      feeCents: existing.feeCents, amountCents: existing.amountCents, duplicate: true,
      provider: existing.provider, clientSecret: undefined as string | undefined,
    };
  }

  const pm = await db.paymentMethod.findFirst({
    where: { id: input.paymentMethodId ?? "", orgId: user.orgId, personId: user.personId, status: "active" },
  });
  if (!pm) throw notFound("Pick a saved payment method.");

  const coverFee = !!input.coverFee;
  const baseFee = processorFeeCents(amount);
  // donor covers the fee on top of the gift; charge total = amount + (coverFee ? fee : 0)
  const fee = coverFee ? baseFee : 0;
  const chargeTotal = amount + fee;

  const metaJson = JSON.stringify({
    giftAmountCents: amount,
    coverFee,
    memo: input.memo?.trim() || "",
    recurring: input.recurring ?? null,
  });

  // ── REAL STRIPE PATH (STRIPE_SECRET_KEY configured) ─────────────────────────
  if (stripeEnabled() && pm.provider === "stripe") {
    const stripe = await getStripe();
    const personRow = await db.person.findUnique({ where: { id: user.personId }, select: { id: true, firstName: true, lastName: true, email: true } });
    const person = personRow ? { id: personRow.id, name: `${personRow.firstName} ${personRow.lastName}`.trim(), email: personRow.email } : { id: user.personId, name: null, email: null };
    const customerId = await ensureCustomer(stripe, pm.providerCustomerId, person);
    if (customerId !== pm.providerCustomerId) {
      await db.paymentMethod.update({ where: { id: pm.id }, data: { providerCustomerId: customerId } });
    }
    const intent = await createGiftIntent({
      amountCents: chargeTotal,
      customerId,
      paymentMethodId: pm.providerMethodId,
      type: pm.type,
      idempotencyKey: key,
      memo: input.memo?.trim() || undefined,
      personId: user.personId,
      fundSummary: splits.map((s: any) => funds.find((f) => f.id === s.fundId)?.name ?? s.fundId).join(", "),
    });
    const payment = await db.onlinePayment.create({
      data: {
        orgId: user.orgId, personId: user.personId, provider: "stripe",
        providerIntentId: intent.intentId, paymentMethodId: pm.id,
        amountCents: chargeTotal, feeCents: fee, donorCoveredFee: coverFee,
        status: "processing", splitsJson: JSON.stringify(splits.map((s: any) => ({ fundId: s.fundId, amountCents: Math.round(Number(s.amountCents)) }))),
        metaJson, idempotencyKey: key,
      },
    });
    if (intent.status === "succeeded") {
      const donation = await settleOnlinePayment(payment.id);
      return { paymentId: payment.id, status: "succeeded", donationId: donation?.id ?? null, amountCents: chargeTotal, feeCents: fee, provider: "stripe", clientSecret: undefined };
    }
    if (intent.status === "failed") {
      await db.onlinePayment.update({
        where: { id: payment.id },
        data: { status: "failed", failureReason: intent.failureReason ?? "Payment failed." },
      });
      throw badRequest(intent.failureReason ?? "Payment failed — no charge was made.");
    }
    // requires_action → member finishes SCA/ACH mandate in-browser; the signed
    // webhook settles it. The ledger stays untouched until then.
    await audit({
      orgId: user.orgId, actor: user, action: "gift.intent_created", entityType: "online_payment", entityId: payment.id,
      after: { amountCents: chargeTotal, provider: "stripe", intentStatus: intent.status }, ip: meta.ip, userAgent: meta.userAgent,
    });
    return { paymentId: payment.id, status: intent.status, donationId: null, amountCents: chargeTotal, feeCents: fee, provider: "stripe", clientSecret: intent.clientSecret };
  }

  // ── DEMO PROCESSOR PATH (default — no keys configured) ──────────────────────
  const intentId = `pi_demo_${randomBytes(12).toString("hex")}`;
  const payment = await db.onlinePayment.create({
    data: {
      orgId: user.orgId,
      personId: user.personId,
      provider: "demo",
      providerIntentId: intentId,
      paymentMethodId: pm.id,
      amountCents: chargeTotal,
      feeCents: fee,
      donorCoveredFee: coverFee,
      status: "processing",
      splitsJson: JSON.stringify(splits.map((s: any) => ({ fundId: s.fundId, amountCents: Math.round(Number(s.amountCents)) }))),
      metaJson,
      idempotencyKey: key,
    },
  });

  try {
    const donation = await settleOnlinePayment(payment.id);
    return { paymentId: payment.id, status: "succeeded", donationId: donation?.id ?? null, amountCents: chargeTotal, feeCents: fee, provider: "demo", clientSecret: undefined };
  } catch (err) {
    // failed attempts NEVER create donation rows — ledger stays clean
    await db.onlinePayment.update({
      where: { id: payment.id },
      data: { status: "failed", failureReason: err instanceof Error ? err.message.slice(0, 400) : "processing error" },
    });
    throw err;
  }
}

/**
 * Cash channel of give-now: the member declares a gift they will hand in as
 * PHYSICAL cash (offering bag, usher, church office). No processor charge and
 * no OnlinePayment row — the donation is recorded immutably as method "cash",
 * status "pending", flagged for the accountant verification queue; finance
 * confirms receipt and only then journals Dr Cash / Cr Revenue. Zero fees on
 * cash. Idempotent by the same key contract as the online channel.
 */
async function giveNowCash(user: SessionUser, input: GiveNowInput, meta: { ip?: string; userAgent?: string }) {
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount < 100) throw badRequest("Minimum gift is ₦1.");
  const splits = Array.isArray(input?.splits) ? input.splits.filter((s: any) => s?.fundId) : [];
  if (!splits.length) throw badRequest("Choose at least one fund.");
  const splitSum = splits.reduce((a: number, s: any) => a + Math.round(Number(s.amountCents) || 0), 0);
  if (splitSum !== amount) throw badRequest(`Fund splits total ${splitSum} kobo but the gift is ${amount} kobo — they must match exactly.`);
  const funds = await db.fund.findMany({ where: { orgId: user.orgId, id: { in: splits.map((s: any) => s.fundId) }, isActive: true } });
  if (funds.length !== new Set(splits.map((s: any) => s.fundId)).size) throw badRequest("One or more funds are unavailable.");
  if (!input?.idempotencyKey?.trim()) throw badRequest("idempotencyKey is required.");
  const key = input.idempotencyKey.trim();

  // Idempotency: the donation row carries the unique key — a replay returns
  // the SAME pending gift instead of recording a duplicate.
  const existing = await db.donation.findUnique({ where: { idempotencyKey: key } });
  if (existing && existing.orgId === user.orgId && existing.personId === user.personId) {
    return {
      paymentId: null as string | null, donationId: existing.id, status: "pending_confirmation",
      amountCents: existing.amountCents, feeCents: 0, provider: "cash", method: "cash",
      duplicate: true, clientSecret: undefined as string | undefined,
    };
  }

  const personRow = await db.person.findUnique({ where: { id: user.personId }, select: { firstName: true, lastName: true } });
  const donorName = personRow ? `${personRow.firstName} ${personRow.lastName}`.trim() : null;

  const donation = await db.$transaction(async (tx) => {
    const d = await tx.donation.create({
      data: {
        orgId: user.orgId,
        personId: user.personId,
        amountCents: amount,
        method: "cash",
        status: "pending", // finance approval gate — no direct GL posting
        verificationStatus: "pending_verification",
        receivedOn: new Date(),
        source: "member_cash",
        feeCents: 0, // physical cash — no processor fee
        netCents: amount,
        memo: input.memo?.trim() || undefined,
        idempotencyKey: key,
        createdByName: donorName,
      },
    });
    await tx.donationSplit.createMany({
      data: splits.map((s: any) => ({ orgId: user.orgId, donationId: d.id, fundId: s.fundId, amountCents: Math.round(Number(s.amountCents)) })),
    });
    return d;
  });

  await audit({
    orgId: user.orgId, actor: user, action: "gift.cash_recorded", entityType: "donation", entityId: donation.id,
    after: { amountCents: amount, method: "cash", status: "pending", verificationStatus: "pending_verification", source: "member_cash" },
    ip: meta.ip, userAgent: meta.userAgent,
  });

  return {
    paymentId: null as string | null, donationId: donation.id, status: "pending_confirmation",
    amountCents: amount, feeCents: 0, provider: "cash", method: "cash",
    clientSecret: undefined as string | undefined,
  };
}

/**
 * Settle an online payment: create the immutable donation + splits (+ optional
 * recurring gift) inside one transaction, mark the payment succeeded and audit.
 * Idempotent — the webhook path and the synchronous path both funnel here, and
 * a second call is a no-op. Returns the donation (null when the payment was
 * already settled/failed).
 *
 * The processor charge is REAL money, but the LEDGER entry is gated: the
 * donation lands as `pending` (flagged for the accountant verification queue)
 * and only journals when finance approves it — same control as clerk-recorded
 * gifts. A queued gift is "awaiting finance confirmation", never lost.
 */
export async function settleOnlinePayment(paymentId: string): Promise<{ id: string } | null> {
  const op = await db.onlinePayment.findUnique({ where: { id: paymentId } });
  if (!op) return null;
  if (op.status !== "processing") return op.donationId ? db.donation.findUnique({ where: { id: op.donationId }, select: { id: true } }) : null;

  const pm = op.paymentMethodId ? await db.paymentMethod.findUnique({ where: { id: op.paymentMethodId } }) : null;
  const method = pm?.type === "ach" ? "ach" : "card";
  const splits = (JSON.parse(op.splitsJson || "[]") as { fundId: string; amountCents: number }[]).filter((s) => s?.fundId);
  const metaInfo = JSON.parse(op.metaJson || "{}") as {
    giftAmountCents?: number; coverFee?: boolean; memo?: string;
    recurring?: { frequency: string; anchorDay?: number } | null;
  };
  const giftAmount = Math.round(Number(metaInfo.giftAmountCents ?? op.amountCents));
  const personRow = await db.person.findUnique({ where: { id: op.personId }, select: { firstName: true, lastName: true } });
  const donorName = personRow ? `${personRow.firstName} ${personRow.lastName}`.trim() : "Online gift";

  const donation = await db.$transaction(async (tx) => {
    const d = await tx.donation.create({
      data: {
        orgId: op.orgId,
        personId: op.personId,
        amountCents: giftAmount, // the GIFT amount; processor fee is recorded separately
        method,
        status: "pending", // finance approval gate — no direct GL posting
        verificationStatus: "pending_verification",
        receivedOn: new Date(),
        source: metaInfo.recurring ? "recurring" : "hosted_page",
        externalId: op.providerIntentId,
        feeCents: op.feeCents,
        netCents: giftAmount - (metaInfo.coverFee ? 0 : op.feeCents), // net after effective fee
        memo: metaInfo.memo?.trim() || undefined,
        idempotencyKey: op.idempotencyKey,
        createdByName: donorName,
      },
    });
    if (splits.length) {
      await tx.donationSplit.createMany({
        data: splits.map((s) => ({ orgId: op.orgId, donationId: d.id, fundId: s.fundId, amountCents: Math.round(Number(s.amountCents)) })),
      });
    }
    if (metaInfo.recurring) {
      const freq = metaInfo.recurring.frequency;
      const validFreqs = ["weekly", "biweekly", "monthly", "quarterly", "annual"];
      if (!validFreqs.includes(freq)) throw badRequest("Unknown recurring frequency.");
      const anchor = Math.min(28, Math.max(1, Math.round(Number(metaInfo.recurring.anchorDay) || 1)));
      await tx.recurringGift.create({
        data: {
          orgId: op.orgId,
          personId: op.personId,
          paymentMethodId: op.paymentMethodId,
          fundId: splits[0]?.fundId ?? (await db.fund.findFirst({ where: { orgId: op.orgId, type: "tithe" } }))?.id ?? "",
          amountCents: giftAmount,
          frequency: freq,
          anchorDay: anchor,
          nextRunAt: addFrequency(new Date(), freq),
          status: "active",
          startedOn: new Date(),
        },
      });
    }
    await tx.onlinePayment.update({ where: { id: op.id }, data: { status: "succeeded", donationId: d.id, settledAt: new Date() } });
    return d;
  });

  await audit({
    orgId: op.orgId, actorType: "system", action: "gift.online", entityType: "donation", entityId: donation.id,
    after: { amountCents: giftAmount, method, status: "pending", verificationStatus: "pending_verification", feeCents: op.feeCents, coverFee: !!metaInfo.coverFee, paymentId: op.id, provider: op.provider },
  });
  // NOTE: no GL bridge here — the gift stays pending until finance approves it
  // (approveDonationToGL journals Dr Cash / Cr Revenue at that point).
  return donation;
}

// ═════════════════════ TITHE COMMITMENTS (giving covenant) ══════════════════

export async function getMyCommitment(user: SessionUser) {
  if (!user.personId) return { commitment: null };
  const commitment = await db.givingCommitment.findFirst({
    where: { orgId: user.orgId, personId: user.personId, endedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return { commitment: commitment ? {
    id: commitment.id,
    commitmentType: commitment.commitmentType,
    percent: commitment.percent,
    fixedAmountCents: commitment.fixedAmountCents,
    frequency: commitment.frequency,
    startedOn: commitment.startedOn,
  } : null };
}

/**
 * Set / revise the member's own tithe commitment. Self-service only — the
 * personId is ALWAYS the signed-in member. Revising soft-ends the previous
 * commitment (history kept, never edited) and starts a new one.
 */
export async function upsertMyCommitment(
  user: SessionUser,
  input: { commitmentType?: string; percent?: number; fixedAmountCents?: number; frequency?: string },
  meta: { ip?: string; userAgent?: string },
) {
  if (!can(user, "giving.give")) throw forbidden("You do not have permission to manage your commitment.");
  if (!user.personId) throw forbidden("Your account is not linked to a people record.");
  const type = input?.commitmentType === "fixed_amount" ? "fixed_amount" : "tithe_percent";
  let percent: number | null = null;
  let fixedAmountCents: number | null = null;
  if (type === "tithe_percent") {
    percent = Math.round(Number(input?.percent) * 100) / 100;
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw badRequest("Percent must be between 0 and 100.");
  } else {
    fixedAmountCents = Math.round(Number(input?.fixedAmountCents));
    if (!Number.isFinite(fixedAmountCents) || fixedAmountCents < 100) throw badRequest("Fixed amount must be at least $1.00.");
  }
  const frequency = ["weekly", "biweekly", "monthly", "annual"].includes(String(input?.frequency)) ? String(input?.frequency) : null;

  const previous = await db.givingCommitment.findFirst({
    where: { orgId: user.orgId, personId: user.personId, endedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (previous) {
    await db.givingCommitment.update({ where: { id: previous.id }, data: { endedAt: new Date() } });
  }
  const commitment = await db.givingCommitment.create({
    data: {
      orgId: user.orgId, personId: user.personId, commitmentType: type,
      percent, fixedAmountCents, frequency, startedOn: new Date(),
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "commitment.set", entityType: "giving_commitment", entityId: commitment.id,
    before: previous ? { type: previous.commitmentType, percent: previous.percent, fixedAmountCents: previous.fixedAmountCents } : undefined,
    after: { type, percent, fixedAmountCents, frequency }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return getMyCommitment(user);
}

export async function removeMyCommitment(user: SessionUser, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.give")) throw forbidden("You do not have permission to manage your commitment.");
  const previous = await db.givingCommitment.findFirst({
    where: { orgId: user.orgId, personId: user.personId ?? "__none__", endedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!previous) return { ok: true };
  await db.givingCommitment.update({ where: { id: previous.id }, data: { endedAt: new Date() } });
  await audit({
    orgId: user.orgId, actor: user, action: "commitment.remove", entityType: "giving_commitment", entityId: previous.id,
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ═══════════════════ STRIPE SETUP-INTENT + WEBHOOK (system context) ═════════

/**
 * Create a Stripe SetupIntent for saving a NEW payment method. Demo mode
 * returns mode:"demo" so the client renders its token stand-in form instead.
 */
export async function createMySetupIntent(user: SessionUser) {
  if (!can(user, "giving.give")) throw forbidden("You do not have permission to manage payment methods.");
  if (!user.personId) throw forbidden("Your account is not linked to a people record.");
  if (!stripeEnabled()) return { mode: "demo" as const };
  const stripe = await getStripe();
  const personRow = await db.person.findUnique({ where: { id: user.personId }, select: { id: true, firstName: true, lastName: true, email: true } });
  const person = personRow ? { id: personRow.id, name: `${personRow.firstName} ${personRow.lastName}`.trim(), email: personRow.email } : { id: user.personId, name: null, email: null };
  const last = await db.paymentMethod.findFirst({
    where: { orgId: user.orgId, personId: user.personId, provider: "stripe", providerCustomerId: { not: null } },
    orderBy: { isDefault: "desc" },
    select: { providerCustomerId: true },
  });
  const customerId = await ensureCustomer(stripe, last?.providerCustomerId ?? null, person);
  const { clientSecret } = await createSetupIntent(customerId);
  return { mode: "stripe" as const, customerId, clientSecret };
}

/**
 * Save a Stripe-confirmed token (pm_…) as a payment method. Called AFTER the
 * browser SetupIntent confirmation — only the token and Stripe-reported display
 * metadata reach this server (brand/last4/exp are read FROM Stripe, never from
 * the client).
 */
export async function addStripePaymentMethod(
  user: SessionUser,
  input: { providerMethodId?: string },
  meta: { ip?: string; userAgent?: string },
) {
  if (!can(user, "giving.give")) throw forbidden("You do not have permission to manage payment methods.");
  if (!user.personId) throw forbidden("Your account is not linked to a people record.");
  const pmId = String(input?.providerMethodId ?? "").trim();
  if (!pmId.startsWith("pm_")) throw badRequest("A Stripe payment method token (pm_…) is required.");
  const stripe = await getStripe();
  const personRow = await db.person.findUnique({ where: { id: user.personId }, select: { id: true, firstName: true, lastName: true, email: true } });
  const person = personRow ? { id: personRow.id, name: `${personRow.firstName} ${personRow.lastName}`.trim(), email: personRow.email } : { id: user.personId, name: null, email: null };
  const last = await db.paymentMethod.findFirst({
    where: { orgId: user.orgId, personId: user.personId, provider: "stripe", providerCustomerId: { not: null } },
    orderBy: { isDefault: "desc" },
    select: { providerCustomerId: true },
  });
  const customerId = await ensureCustomer(stripe, last?.providerCustomerId ?? null, person);
  const described = await attachAndDescribeMethod(stripe, pmId, customerId);
  const count = await db.paymentMethod.count({ where: { orgId: user.orgId, personId: user.personId, status: "active" } });
  const makeDefault = count === 0;
  if (makeDefault) {
    await db.paymentMethod.updateMany({ where: { orgId: user.orgId, personId: user.personId, status: "active" }, data: { isDefault: false } });
  }
  const pm = await db.paymentMethod.create({
    data: {
      orgId: user.orgId, personId: user.personId, provider: "stripe",
      providerMethodId: pmId, providerCustomerId: customerId,
      type: described.type, brand: described.brand, last4: described.last4,
      expMonth: described.expMonth, expYear: described.expYear, isDefault: makeDefault,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "payment_method.add", entityType: "payment_method", entityId: pm.id,
    after: { type: described.type, brand: described.brand, last4: described.last4, provider: "stripe" }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return toPaymentMethodDTO(pm);
}

/**
 * Stripe webhook handler — receives a VERIFIED event (signature checked in
 * the provider) and settles or fails the matching online payment.
 *  • payment_intent.succeeded  → settleOnlinePayment (donation + GL + audit)
 *  • payment_intent.payment_failed → mark failed; ledger untouched
 * Unknown events are acknowledged (200) and ignored.
 */
export async function handleStripeEvent(event: { type: string; data: { object: { id: string; last_payment_error?: { message?: string } | null } } }) {
  const intent = event.data?.object;
  if (!intent?.id) return { received: true, handled: false };
  if (event.type === "payment_intent.succeeded") {
    const op = await db.onlinePayment.findUnique({ where: { providerIntentId: intent.id } });
    if (!op) return { received: true, handled: false };
    if (op.status === "processing") await settleOnlinePayment(op.id);
    return { received: true, handled: true };
  }
  if (event.type === "payment_intent.payment_failed") {
    const op = await db.onlinePayment.findUnique({ where: { providerIntentId: intent.id } });
    if (op && op.status === "processing") {
      await db.onlinePayment.update({
        where: { id: op.id },
        data: { status: "failed", failureReason: intent.last_payment_error?.message?.slice(0, 400) ?? "Payment failed at the processor." },
      });
      await audit({
        orgId: op.orgId, actorType: "system", action: "gift.failed", entityType: "online_payment", entityId: op.id,
        after: { provider: "stripe", reason: intent.last_payment_error?.message ?? null },
      });
    }
    return { received: true, handled: true };
  }
  return { received: true, handled: false };
}

// ── usher/accountant verification workflow (Giving↔GL gate) ──────────────────
// Physical offerings and member-claimed transfers start as `draft` /
// `pending_verification` and ONLY hit the GL when an accountant with
// giving.verify.accountant (or accounting.manage) approves & posts.

/** Verification queue — usher_verified batches + pending_verification gifts. */
export async function listVerificationQueue(user: SessionUser) {
  if (!can(user, "giving.verify.accountant") && !can(user, "accounting.manage")) {
    throw forbidden("Requires giving.verify.accountant or accounting.manage permission.");
  }
  const batches = await db.batch.findMany({
    where: { orgId: user.orgId, verificationStatus: { in: ["draft", "usher_verified", "rejected"] } },
    orderBy: { serviceDate: "desc" },
    take: 100,
  });
  const batchIds = batches.map((b) => b.id);
  const donations = batchIds.length
    ? await db.donation.findMany({
        where: { orgId: user.orgId, batchId: { in: batchIds } },
        select: { batchId: true, amountCents: true, status: true, verificationStatus: true },
      })
    : [];
  const agg: Record<string, { count: number; amountCents: number }> = {};
  for (const d of donations) {
    if (!d.batchId) continue;
    agg[d.batchId] ??= { count: 0, amountCents: 0 };
    agg[d.batchId].count += 1;
    agg[d.batchId].amountCents += d.amountCents;
  }
  // individual pending gifts (bank transfers / online claims awaiting verification)
  const pendingGifts = await db.donation.findMany({
    where: { orgId: user.orgId, batchId: null, status: "pending", verificationStatus: "pending_verification" },
    orderBy: { receivedOn: "desc" },
    take: 50,
    include: { splits: true },
  });
  const ctx = await donationMapContext(pendingGifts);
  return {
    batches: batches.map((b) => {
      let methods: { method: string; amountCents: number }[] = [];
      try {
        const parsed = b.denominationsJson ? JSON.parse(b.denominationsJson) : null;
        if (Array.isArray(parsed?.methods)) methods = parsed.methods;
      } catch { /* legacy flat denomination map — no method split */ }
      return {
        id: b.id, name: b.name, serviceDate: b.serviceDate, status: b.status,
        verificationStatus: b.verificationStatus, serviceName: b.serviceName,
        countedByOne: b.countedByOne, countedByTwo: b.countedByTwo,
        verifiedByUsherId: b.verifiedByUsherId, verifiedByUsherAt: b.verifiedByUsherAt,
        rejectionNote: b.rejectionNote,
        methods,
        donationCount: agg[b.id]?.count ?? 0,
        totalCents: agg[b.id]?.amountCents ?? 0,
      };
    }),
    pendingGifts: pendingGifts.map((d) => toDonationDTO(d, ctx)),
  };
}

/** Usher / head-usher sign-off on a count sheet (two-person: recorded-by + verified-by). */
export async function verifyUsherBatch(user: SessionUser, batchId: string, input: { countedByOne?: string; denominationsJson?: string }, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.verify.usher") && !can(user, "giving.batches.manage")) {
    throw forbidden("Requires giving.verify.usher permission.");
  }
  const batch = await db.batch.findFirst({ where: { id: batchId, orgId: user.orgId } });
  if (!batch) throw notFound("Batch not found.");
  if (batch.verificationStatus === "accountant_verified") throw conflict("This batch is already posted to the GL.");
  const countedByOne = input.countedByOne?.trim() || user.name;
  const updated = await db.batch.update({
    where: { id: batch.id },
    data: {
      verificationStatus: "usher_verified",
      countedByOne,
      countedByTwo: user.name,
      verifiedByUsherId: user.membershipId,
      verifiedByUsherAt: new Date(),
      denominationsJson: input.denominationsJson ?? batch.denominationsJson,
      rejectionNote: null,
    },
  });
  // mark the batch's donations as usher_verified (still pending status)
  await db.donation.updateMany({
    where: { batchId: batch.id, orgId: user.orgId, status: "pending" },
    data: { verificationStatus: "usher_verified", verifiedByUsherId: user.membershipId, verifiedByUsherAt: new Date() },
  });
  await audit({ orgId: user.orgId, actor: user, action: "batch.usher_verify", entityType: "batch", entityId: batch.id, after: { countedByOne, countedByTwo: user.name }, ip: meta.ip, userAgent: meta.userAgent });
  // quick heads-up to finance: the sheet is in their approval queue now
  try {
    const recipients = await financeApproverIds(user.orgId, user.userId);
    await pushNotifications({
      orgId: user.orgId,
      userIds: recipients,
      module: "giving",
      type: "giving.sheet.submitted",
      title: "Count sheet awaiting finance approval",
      body: `${updated.serviceName ?? updated.name} · ${sheetDay(updated.serviceDate)} — ${naira(updated.totalCents)} counted by ${countedByOne} & signed off by ${user.name}.`,
      entityType: "batch",
      entityId: batch.id,
      linkModule: "accounting",
    });
  } catch {
    // notification is best-effort — never block the submission
  }
  return toBatchDTO(updated, 0, 0);
}

/** Accountant approves & posts a verified batch to the GL (atomic status + JE). */
export async function approveBatchToGL(user: SessionUser, batchId: string, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.verify.accountant") && !can(user, "accounting.manage")) {
    throw forbidden("Requires giving.verify.accountant or accounting.manage permission.");
  }
  const batch = await db.batch.findFirst({ where: { id: batchId, orgId: user.orgId } });
  if (!batch) throw notFound("Batch not found.");
  if (batch.verificationStatus !== "usher_verified") {
    throw badRequest("Only usher-verified batches can be approved & posted to the GL.");
  }
  if (batch.status === "posted") throw conflict("This batch is already posted.");
  const donations = await db.donation.findMany({
    where: { batchId: batch.id, orgId: user.orgId },
    select: { id: true, amountCents: true, status: true },
  });
  const issues = donations.filter((d) => d.status === "failed");
  if (issues.length) throw badRequest(`Batch has ${issues.length} donation(s) with issues — resolve them before posting.`);

  // atomic-ish: mark posted + accountant_verified, then journal each gift.
  // A gift whose JE fails is rolled back to pending so no posted gift ever
  // lacks a ledger entry — every transaction must reach the GL.
  await db.donation.updateMany({ where: { batchId: batch.id, status: "pending" }, data: { status: "posted", verificationStatus: "accountant_verified", verifiedByAccountantId: user.membershipId, verifiedByAccountantAt: new Date() } });
  const postedIds = await db.donation.findMany({ where: { batchId: batch.id, status: "posted" }, select: { id: true } });
  const failed: string[] = [];
  for (const d of postedIds) {
    try {
      await journalDonation(user, d.id);
    } catch {
      // roll this gift back to pending — accountant can retry after fixing the cause
      await db.donation.update({ where: { id: d.id }, data: { status: "pending", verificationStatus: "usher_verified", verifiedByAccountantId: null, verifiedByAccountantAt: null } });
      failed.push(d.id);
    }
  }
  if (failed.length) {
    throw badRequest(`${failed.length} gift(s) could not be journalled (missing fund/GL mapping) — they were rolled back to pending. Fix the fund → GL mapping and retry; previously posted gifts keep their entries.`);
  }
  const totalCents = donations.reduce((a, d) => a + d.amountCents, 0);
  const updated = await db.batch.update({
    where: { id: batch.id },
    data: {
      status: "posted",
      verificationStatus: "accountant_verified",
      verifiedByAccountantId: user.membershipId,
      verifiedByAccountantAt: new Date(),
      postedByName: user.name,
      postedAt: new Date(),
      totalCents,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "batch.approve_gl", entityType: "batch", entityId: batch.id,
    before: { verificationStatus: "usher_verified", status: "open" },
    after: { verificationStatus: "accountant_verified", status: "posted", totalCents, donationCount: donations.length, accountant: user.name },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  // close the loop: tell the usher their sheet was approved & posted
  try {
    const usherUserId = await userIdForMembership(batch.verifiedByUsherId);
    if (usherUserId && usherUserId !== user.userId) {
      await pushNotifications({
        orgId: user.orgId,
        userIds: [usherUserId],
        module: "giving",
        type: "giving.sheet.approved",
        title: "Count sheet approved & posted",
        body: `${batch.serviceName ?? batch.name} · ${sheetDay(batch.serviceDate)} — ${naira(totalCents)} approved by ${user.name} and posted to the GL.`,
        entityType: "batch",
        entityId: batch.id,
        linkModule: "giving",
      });
    }
  } catch {
    // notification is best-effort — never block the posting
  }
  return toBatchDTO(updated, donations.length, 0);
}

/** Bulk approve several usher_verified batches at once. */
export async function approveBatchesToGL(user: SessionUser, batchIds: string[], meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.verify.accountant") && !can(user, "accounting.manage")) {
    throw forbidden("Requires giving.verify.accountant or accounting.manage permission.");
  }
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of batchIds) {
    try {
      await approveBatchToGL(user, id, meta);
      results.push({ id, ok: true });
    } catch (e: any) {
      results.push({ id, ok: false, error: e?.message ?? String(e) });
    }
  }
  await audit({ orgId: user.orgId, actor: user, action: "batch.approve_gl_bulk", entityType: "batch", after: { count: batchIds.length, succeeded: results.filter((r) => r.ok).length }, ip: meta.ip, userAgent: meta.userAgent });
  return { results };
}

/** Reject / return a batch to the usher queue with a mandatory query note. */
export async function rejectBatch(user: SessionUser, batchId: string, note: string, meta: { ip?: string; userAgent?: string }) {
  if (!can(user, "giving.verify.accountant") && !can(user, "accounting.manage")) {
    throw forbidden("Requires giving.verify.accountant or accounting.manage permission.");
  }
  if (!note?.trim()) throw badRequest("A query note is required to return a batch.");
  const batch = await db.batch.findFirst({ where: { id: batchId, orgId: user.orgId } });
  if (!batch) throw notFound("Batch not found.");
  if (batch.status === "posted") throw conflict("A posted batch cannot be returned — reverse the journal entry instead.");
  const updated = await db.batch.update({
    where: { id: batch.id },
    data: { verificationStatus: "rejected", rejectionNote: note.trim() },
  });
  await db.donation.updateMany({
    where: { batchId: batch.id, orgId: user.orgId, status: "pending" },
    data: { verificationStatus: "rejected", rejectionNote: note.trim() },
  });
  await audit({ orgId: user.orgId, actor: user, action: "batch.reject", entityType: "batch", entityId: batch.id, after: { note: note.trim() }, ip: meta.ip, userAgent: meta.userAgent });
  // close the loop: tell the usher the sheet was returned with a query
  try {
    const usherUserId = await userIdForMembership(batch.verifiedByUsherId);
    if (usherUserId && usherUserId !== user.userId) {
      await pushNotifications({
        orgId: user.orgId,
        userIds: [usherUserId],
        module: "giving",
        type: "giving.sheet.returned",
        title: "Count sheet returned with query",
        body: `${batch.serviceName ?? batch.name} · ${sheetDay(batch.serviceDate)} — ${user.name} needs a recount/fix: ${note.trim()}`,
        entityType: "batch",
        entityId: batch.id,
        linkModule: "giving",
      });
    }
  } catch {
    // notification is best-effort — never block the return
  }
  return toBatchDTO(updated, 0, 0);
}

// ── service offering count sheets (denomination breakdown) ───────────────────

const SERVICE_NAMES = ["1st Service", "2nd Service", "3rd Service", "Midweek Service", "Bible Study", "Prayer Meeting", "Vigil", "Revival", "Special"] as const;

/** Payment methods accepted on a service collection sheet (Nigerian church reality). */
export const COLLECTION_METHODS = ["cash", "cheque", "bank_transfer", "pos", "other"] as const;

export interface CollectionLineInput { fundId: string; method?: string; amountCents: number; reference?: string }

/** Normalise + validate the collection lines a usher submits. Throws on bad input. */
function parseCollectionLines(raw: unknown): { fundId: string; method: string; amountCents: number; reference: string | null }[] {
  if (!Array.isArray(raw)) return [];
  const out: { fundId: string; method: string; amountCents: number; reference: string | null }[] = [];
  for (const line of raw as CollectionLineInput[]) {
    const amount = Math.round(Number(line?.amountCents) || 0);
    if (amount <= 0) continue;
    if (!line?.fundId) throw badRequest("Every collection line needs a category (fund).");
    const method = String(line.method || "cash");
    if (!(COLLECTION_METHODS as readonly string[]).includes(method)) {
      throw badRequest(`Unknown payment method "${method}" — use cash, cheque, bank_transfer, pos or other.`);
    }
    out.push({ fundId: line.fundId, method, amountCents: amount, reference: line.reference?.trim() || null });
  }
  return out;
}

/** Build the { denominations, methods } JSON blob stored on Batch.denominationsJson. */
function buildSheetMetaJson(denominations: Record<string, number> | undefined, lines: { method: string; amountCents: number; reference: string | null }[]): string {
  const methodAgg = new Map<string, number>();
  for (const l of lines) methodAgg.set(l.method, (methodAgg.get(l.method) ?? 0) + l.amountCents);
  return JSON.stringify({
    ...(denominations ? { denominations } : {}),
    methods: [...methodAgg.entries()].map(([method, amountCents]) => ({ method, amountCents })),
  });
}

/** Create one pending donation per collection line (method split preserved end-to-end). */
async function createLineDonations(
  orgId: string, batchId: string, serviceDate: Date, userName: string,
  lines: { fundId: string; method: string; amountCents: number; reference: string | null }[],
) {
  for (const line of lines) {
    const donation = await db.donation.create({
      data: {
        orgId,
        batchId,
        amountCents: line.amountCents,
        method: line.method,
        status: "pending",
        receivedOn: serviceDate,
        source: "offering_count_sheet",
        verificationStatus: "draft",
        isAnonymous: true,
        memo: line.reference, // cheque number / transfer reference / POS slip
        createdByName: userName,
      },
    });
    await db.donationSplit.create({ data: { orgId, donationId: donation.id, fundId: line.fundId, amountCents: line.amountCents } });
  }
}

/** Create a service collection sheet (batch + payment-method split lines + cash denominations). */
export async function createOfferingCountSheet(
  user: SessionUser,
  input: {
    name?: string; serviceDate?: string; serviceName?: string; countedByOne?: string;
    denominations?: Record<string, number>;
    /** NEW: full split lines — one pending donation each, method preserved. */
    lines?: CollectionLineInput[];
    /** LEGACY: fund-only splits (all recorded as cash) — still accepted for compatibility. */
    categorySplits?: { fundId: string; amountCents: number }[];
    depositAccount?: string;
  },
  meta: { ip?: string; userAgent?: string },
) {
  if (!can(user, "giving.verify.usher") && !can(user, "giving.record")) {
    throw forbidden("Requires giving.verify.usher or giving.record permission.");
  }
  if (!input?.serviceDate) throw badRequest("serviceDate is required.");
  const serviceName = input.serviceName ?? "1st Service";
  if (!(SERVICE_NAMES as readonly string[]).includes(serviceName)) throw badRequest("Unknown service name.");
  const campusId = user.campusId || (await db.campus.findFirst({ where: { orgId: user.orgId }, select: { id: true } }))?.id;
  if (!campusId) throw badRequest("No campus available for this organization.");
  const lines = parseCollectionLines(input.lines ?? input.categorySplits ?? []);
  if (!lines.length) throw badRequest("Add at least one collection line (category + how it was collected + amount).");
  const fundIds = [...new Set(lines.map((l) => l.fundId))];
  const fundCount = await db.fund.count({ where: { orgId: user.orgId, id: { in: fundIds } } });
  if (fundCount !== fundIds.length) throw badRequest("One or more selected categories do not exist in this church.");
  const totalCents = lines.reduce((a, l) => a + l.amountCents, 0);
  const denominationsJson = buildSheetMetaJson(input.denominations, lines);
  const batchName = input.name?.trim() || `${serviceName} — ${input.serviceDate}`;
  const batch = await db.batch.create({
    data: {
      orgId: user.orgId,
      campusId,
      name: batchName,
      kind: "offering",
      serviceDate: new Date(input.serviceDate),
      depositAccount: input.depositAccount || undefined,
      verificationStatus: "draft",
      serviceName,
      denominationsJson,
      countedByOne: input.countedByOne?.trim() || user.name,
      totalCents,
    },
  });
  await createLineDonations(user.orgId, batch.id, new Date(input.serviceDate), user.name, lines);
  await audit({
    orgId: user.orgId, actor: user, action: "count_sheet.create", entityType: "batch", entityId: batch.id,
    after: { name: batch.name, serviceName, totalCents, lineCount: lines.length, methods: [...new Set(lines.map((l) => l.method))] },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return toBatchDTO(batch, lines.length, lines.length);
}

/**
 * Edit a service collection sheet that has NOT reached finance yet
 * (draft or returned-with-query). Replaces the lines atomically — the old
 * pending draft donations are removed and recreated from the new lines, so
 * the finance queue always sees exactly what the usher last counted.
 */
export async function updateOfferingCountSheet(
  user: SessionUser,
  batchId: string,
  input: { lines?: CollectionLineInput[]; denominations?: Record<string, number>; countedByOne?: string; serviceName?: string; serviceDate?: string },
  meta: { ip?: string; userAgent?: string },
) {
  if (!can(user, "giving.verify.usher") && !can(user, "giving.record")) {
    throw forbidden("Requires giving.verify.usher or giving.record permission.");
  }
  const batch = await db.batch.findFirst({ where: { id: batchId, orgId: user.orgId } });
  if (!batch) throw notFound("Collection sheet not found.");
  if (batch.status === "posted") throw conflict("This collection is already posted to the GL — it can no longer be edited.");
  if (batch.verificationStatus === "usher_verified") throw conflict("Already signed & sent to finance — ask finance to return it with a query before editing.");
  const lines = parseCollectionLines(input.lines ?? []);
  if (!lines.length) throw badRequest("Add at least one collection line (category + how it was collected + amount).");
  const fundIds = [...new Set(lines.map((l) => l.fundId))];
  const fundCount = await db.fund.count({ where: { orgId: user.orgId, id: { in: fundIds } } });
  if (fundCount !== fundIds.length) throw badRequest("One or more selected categories do not exist in this church.");
  const totalCents = lines.reduce((a, l) => a + l.amountCents, 0);
  const serviceDate = input.serviceDate ? new Date(input.serviceDate) : batch.serviceDate;
  const serviceName = input.serviceName && (SERVICE_NAMES as readonly string[]).includes(input.serviceName) ? input.serviceName : batch.serviceName;
  await db.$transaction(async (tx) => {
    await tx.donation.deleteMany({ where: { batchId: batch.id, orgId: user.orgId, status: "pending", source: "offering_count_sheet" } });
    await tx.batch.update({
      where: { id: batch.id },
      data: {
        totalCents,
        denominationsJson: buildSheetMetaJson(input.denominations, lines),
        countedByOne: input.countedByOne?.trim() || batch.countedByOne,
        serviceDate,
        serviceName,
        // editing clears a prior rejection — the usher addressed the query
        rejectionNote: null,
        verificationStatus: "draft",
      },
    });
  });
  await createLineDonations(user.orgId, batch.id, serviceDate, user.name, lines);
  await audit({
    orgId: user.orgId, actor: user, action: "count_sheet.update", entityType: "batch", entityId: batch.id,
    before: { totalCents: batch.totalCents }, after: { totalCents, lineCount: lines.length, methods: [...new Set(lines.map((l) => l.method))] },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return toBatchDTO(await db.batch.findUnique({ where: { id: batch.id } }), lines.length, lines.length);
}

/** List service collection sheets with their payment-method split + line detail. */
export async function listOfferingCountSheets(user: SessionUser) {
  if (!can(user, "giving.view.all") && !can(user, "giving.verify.usher")) {
    throw forbidden("Requires giving.view.all or giving.verify.usher permission.");
  }
  const batches = await db.batch.findMany({
    where: { orgId: user.orgId, kind: "offering", serviceName: { not: null } },
    orderBy: { serviceDate: "desc" },
    take: 100,
  });
  const sheetDonations = batches.length
    ? await db.donation.findMany({
        where: { orgId: user.orgId, batchId: { in: batches.map((b) => b.id) }, source: "offering_count_sheet" },
        include: { splits: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const fundIds = [...new Set(sheetDonations.flatMap((d) => d.splits.map((s) => s.fundId)))];
  const funds = fundIds.length ? await db.fund.findMany({ where: { orgId: user.orgId, id: { in: fundIds } }, select: { id: true, name: true } }) : [];
  const fundNames = new Map(funds.map((f) => [f.id, f.name] as const));
  const byBatch = new Map<string, typeof sheetDonations>();
  for (const d of sheetDonations) {
    if (!d.batchId) continue;
    const list = byBatch.get(d.batchId) ?? [];
    list.push(d);
    byBatch.set(d.batchId, list);
  }
  return {
    items: batches.map((b) => {
      const donations = byBatch.get(b.id) ?? [];
      const meta = safeParseSheetMeta(b.denominationsJson);
      return {
        id: b.id, name: b.name, serviceDate: b.serviceDate, serviceName: b.serviceName,
        status: b.status, verificationStatus: b.verificationStatus, totalCents: b.totalCents,
        countedByOne: b.countedByOne, countedByTwo: b.countedByTwo,
        verifiedByUsherAt: b.verifiedByUsherAt, verifiedByAccountantAt: b.verifiedByAccountantAt,
        postedAt: b.postedAt, postedByName: b.postedByName,
        rejectionNote: b.rejectionNote,
        methods: meta.methods,
        denominations: meta.denominations,
        lines: donations.map((d) => ({
          id: d.id,
          method: d.method,
          amountCents: d.amountCents,
          reference: d.memo,
          status: d.status,
          fundId: d.splits[0]?.fundId ?? null,
          fundName: d.splits[0] ? fundNames.get(d.splits[0].fundId) ?? "Unknown" : null,
        })),
      };
    }),
  };
}

/** Parse the sheet meta JSON — legacy flat denomination maps still read fine. */
function safeParseSheetMeta(raw: string | null): { methods: { method: string; amountCents: number }[]; denominations: Record<string, number> | null } {
  if (!raw) return { methods: [], denominations: null };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.methods)) return { methods: parsed.methods, denominations: parsed.denominations ?? null };
    // legacy shape: flat {n1000: kobo, ...} denomination map — no method split recorded
    return { methods: [], denominations: parsed ?? null };
  } catch {
    return { methods: [], denominations: null };
  }
}
