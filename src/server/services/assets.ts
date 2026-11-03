import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, conflict, forbidden, notFound } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { createJournalEntry, ensureChartOfAccounts } from "@/server/services/accounting";

/**
 * Assets & Facilities service (backend only).
 * Tenant-scoped asset register + maintenance log + booking workflow.
 * Amounts are integer kobo. Every mutation is audited (F rule 6) and every
 * handler re-checks the module ladder server-side — hiding buttons is not
 * authorization (04-architecture §3.8).
 *
 * GL integration (double-entry, see services/accounting.ts):
 *  • acquisition  → Dr Fixed Asset (by category) / Cr cash, posted from the
 *    recorded purchase cost; idempotent per asset via JournalEntry
 *    unique(orgId, sourceType, sourceId) with sourceType "asset_acquisition".
 *  • disposal     → Dr Cash(proceeds) + Dr Loss on Disposal(NBV−proceeds) =
 *    Cr Fixed Asset(NBV) + Cr Gain on Disposal(proceeds−NBV), sourceType
 *    "asset_disposal". NBV = current value ?? purchase cost.
 *  • assets with posted journals cannot be deleted — reverse in the GL instead.
 */

export const ASSET_CATEGORIES = ["equipment", "instrument", "furniture", "vehicle", "building", "it"] as const;
export const ASSET_CONDITIONS = ["good", "fair", "damaged", "unserviceable"] as const;
export const ASSET_STATUSES = ["active", "in_maintenance", "retired", "disposed"] as const;
const BOOKING_ACTIVE = ["pending", "approved"];

// GL source types for asset postings (JournalEntry.sourceType) and the
// balance account per asset category group (chart codes 1500–1530).
const GL_ACQUISITION = "asset_acquisition";
const GL_DISPOSAL = "asset_disposal";
const ASSET_GL_ACCOUNT: Record<string, string> = {
  equipment: "1500", instrument: "1500",
  furniture: "1510", it: "1510",
  vehicle: "1520",
  building: "1530",
};
function assetGlAccountCode(category: string): string {
  return ASSET_GL_ACCOUNT[category] ?? "1500";
}

type Meta = { ip?: string; userAgent?: string };

// ── validation helpers ───────────────────────────────────────────────────────

function oneOf(value: unknown, allowed: readonly string[], label: string): string {
  const v = String(value ?? "");
  if (!allowed.includes(v)) throw badRequest(`${label} must be one of: ${allowed.join(", ")}.`);
  return v;
}

function optionalCents(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) throw badRequest(`${label} must be a non-negative amount.`);
  return n;
}

function optionalText(value: unknown, max = 240): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > max) throw badRequest(`Text is too long (max ${max} characters).`);
  return s;
}

function parseDate(value: unknown, label: string): Date {
  const d = new Date(String(value ?? ""));
  if (Number.isNaN(d.getTime())) throw badRequest(`${label} is not a valid date.`);
  return d;
}

function requireId(user: SessionUser, id: string | undefined, label = "Asset") {
  if (!id) throw badRequest(`${label} id is required.`);
  // light format guard — cuids are 25 chars, but stay permissive for tests
  if (id.length < 6) throw notFound(`${label} not found.`);
  void user;
}

// ── register ─────────────────────────────────────────────────────────────────

export async function listAssets(
  user: SessionUser,
  q: { q?: string; category?: string; condition?: string; status?: string; page?: string; pageSize?: string }
) {
  const where: any = { orgId: user.orgId };
  const search = q.q?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { tag: { contains: search } },
      { location: { contains: search } },
      { custodianName: { contains: search } },
      { serialNumber: { contains: search } },
    ];
  }
  if (q.category) where.category = oneOf(q.category, ASSET_CATEGORIES, "Category");
  if (q.condition) where.condition = oneOf(q.condition, ASSET_CONDITIONS, "Condition");
  if (q.status) where.status = oneOf(q.status, ASSET_STATUSES, "Status");

  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 100) || 100));

  const [total, items, all] = await Promise.all([
    db.asset.count({ where }),
    db.asset.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.asset.findMany({
      where: { orgId: user.orgId },
      select: { category: true, condition: true, status: true, currentValueCents: true, purchaseCostCents: true },
    }),
  ]);

  // which listed assets already have a live (unreversed) acquisition posting?
  const postedSet = new Set(
    items.length
      ? await db.journalEntry.findMany({
          where: { orgId: user.orgId, sourceType: GL_ACQUISITION, sourceId: { in: items.map((i) => i.id) }, reversedByEntryId: null },
          select: { sourceId: true },
        }).then((es) => es.map((e) => e.sourceId))
      : []
  );

  const byCategory: Record<string, number> = {};
  const byCondition: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let totalValueCents = 0;
  for (const a of all) {
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
    byCondition[a.condition] = (byCondition[a.condition] ?? 0) + 1;
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    totalValueCents += a.currentValueCents ?? a.purchaseCostCents ?? 0;
  }
  const needsAttention = all.filter((a) => a.condition === "damaged" || a.condition === "unserviceable" || a.status === "in_maintenance").length;

  return {
    items: items.map((a) => toAssetDTO(a, postedSet.has(a.id))),
    total,
    page,
    pageSize,
    stats: { total: all.length, totalValueCents, byCategory, byCondition, byStatus, needsAttention },
  };
}

function toAssetDTO(a: {
  id: string; tag: string | null; name: string; category: string; location: string | null;
  custodianName: string | null; condition: string; status: string; serialNumber: string | null;
  purchaseCostCents: number | null; currentValueCents: number | null; acquiredAt: Date | null;
  notes: string | null; createdByName: string | null; createdAt: Date; updatedAt: Date;
  disposedAt?: Date | null; disposalProceedsCents?: number | null; disposalBookValueCents?: number | null;
  disposedByName?: string | null; disposalNotes?: string | null;
}, acquisitionPosted?: boolean) {
  return {
    id: a.id,
    tag: a.tag,
    name: a.name,
    category: a.category,
    location: a.location,
    custodianName: a.custodianName,
    condition: a.condition,
    status: a.status,
    serialNumber: a.serialNumber,
    purchaseCostCents: a.purchaseCostCents,
    currentValueCents: a.currentValueCents,
    acquiredAt: a.acquiredAt ? a.acquiredAt.toISOString() : null,
    notes: a.notes,
    createdByName: a.createdByName,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    disposedAt: a.disposedAt ? a.disposedAt.toISOString() : null,
    disposalProceedsCents: a.disposalProceedsCents ?? null,
    disposalBookValueCents: a.disposalBookValueCents ?? null,
    disposedByName: a.disposedByName ?? null,
    disposalNotes: a.disposalNotes ?? null,
    acquisitionPosted: acquisitionPosted ?? false,
  };
}

/** Journal-entry DTO for the asset detail drawer (acquisition / disposal). */
function toGlEntryDTO(e: {
  id: string; reference: string | null; entryDate: Date; memo: string | null; reversedByEntryId: string | null;
  lines: { debitCents: number; creditCents: number; account: { code: string; name: string } | null }[];
}) {
  const lines = e.lines
    .map((l) => ({
      accountCode: l.account?.code ?? "?",
      accountName: l.account?.name ?? "Unknown account",
      debitCents: l.debitCents,
      creditCents: l.creditCents,
    }))
    // debits first, largest first — reads like a proper journal
    .sort((x, y) => (y.debitCents - x.debitCents) || (y.creditCents - x.creditCents));
  return {
    entryId: e.id,
    reference: e.reference,
    entryDate: e.entryDate.toISOString(),
    memo: e.memo,
    reversed: !!e.reversedByEntryId,
    lines,
  };
}

/** Both asset GL postings for one asset (acquisition + disposal), if any. */
async function assetGlEntries(orgId: string, assetId: string) {
  const entries = await db.journalEntry.findMany({
    where: { orgId, sourceType: { in: [GL_ACQUISITION, GL_DISPOSAL] }, sourceId: assetId },
    include: { lines: true },
  });
  if (!entries.length) return { acquisition: null, disposal: null };
  // JournalLine stores accountId only — resolve account labels in one query
  const accountIds = [...new Set(entries.flatMap((e) => e.lines.map((l) => l.accountId)))];
  const accounts = await db.account.findMany({ where: { orgId, id: { in: accountIds } }, select: { id: true, code: true, name: true } });
  const acctMap = new Map(accounts.map((a) => [a.id, a] as const));
  const pick = (t: string) => entries.filter((e) => e.sourceType === t).sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime())[0];
  const toDTO = (e: NonNullable<ReturnType<typeof pick>>) => toGlEntryDTO({
    id: e.id,
    reference: e.reference,
    entryDate: e.entryDate,
    memo: e.memo,
    reversedByEntryId: e.reversedByEntryId,
    lines: e.lines.map((l) => ({
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      account: acctMap.get(l.accountId) ?? null,
    })),
  });
  const acq = pick(GL_ACQUISITION);
  const dis = pick(GL_DISPOSAL);
  return {
    acquisition: acq ? toDTO(acq) : null,
    disposal: dis ? toDTO(dis) : null,
  };
}

export async function getAsset(user: SessionUser, id: string) {
  requireId(user, id);
  const asset = await db.asset.findFirst({ where: { id, orgId: user.orgId } });
  if (!asset) throw notFound("Asset not found.");
  const [maintenance, bookings, gl] = await Promise.all([
    db.assetMaintenanceLog.findMany({
      where: { orgId: user.orgId, assetId: id },
      orderBy: { servicedOn: "desc" },
      take: 50,
    }),
    db.assetBooking.findMany({
      where: { orgId: user.orgId, assetId: id },
      orderBy: { startAt: "desc" },
      take: 20,
    }),
    assetGlEntries(user.orgId, asset.id),
  ]);
  return {
    asset: toAssetDTO(asset, !!gl.acquisition && !gl.acquisition.reversed),
    maintenance: maintenance.map((m) => ({
      id: m.id,
      servicedOn: m.servicedOn.toISOString(),
      description: m.description,
      vendorName: m.vendorName,
      costCents: m.costCents,
      performedByName: m.performedByName,
    })),
    bookings: bookings.map((b) => ({
      id: b.id,
      title: b.title,
      requesterName: b.requesterName,
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      status: b.status,
    })),
    gl,
  };
}

// ── GL posting: acquisition & disposal ─────────────────────────────────────

/** The cash/bank GL account used as the contra side — must be an asset account in this org. */
async function resolveCashAccount(orgId: string, code: string | undefined, label: string) {
  // the chart is lazy-seeded on first accounting use — make sure it exists
  // before resolving codes, or a brand-new org would 400 here
  await ensureChartOfAccounts(orgId);
  const acct = await db.account.findFirst({ where: { orgId, code: code || "1000" } });
  if (!acct) throw badRequest(`GL account ${code || "1000"} was not found in the chart of accounts.`);
  if (acct.type !== "asset") throw badRequest(`${label} must be an asset (cash/bank) account — "${acct.name}" is a ${acct.type} account.`);
  return acct;
}

/**
 * Post the acquisition journal: Dr Fixed Asset (category) / Cr cash.
 * Idempotent — reposting an already-posted asset returns the existing entry.
 * Amounts come from the asset record itself; no free-form amounts here.
 */
export async function postAcquisitionToGl(
  user: SessionUser, id: string,
  input: { creditAccountCode?: string },
  meta: Meta,
) {
  requireId(user, id);
  const asset = await db.asset.findFirst({ where: { id, orgId: user.orgId } });
  if (!asset) throw notFound("Asset not found.");
  const cost = asset.purchaseCostCents ?? 0;
  if (asset.status === "disposed") throw conflict("A disposed asset cannot post an acquisition — the disposal entry already removed it from the books.");
  if (cost <= 0) throw badRequest("Record a purchase cost on this asset before posting it to the GL.");

  const existing = await db.journalEntry.findFirst({
    where: { orgId: user.orgId, sourceType: GL_ACQUISITION, sourceId: asset.id, reversedByEntryId: null },
  });
  if (existing) {
    return { id: existing.id, reference: existing.reference, alreadyPosted: true };
  }

  const cash = await resolveCashAccount(user.orgId, input?.creditAccountCode, "The acquisition contra account");
  const entry = await createJournalEntry(user, {
    entryDate: asset.acquiredAt ?? new Date(),
    memo: `Asset acquisition — ${asset.name}${asset.tag ? ` (${asset.tag})` : ""}`,
    sourceType: GL_ACQUISITION,
    sourceId: asset.id,
    lines: [
      { accountCode: assetGlAccountCode(asset.category), debitCents: cost },
      { accountId: cash.id, creditCents: cost },
    ],
  });
  await audit({
    orgId: user.orgId, actor: user, action: "asset.gl.acquisition", entityType: "asset", entityId: asset.id,
    after: { journalEntryId: entry.id, reference: entry.reference, costCents: cost, category: asset.category },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: entry.id, reference: entry.reference, alreadyPosted: false };
}

/**
 * Dispose an asset and post the double-entry disposal journal:
 *   Dr Cash (proceeds) + Dr Loss 5900 (NBV − proceeds)
 *   = Cr Fixed Asset (NBV) + Cr Gain 4600 (proceeds − NBV)
 * NBV = current value ?? purchase cost. With NBV = proceeds = 0 the asset is
 * simply written off with no journal. Future/pending bookings are cancelled.
 */
export async function disposeAsset(
  user: SessionUser, id: string,
  input: { disposalDate?: string; proceedsCents?: number | null; notes?: string | null; cashAccountCode?: string },
  meta: Meta,
) {
  requireId(user, id);
  const asset = await db.asset.findFirst({ where: { id, orgId: user.orgId } });
  if (!asset) throw notFound("Asset not found.");
  if (asset.status === "disposed") throw conflict("This asset is already disposed.");

  const disposalDate = input?.disposalDate ? parseDate(input.disposalDate, "Disposal date") : new Date();
  const proceeds = Math.max(0, Math.round(Number(input?.proceedsCents ?? 0)) || 0);
  const notes = optionalText(input?.notes, 1000);
  const nbv = asset.currentValueCents ?? asset.purchaseCostCents ?? 0;

  // double-entry disposal journal (only when money moves)
  let entry: { id: string; reference: string | null } | null = null;
  if (nbv > 0 || proceeds > 0) {
    const loss = Math.max(0, nbv - proceeds);
    const gain = Math.max(0, proceeds - nbv);
    const lines: { accountCode?: string; accountId?: string; debitCents?: number; creditCents?: number }[] = [];
    if (proceeds > 0) {
      const cash = await resolveCashAccount(user.orgId, input?.cashAccountCode, "The disposal proceeds account");
      lines.push({ accountId: cash.id, debitCents: proceeds });
    }
    if (loss > 0) lines.push({ accountCode: "5900", debitCents: loss });
    if (nbv > 0) lines.push({ accountCode: assetGlAccountCode(asset.category), creditCents: nbv });
    if (gain > 0) lines.push({ accountCode: "4600", creditCents: gain });
    const je = await createJournalEntry(user, {
      entryDate: disposalDate,
      memo: `Asset disposal — ${asset.name}${asset.tag ? ` (${asset.tag})` : ""}`,
      sourceType: GL_DISPOSAL,
      sourceId: asset.id,
      lines,
    });
    entry = { id: je.id, reference: je.reference };
  }

  const updated = await db.asset.update({
    where: { id: asset.id },
    data: {
      status: "disposed",
      disposedAt: disposalDate,
      disposalProceedsCents: proceeds,
      disposalBookValueCents: nbv,
      disposedByName: user.name,
      disposalNotes: notes,
    },
  });

  // a disposed asset keeps no live reservations
  const activeBookings = await db.assetBooking.findMany({
    where: { orgId: user.orgId, assetId: asset.id, status: { in: BOOKING_ACTIVE } },
    select: { id: true },
  });
  for (const b of activeBookings) {
    await db.assetBooking.update({
      where: { id: b.id },
      data: { status: "cancelled", decidedById: user.membershipId, decidedByName: user.name, decidedAt: new Date(), decisionNote: "Cancelled automatically — asset disposed." },
    });
  }

  await audit({
    orgId: user.orgId, actor: user, action: "asset.dispose", entityType: "asset", entityId: asset.id,
    before: { status: asset.status, currentValueCents: asset.currentValueCents },
    after: { status: "disposed", proceedsCents: proceeds, bookValueCents: nbv, journalEntryId: entry?.id ?? null, cancelledBookings: activeBookings.length },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  void updated;
  return { ok: true, journal: entry };
}

function assetInput(user: SessionUser, input: any, forCreate: boolean) {
  const name = String(input?.name ?? "").trim();
  if (name.length < 2 || name.length > 160) throw badRequest("Asset name must be 2–160 characters.");
  return {
    name,
    tag: optionalText(input?.tag, 60),
    category: input?.category !== undefined || forCreate
      ? oneOf(input?.category ?? "equipment", ASSET_CATEGORIES, "Category")
      : undefined,
    location: optionalText(input?.location, 160),
    custodianName: optionalText(input?.custodianName, 120),
    condition: input?.condition !== undefined || forCreate
      ? oneOf(input?.condition ?? "good", ASSET_CONDITIONS, "Condition")
      : undefined,
    status: input?.status !== undefined || forCreate
      ? oneOf(input?.status ?? "active", ASSET_STATUSES, "Status")
      : undefined,
    serialNumber: optionalText(input?.serialNumber, 120),
    purchaseCostCents: input?.purchaseCostCents !== undefined ? optionalCents(input.purchaseCostCents, "Purchase cost") : undefined,
    currentValueCents: input?.currentValueCents !== undefined ? optionalCents(input.currentValueCents, "Current value") : undefined,
    acquiredAt: input?.acquiredAt !== undefined
      ? (input.acquiredAt ? parseDate(input.acquiredAt, "Acquired date") : null)
      : undefined,
    notes: optionalText(input?.notes, 2000),
  };
}

export async function createAsset(user: SessionUser, input: any, meta: Meta) {
  const data = assetInput(user, input, true);
  const asset = await db.asset.create({
    data: { ...data, orgId: user.orgId, createdByName: user.name } as any,
  });
  await audit({
    orgId: user.orgId, actor: user, action: "asset.create", entityType: "asset", entityId: asset.id,
    after: { name: asset.name, category: asset.category, currentValueCents: asset.currentValueCents },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return toAssetDTO(asset);
}

export async function updateAsset(user: SessionUser, id: string, input: any, meta: Meta) {
  requireId(user, id);
  const existing = await db.asset.findFirst({ where: { id, orgId: user.orgId } });
  if (!existing) throw notFound("Asset not found.");
  const data = assetInput(user, input, false);
  const updated = await db.asset.update({ where: { id: existing.id }, data: data as any });
  await audit({
    orgId: user.orgId, actor: user, action: "asset.update", entityType: "asset", entityId: existing.id,
    before: { name: existing.name, condition: existing.condition, status: existing.status, currentValueCents: existing.currentValueCents },
    after: { name: updated.name, condition: updated.condition, status: updated.status, currentValueCents: updated.currentValueCents },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return toAssetDTO(updated);
}

export async function deleteAsset(user: SessionUser, id: string, meta: Meta) {
  requireId(user, id);
  const existing = await db.asset.findFirst({ where: { id, orgId: user.orgId } });
  if (!existing) throw notFound("Asset not found.");
  const activeBookings = await db.assetBooking.count({
    where: { orgId: user.orgId, assetId: id, status: { in: BOOKING_ACTIVE }, endAt: { gte: new Date() } },
  });
  if (activeBookings > 0) {
    throw conflict(`This asset has ${activeBookings} upcoming or pending booking(s). Cancel them before deleting the asset.`);
  }
  const glPostings = await db.journalEntry.count({
    where: { orgId: user.orgId, sourceType: { in: [GL_ACQUISITION, GL_DISPOSAL] }, sourceId: id },
  });
  if (glPostings > 0) {
    throw conflict(`This asset has ${glPostings} GL posting(s) and cannot be deleted — reverse the journal entries in Accounting instead so the books stay intact.`);
  }
  await db.asset.delete({ where: { id: existing.id } });
  await audit({
    orgId: user.orgId, actor: user, action: "asset.delete", entityType: "asset", entityId: existing.id,
    before: { name: existing.name, tag: existing.tag, category: existing.category },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ── maintenance log ──────────────────────────────────────────────────────────

export async function addMaintenance(user: SessionUser, assetId: string, input: any, meta: Meta) {
  requireId(user, assetId);
  const asset = await db.asset.findFirst({ where: { id: assetId, orgId: user.orgId } });
  if (!asset) throw notFound("Asset not found.");
  const description = String(input?.description ?? "").trim();
  if (description.length < 3 || description.length > 500) throw badRequest("Describe the work carried out (3–500 characters).");
  const entry = await db.assetMaintenanceLog.create({
    data: {
      orgId: user.orgId,
      assetId: asset.id,
      servicedOn: parseDate(input?.servicedOn ?? new Date().toISOString(), "Service date"),
      description,
      vendorName: optionalText(input?.vendorName, 120),
      costCents: optionalCents(input?.costCents, "Cost"),
      performedByName: optionalText(input?.performedByName, 120) ?? user.name,
    },
  });
  // putting an asset into maintenance flips its operational status
  if (input?.markInMaintenance && asset.status === "active") {
    await db.asset.update({ where: { id: asset.id }, data: { status: "in_maintenance" } });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "asset.maintenance.add", entityType: "asset", entityId: asset.id,
    after: { description: entry.description, servicedOn: entry.servicedOn, costCents: entry.costCents },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: entry.id, ok: true };
}

export async function deleteMaintenance(user: SessionUser, assetId: string, entryId: string, meta: Meta) {
  requireId(user, assetId);
  const entry = await db.assetMaintenanceLog.findFirst({ where: { id: entryId, orgId: user.orgId, assetId } });
  if (!entry) throw notFound("Maintenance entry not found.");
  await db.assetMaintenanceLog.delete({ where: { id: entry.id } });
  await audit({
    orgId: user.orgId, actor: user, action: "asset.maintenance.delete", entityType: "asset", entityId: assetId,
    before: { description: entry.description, servicedOn: entry.servicedOn },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ── bookings (request → approve/decline → cancel) ────────────────────────────

export async function listBookings(user: SessionUser, q: { status?: string; upcoming?: string }) {
  const where: any = { orgId: user.orgId };
  if (q.status) where.status = oneOf(q.status, ["pending", "approved", "declined", "cancelled"], "Status");
  if (q.upcoming === "1") where.endAt = { gte: new Date() };
  const items = await db.assetBooking.findMany({
    where,
    orderBy: { startAt: "desc" },
    take: 200,
    include: { asset: { select: { name: true, category: true, location: true } } },
  });
  return {
    items: items.map((b) => ({
      id: b.id,
      assetId: b.assetId,
      assetName: b.asset.name,
      assetLocation: b.asset.location,
      title: b.title,
      purpose: b.purpose,
      requesterId: b.requesterId,
      requesterName: b.requesterName,
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      status: b.status,
      decidedByName: b.decidedByName,
      decisionNote: b.decisionNote,
      mine: b.requesterId === user.membershipId,
    })),
    total: items.length,
  };
}

export async function createBooking(user: SessionUser, input: any, meta: Meta) {
  requireId(user, String(input?.assetId ?? ""), "Asset");
  const asset = await db.asset.findFirst({ where: { id: String(input.assetId), orgId: user.orgId } });
  if (!asset) throw notFound("Asset not found.");
  if (asset.status === "retired" || asset.status === "disposed") {
    throw conflict(`"${asset.name}" is ${asset.status.replace("_", " ")} and can no longer be booked.`);
  }
  const title = String(input?.title ?? "").trim();
  if (title.length < 3 || title.length > 160) throw badRequest("Booking title must be 3–160 characters.");
  const startAt = parseDate(input?.startAt, "Start time");
  const endAt = parseDate(input?.endAt, "End time");
  if (endAt <= startAt) throw badRequest("The end time must be after the start time.");

  const overlap = await db.assetBooking.findFirst({
    where: {
      orgId: user.orgId,
      assetId: asset.id,
      status: { in: BOOKING_ACTIVE },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { title: true, startAt: true },
  });
  if (overlap) {
    throw conflict(`"${asset.name}" is already booked for "${overlap.title}" in that window. Pick another time.`);
  }

  const booking = await db.assetBooking.create({
    data: {
      orgId: user.orgId,
      assetId: asset.id,
      title,
      purpose: optionalText(input?.purpose, 1000),
      requesterId: user.membershipId,
      requesterName: user.name,
      startAt,
      endAt,
      status: "pending",
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "asset.booking.request", entityType: "asset_booking", entityId: booking.id,
    after: { asset: asset.name, title, startAt, endAt },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: booking.id, ok: true };
}

async function getBooking(user: SessionUser, id: string) {
  const booking = await db.assetBooking.findFirst({
    where: { id, orgId: user.orgId },
    include: { asset: { select: { name: true } } },
  });
  if (!booking) throw notFound("Booking not found.");
  return booking;
}

export async function decideBooking(user: SessionUser, id: string, input: any, meta: Meta) {
  const decision = oneOf(input?.decision, ["approved", "declined"], "Decision");
  const booking = await getBooking(user, id);
  if (booking.status !== "pending") throw conflict(`This request was already ${booking.status}.`);
  if (decision === "approved" && !can(user, "assets.edit")) {
    throw forbidden('Approving bookings requires the "assets.edit" permission.');
  }
  const updated = await db.assetBooking.update({
    where: { id: booking.id },
    data: {
      status: decision,
      decidedById: user.membershipId,
      decidedByName: user.name,
      decidedAt: new Date(),
      decisionNote: optionalText(input?.note, 500),
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: `asset.booking.${decision}`, entityType: "asset_booking", entityId: booking.id,
    before: { status: booking.status }, after: { status: decision },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: updated.id, status: updated.status };
}

export async function cancelBooking(user: SessionUser, id: string, meta: Meta) {
  const booking = await getBooking(user, id);
  const isRequester = booking.requesterId === user.membershipId;
  if (!isRequester && !can(user, "assets.edit")) {
    throw forbidden("Only the requester or a facilities manager can cancel this booking.");
  }
  if (booking.status === "cancelled") throw conflict("This booking is already cancelled.");
  if (booking.status === "declined") throw conflict("Declined requests cannot be cancelled.");
  const updated = await db.assetBooking.update({
    where: { id: booking.id },
    data: { status: "cancelled", decidedById: user.membershipId, decidedByName: user.name, decidedAt: new Date() },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "asset.booking.cancel", entityType: "asset_booking", entityId: booking.id,
    before: { status: booking.status }, after: { status: "cancelled" },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: updated.id, status: updated.status };
}

export async function deleteBooking(user: SessionUser, id: string, meta: Meta) {
  const booking = await getBooking(user, id);
  await db.assetBooking.delete({ where: { id: booking.id } });
  await audit({
    orgId: user.orgId, actor: user, action: "asset.booking.delete", entityType: "asset_booking", entityId: booking.id,
    before: { title: booking.title, status: booking.status },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}
