import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound, forbidden, conflict } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { createJournalEntry } from "@/server/services/accounting";
import { pushNotifications, userIdsWithPermission } from "@/server/services/notifications";

/**
 * Payroll service — fully separates PAYROLL (staff salaries), STIPENDS
 * (pastoral) and HONORARIA (visiting ministers), with bonus & allowance
 * capture, an approval flow (accountant prepares → pastor/church-admin
 * approves → accountant posts) and dedicated GL posting:
 *
 *   payroll   → Dr 5410 Staff Payroll — Salaries        (basic)
 *               Dr 5420 Staff Allowances & Benefits     (allowances)
 *               Dr 5430 Staff Bonuses                   (bonus)
 *   stipend   → Dr 5400 Pastoral & Staff Stipends       (gross)
 *   honoraria → Dr 5300 Honoraria & Visiting Ministers  (gross)
 *   credits   → Cr 2160 WHT/PAYE Payable · Cr 2165 Pension Payable · Cr Bank (net)
 *
 * Every run is a balanced journal entry (Σ debits = Σ credits enforced by
 * the GL engine). Legacy stipend-batch endpoints are preserved below.
 */

export const PAYROLL_KINDS = ["payroll", "stipend", "honoraria"] as const;
const KIND_LABEL: Record<string, string> = {
  payroll: "Staff Payroll",
  stipend: "Stipends",
  honoraria: "Honoraria",
};

function assertManage(user: SessionUser) {
  if (!can(user, "accounting.manage")) throw forbidden("Requires accounting.manage permission.");
}
function assertView(user: SessionUser) {
  if (!can(user, "accounting.view") && !can(user, "accounting.manage")) throw forbidden("Requires accounting.view permission.");
}
function assertApprover(user: SessionUser) {
  if (!can(user, "accounting.vouchers.approve") && !can(user, "accounting.manage")) {
    throw forbidden("Requires expense approval permission (accounting.vouchers.approve).");
  }
}

function monthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── staff pay profiles (reusable payee records — no new users created) ───────

function toProfileDTO(p: {
  id: string; payeeName: string; roleLabel: string | null; personId: string | null;
  category: string; basicCents: number; allowancesCents: number; bonusCents: number;
  payeCents: number; pensionCents: number; bankName: string | null; nuban: string | null;
  isActive: boolean; createdAt: Date;
}) {
  return { ...p };
}

export async function listStaffProfiles(user: SessionUser) {
  assertView(user);
  const profiles = await db.staffPayProfile.findMany({
    where: { orgId: user.orgId },
    orderBy: [{ category: "asc" }, { payeeName: "asc" }],
  });
  return { items: profiles.map(toProfileDTO) };
}

export async function upsertStaffProfile(
  user: SessionUser,
  input: {
    id?: string; payeeName?: string; roleLabel?: string; personId?: string | null;
    category?: string; basicCents?: number; allowancesCents?: number; bonusCents?: number;
    payeCents?: number; pensionCents?: number; bankName?: string; nuban?: string; isActive?: boolean;
  },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  const category = input.category ?? "payroll";
  if (!PAYROLL_KINDS.includes(category as (typeof PAYROLL_KINDS)[number])) {
    throw badRequest("category must be payroll, stipend or honoraria.");
  }
  const nuban = input.nuban?.replace(/\D/g, "") || null;
  if (nuban && nuban.length !== 10) throw badRequest("NUBAN must be exactly 10 digits.");

  const data = {
    roleLabel: input.roleLabel?.trim() || null,
    personId: input.personId || null,
    category,
    basicCents: Math.max(0, Math.round(Number(input.basicCents) || 0)),
    allowancesCents: Math.max(0, Math.round(Number(input.allowancesCents) || 0)),
    bonusCents: Math.max(0, Math.round(Number(input.bonusCents) || 0)),
    payeCents: Math.max(0, Math.round(Number(input.payeCents) || 0)),
    pensionCents: Math.max(0, Math.round(Number(input.pensionCents) || 0)),
    bankName: input.bankName?.trim() || null,
    nuban,
    isActive: typeof input.isActive === "boolean" ? input.isActive : true,
  };

  let profile;
  if (input.id) {
    const existing = await db.staffPayProfile.findFirst({ where: { id: input.id, orgId: user.orgId } });
    if (!existing) throw notFound("Staff profile not found.");
    profile = await db.staffPayProfile.update({ where: { id: existing.id }, data: { ...data, payeeName: input.payeeName?.trim() || existing.payeeName } });
    await audit({ orgId: user.orgId, actor: user, action: "payroll.profile.update", entityType: "staff_pay_profile", entityId: profile.id, after: { payeeName: profile.payeeName, category }, ip: meta.ip, userAgent: meta.userAgent });
  } else {
    const payeeName = input.payeeName?.trim();
    if (!payeeName) throw badRequest("payeeName is required.");
    profile = await db.staffPayProfile.create({ data: { orgId: user.orgId, ...data, payeeName } });
    await audit({ orgId: user.orgId, actor: user, action: "payroll.profile.create", entityType: "staff_pay_profile", entityId: profile.id, after: { payeeName: profile.payeeName, category }, ip: meta.ip, userAgent: meta.userAgent });
  }
  return { id: profile.id };
}

// ── payroll runs ─────────────────────────────────────────────────────────────

interface RunLineInput {
  profileId?: string; payeeName?: string; roleLabel?: string; personId?: string;
  basicCents?: number; allowancesCents?: number; bonusCents?: number;
  payeCents?: number; pensionCents?: number; bankName?: string; nuban?: string;
}

function computeLine(l: RunLineInput) {
  const basic = Math.max(0, Math.round(Number(l.basicCents) || 0));
  const allowances = Math.max(0, Math.round(Number(l.allowancesCents) || 0));
  const bonus = Math.max(0, Math.round(Number(l.bonusCents) || 0));
  const paye = Math.max(0, Math.round(Number(l.payeCents) || 0));
  const pension = Math.max(0, Math.round(Number(l.pensionCents) || 0));
  const gross = basic + allowances + bonus;
  if (!l.payeeName?.trim()) throw badRequest("payeeName is required on every payroll line.");
  if (gross <= 0) throw badRequest(`Gross pay must be positive for ${l.payeeName.trim()}.`);
  if (paye + pension > gross) throw badRequest(`Deductions exceed gross pay for ${l.payeeName.trim()}.`);
  return {
    profileId: l.profileId || null,
    payeeName: l.payeeName.trim(),
    roleLabel: l.roleLabel?.trim() || null,
    personId: l.personId || null,
    basicCents: basic,
    allowancesCents: allowances,
    bonusCents: bonus,
    payeCents: paye,
    pensionCents: pension,
    netCents: gross - paye - pension,
    bankName: l.bankName?.trim() || null,
    nuban: l.nuban?.replace(/\D/g, "") || null,
  };
}

function totalsOf(lines: ReturnType<typeof computeLine>[]) {
  const grossCents = lines.reduce((a, l) => a + l.basicCents + l.allowancesCents + l.bonusCents, 0);
  return {
    grossCents,
    allowancesCents: lines.reduce((a, l) => a + l.allowancesCents, 0),
    bonusCents: lines.reduce((a, l) => a + l.bonusCents, 0),
    payeCents: lines.reduce((a, l) => a + l.payeCents, 0),
    pensionCents: lines.reduce((a, l) => a + l.pensionCents, 0),
    netCents: lines.reduce((a, l) => a + l.netCents, 0),
  };
}

function toRunDTO(r: {
  id: string; periodMonth: string; kind: string; description: string | null; status: string;
  grossCents: number; allowancesCents: number; bonusCents: number; payeCents: number;
  pensionCents: number; netCents: number; bankAccountId: string | null;
  submittedByName: string | null; submittedAt: Date | null; approvedByName: string | null;
  approvedAt: Date | null; rejectionNote: string | null; postedByName: string | null;
  postedAt: Date | null; journalEntryId: string | null; createdByName: string | null;
  createdAt: Date; lines?: unknown[];
}) {
  return { ...r, kindLabel: KIND_LABEL[r.kind] ?? r.kind, lineCount: Array.isArray(r.lines) ? r.lines.length : undefined };
}

export async function listPayrollRuns(user: SessionUser, q: { kind?: string } = {}) {
  assertView(user);
  const runs = await db.payrollRun.findMany({
    where: { orgId: user.orgId, ...(q.kind && PAYROLL_KINDS.includes(q.kind as (typeof PAYROLL_KINDS)[number]) ? { kind: q.kind } : {}) },
    orderBy: { createdAt: "desc" },
    include: { lines: { select: { id: true } } },
    take: 120,
  });
  return { items: runs.map((r) => toRunDTO(r)) };
}

export async function getPayrollRun(user: SessionUser, id: string) {
  assertView(user);
  const run = await db.payrollRun.findFirst({ where: { id, orgId: user.orgId }, include: { lines: true } });
  if (!run) throw notFound("Payroll run not found.");
  return toRunDTO(run);
}

export async function createPayrollRun(
  user: SessionUser,
  input: {
    periodMonth?: string; kind?: string; description?: string; bankAccountId?: string;
    fromProfileIds?: string[]; lines?: RunLineInput[];
  },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  const kind = input.kind ?? "payroll";
  if (!PAYROLL_KINDS.includes(kind as (typeof PAYROLL_KINDS)[number])) {
    throw badRequest("kind must be payroll, stipend or honoraria.");
  }
  const month = input.periodMonth?.trim() || monthKey();
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest("periodMonth must be YYYY-MM.");
  const dupe = await db.payrollRun.findFirst({ where: { orgId: user.orgId, periodMonth: month, kind } });
  if (dupe) throw conflict(`A ${KIND_LABEL[kind]} run for ${month} already exists.`);

  // Build lines: explicit lines win; otherwise pull defaults from staff profiles.
  let computed: ReturnType<typeof computeLine>[] = [];
  if (Array.isArray(input.lines) && input.lines.length) {
    computed = input.lines.map(computeLine);
  } else if (Array.isArray(input.fromProfileIds) && input.fromProfileIds.length) {
    const profiles = await db.staffPayProfile.findMany({ where: { orgId: user.orgId, id: { in: input.fromProfileIds }, isActive: true } });
    if (!profiles.length) throw badRequest("No active staff profiles matched.");
    computed = profiles.map((p) => computeLine({
      profileId: p.id, payeeName: p.payeeName, roleLabel: p.roleLabel ?? undefined, personId: p.personId ?? undefined,
      basicCents: p.basicCents, allowancesCents: p.allowancesCents, bonusCents: p.bonusCents,
      payeCents: p.payeCents, pensionCents: p.pensionCents, bankName: p.bankName ?? undefined, nuban: p.nuban ?? undefined,
    }));
  } else {
    throw badRequest("Provide payroll lines or staff profile ids.");
  }

  const totals = totalsOf(computed);
  const run = await db.payrollRun.create({
    data: {
      orgId: user.orgId, periodMonth: month, kind,
      description: input.description?.trim() || null,
      bankAccountId: input.bankAccountId || null,
      status: "draft",
      ...totals,
      createdByName: user.name,
      lines: { create: computed.map((l) => ({ orgId: user.orgId, ...l })) },
    },
    include: { lines: true },
  });
  await audit({ orgId: user.orgId, actor: user, action: "payroll.run.create", entityType: "payroll_run", entityId: run.id, after: { month, kind, ...totals, lines: computed.length }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: run.id };
}

/** Replace lines / description / bank of a DRAFT run. */
export async function updatePayrollRun(
  user: SessionUser,
  runId: string,
  input: { description?: string; bankAccountId?: string; lines?: RunLineInput[] },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  const run = await db.payrollRun.findFirst({ where: { id: runId, orgId: user.orgId } });
  if (!run) throw notFound("Payroll run not found.");
  if (run.status !== "draft") throw badRequest("Only draft runs can be edited.");

  const data: Record<string, unknown> = {};
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.bankAccountId !== undefined) data.bankAccountId = input.bankAccountId || null;
  if (Array.isArray(input.lines) && input.lines.length) {
    const computed = input.lines.map(computeLine);
    const totals = totalsOf(computed);
    Object.assign(data, totals, {
      lines: { deleteMany: { orgId: user.orgId, runId: run.id }, create: computed.map((l) => ({ orgId: user.orgId, ...l })) },
    });
  }
  await db.payrollRun.update({ where: { id: run.id }, data });
  await audit({ orgId: user.orgId, actor: user, action: "payroll.run.update", entityType: "payroll_run", entityId: run.id, ip: meta.ip, userAgent: meta.userAgent });
  return { id: run.id };
}

/** draft → pending_approval. Notifies pastor/admin approvers + accountants. */
export async function submitPayrollRun(user: SessionUser, runId: string, meta: { ip?: string; userAgent?: string }) {
  assertManage(user);
  const run = await db.payrollRun.findFirst({ where: { id: runId, orgId: user.orgId } });
  if (!run) throw notFound("Payroll run not found.");
  if (run.status !== "draft") throw badRequest("Only draft runs can be submitted for approval.");

  await db.payrollRun.update({
    where: { id: run.id },
    data: { status: "pending_approval", submittedById: user.userId, submittedByName: user.name, submittedAt: new Date() },
  });
  await audit({ orgId: user.orgId, actor: user, action: "payroll.run.submit", entityType: "payroll_run", entityId: run.id, ip: meta.ip, userAgent: meta.userAgent });

  // Notify approvers (pastor / church admin) + accountants — best effort.
  try {
    const [approverIds, accountantIds] = await Promise.all([
      userIdsWithPermission(user.orgId, "accounting.vouchers.approve"),
      userIdsWithPermission(user.orgId, "accounting.manage"),
    ]);
    const ids = [...new Set([...approverIds, ...accountantIds])].filter((u) => u !== user.userId);
    if (ids.length) {
      await pushNotifications({
        orgId: user.orgId, userIds: ids, module: "accounting", type: "payroll.run.submitted",
        title: `${KIND_LABEL[run.kind]} approval needed — ${run.periodMonth}`,
        body: `${user.name} submitted the ${KIND_LABEL[run.kind]} run for ${run.periodMonth} (${(run.netCents / 100).toLocaleString("en-NG", { style: "currency", currency: "NGN" })} net).`,
        entityType: "payroll_run", entityId: run.id, linkModule: "accounting",
      });
    }
  } catch { /* notifications are best-effort */ }
  return { id: run.id, status: "pending_approval" };
}

/** pending_approval → approved (pastor / church admin; SoD: not own submission). */
export async function approvePayrollRun(user: SessionUser, runId: string, meta: { ip?: string; userAgent?: string }) {
  assertApprover(user);
  const run = await db.payrollRun.findFirst({ where: { id: runId, orgId: user.orgId } });
  if (!run) throw notFound("Payroll run not found.");
  if (run.status !== "pending_approval") throw badRequest("Only runs pending approval can be approved.");
  if (run.submittedById && run.submittedById === user.userId) {
    throw forbidden("Segregation of duties: you cannot approve a payroll run you submitted.");
  }
  await db.payrollRun.update({
    where: { id: run.id },
    data: { status: "approved", approvedById: user.userId, approvedByName: user.name, approvedAt: new Date(), rejectionNote: null },
  });
  await audit({ orgId: user.orgId, actor: user, action: "payroll.run.approve", entityType: "payroll_run", entityId: run.id, after: { month: run.periodMonth, kind: run.kind, netCents: run.netCents }, ip: meta.ip, userAgent: meta.userAgent });

  // Notify accountants that the run is cleared for posting.
  try {
    const accountantIds = (await userIdsWithPermission(user.orgId, "accounting.manage")).filter((u) => u !== user.userId);
    if (accountantIds.length) {
      await pushNotifications({
        orgId: user.orgId, userIds: accountantIds, module: "accounting", type: "payroll.run.approved",
        title: `${KIND_LABEL[run.kind]} approved — ${run.periodMonth}`,
        body: `${user.name} approved the ${KIND_LABEL[run.kind]} run for ${run.periodMonth}. Ready to post & disburse.`,
        entityType: "payroll_run", entityId: run.id, linkModule: "accounting",
      });
    }
  } catch { /* best-effort */ }
  return { id: run.id, status: "approved" };
}

/** pending_approval → rejected (pastor / church admin) with mandatory note. */
export async function rejectPayrollRun(user: SessionUser, runId: string, note: string, meta: { ip?: string; userAgent?: string }) {
  assertApprover(user);
  if (!note?.trim()) throw badRequest("A rejection note is required.");
  const run = await db.payrollRun.findFirst({ where: { id: runId, orgId: user.orgId } });
  if (!run) throw notFound("Payroll run not found.");
  if (run.status !== "pending_approval") throw badRequest("Only runs pending approval can be rejected.");
  await db.payrollRun.update({
    where: { id: run.id },
    data: { status: "rejected", rejectionNote: note.trim(), approvedById: null, approvedByName: null, approvedAt: null },
  });
  await audit({ orgId: user.orgId, actor: user, action: "payroll.run.reject", entityType: "payroll_run", entityId: run.id, after: { note: note.trim() }, ip: meta.ip, userAgent: meta.userAgent });

  try {
    const accountantIds = (await userIdsWithPermission(user.orgId, "accounting.manage")).filter((u) => u !== user.userId);
    if (accountantIds.length) {
      await pushNotifications({
        orgId: user.orgId, userIds: accountantIds, module: "accounting", type: "payroll.run.rejected",
        title: `${KIND_LABEL[run.kind]} returned — ${run.periodMonth}`,
        body: `${user.name} returned the ${KIND_LABEL[run.kind]} run: ${note.trim().slice(0, 200)}`,
        entityType: "payroll_run", entityId: run.id, linkModule: "accounting",
      });
    }
  } catch { /* best-effort */ }
  return { id: run.id, status: "rejected" };
}

/**
 * approved → posted. Posts the balanced GL entry for the run's kind:
 * payroll splits salaries/allowances/bonuses across 5410/5420/5430;
 * stipends → 5400; honoraria → 5300. Credits PAYE (2160), pension (2165)
 * and bank (net). Marks all lines paid.
 */
export async function postPayrollRun(
  user: SessionUser,
  runId: string,
  input: { bankAccountId?: string; paymentRef?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  const run = await db.payrollRun.findFirst({ where: { id: runId, orgId: user.orgId }, include: { lines: true } });
  if (!run) throw notFound("Payroll run not found.");
  if (run.status !== "approved") throw badRequest("Only approved runs can be posted. The pastor/church admin must approve first.");
  if (!run.lines.length) throw badRequest("This run has no payroll lines.");

  const byCode = async (code: string) => {
    const acct = await db.account.findFirst({ where: { orgId: user.orgId, code } });
    if (!acct) throw badRequest(`GL account ${code} is missing from the chart of accounts.`);
    return acct.id;
  };

  let bankCashId: string | null = null;
  const bankId = input.bankAccountId || run.bankAccountId;
  if (bankId) {
    const bank = await db.bankAccount.findFirst({ where: { id: bankId, orgId: user.orgId } });
    bankCashId = bank?.glAccountId ?? null;
  }
  if (!bankCashId) bankCashId = (await db.account.findFirst({ where: { orgId: user.orgId, code: "1010" } }))?.id
    ?? (await db.account.findFirst({ where: { orgId: user.orgId, code: "1000" } }))?.id ?? null;
  if (!bankCashId) throw badRequest("No bank/cash account available for disbursement.");

  const lines: { accountId: string; fundId: string | null; debitCents: number; creditCents: number }[] = [];
  if (run.kind === "payroll") {
    if (run.grossCents - run.bonusCents - run.allowancesCents > 0) {
      lines.push({ accountId: await byCode("5410"), fundId: null, debitCents: run.grossCents - run.allowancesCents - run.bonusCents, creditCents: 0 });
    }
    if (run.allowancesCents > 0) lines.push({ accountId: await byCode("5420"), fundId: null, debitCents: run.allowancesCents, creditCents: 0 });
    if (run.bonusCents > 0) lines.push({ accountId: await byCode("5430"), fundId: null, debitCents: run.bonusCents, creditCents: 0 });
  } else if (run.kind === "stipend") {
    lines.push({ accountId: await byCode("5400"), fundId: null, debitCents: run.grossCents, creditCents: 0 });
  } else {
    lines.push({ accountId: await byCode("5300"), fundId: null, debitCents: run.grossCents, creditCents: 0 });
  }
  if (run.payeCents > 0) lines.push({ accountId: await byCode("2160"), fundId: null, debitCents: 0, creditCents: run.payeCents });
  if (run.pensionCents > 0) lines.push({ accountId: await byCode("2165"), fundId: null, debitCents: 0, creditCents: run.pensionCents });
  if (run.netCents > 0) lines.push({ accountId: bankCashId, fundId: null, debitCents: 0, creditCents: run.netCents });

  const entry = await createJournalEntry(user, {
    entryDate: new Date(),
    memo: `${KIND_LABEL[run.kind]} — ${run.periodMonth}${run.description ? ` (${run.description})` : ""}`,
    sourceType: "payroll_run",
    sourceId: run.id,
    lines,
  });

  await db.payrollRun.update({
    where: { id: run.id },
    data: {
      status: "posted", postedByName: user.name, postedAt: new Date(),
      journalEntryId: entry.id, bankAccountId: input.bankAccountId || run.bankAccountId,
    },
  });
  await db.payrollLine.updateMany({ where: { runId: run.id }, data: { paidAt: new Date(), paymentRef: input.paymentRef || null } });
  await audit({ orgId: user.orgId, actor: user, action: "payroll.run.post", entityType: "payroll_run", entityId: run.id, after: { month: run.periodMonth, kind: run.kind, grossCents: run.grossCents, netCents: run.netCents, journalEntryId: entry.id }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: run.id, status: "posted", journalEntryId: entry.id };
}

// ── payroll register report ──────────────────────────────────────────────────

export async function reportPayrollRegister(user: SessionUser, q: { from?: string; to?: string; kind?: string } = {}) {
  assertView(user);
  const toDate = q.to ? new Date(`${q.to}T23:59:59`) : new Date();
  const fromDate = q.from ? new Date(`${q.from}T00:00:00`) : new Date(toDate.getFullYear(), 0, 1);
  const runs = await db.payrollRun.findMany({
    where: {
      orgId: user.orgId,
      status: "posted",
      postedAt: { gte: fromDate, lte: toDate },
      ...(q.kind && PAYROLL_KINDS.includes(q.kind as (typeof PAYROLL_KINDS)[number]) ? { kind: q.kind } : {}),
    },
    include: { lines: true },
    orderBy: { postedAt: "desc" },
  });
  const byKind = new Map<string, { kind: string; kindLabel: string; runs: number; grossCents: number; allowancesCents: number; bonusCents: number; payeCents: number; pensionCents: number; netCents: number; payees: number }>();
  for (const r of runs) {
    const k = byKind.get(r.kind) ?? {
      kind: r.kind, kindLabel: KIND_LABEL[r.kind] ?? r.kind, runs: 0, grossCents: 0,
      allowancesCents: 0, bonusCents: 0, payeCents: 0, pensionCents: 0, netCents: 0, payees: 0,
    };
    k.runs += 1;
    k.grossCents += r.grossCents;
    k.allowancesCents += r.allowancesCents;
    k.bonusCents += r.bonusCents;
    k.payeCents += r.payeCents;
    k.pensionCents += r.pensionCents;
    k.netCents += r.netCents;
    k.payees += r.lines.length;
    byKind.set(r.kind, k);
  }
  return {
    fromDate, toDate,
    kinds: [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind)),
    runs: runs.map((r) => toRunDTO(r)),
    totals: {
      grossCents: runs.reduce((a, r) => a + r.grossCents, 0),
      allowancesCents: runs.reduce((a, r) => a + r.allowancesCents, 0),
      bonusCents: runs.reduce((a, r) => a + r.bonusCents, 0),
      payeCents: runs.reduce((a, r) => a + r.payeCents, 0),
      pensionCents: runs.reduce((a, r) => a + r.pensionCents, 0),
      netCents: runs.reduce((a, r) => a + r.netCents, 0),
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Legacy stipend batches (preserved — superseded by payroll runs above)
// ═════════════════════════════════════════════════════════════════════════════

export async function listStipendBatches(user: SessionUser) {
  assertView(user);
  const batches = await db.stipendBatch.findMany({ where: { orgId: user.orgId }, orderBy: { periodMonth: "desc" }, include: { lines: true }, take: 100 });
  return {
    items: batches.map((b) => ({
      id: b.id, periodMonth: b.periodMonth, description: b.description,
      grossCents: b.grossCents, deductionsCents: b.deductionsCents, netCents: b.netCents,
      status: b.status, bankAccountId: b.bankAccountId, journalEntryId: b.journalEntryId,
      createdByName: b.createdByName, createdAt: b.createdAt,
      lineCount: b.lines.length,
    })),
  };
}

export async function getStipendBatch(user: SessionUser, id: string) {
  assertView(user);
  const b = await db.stipendBatch.findFirst({ where: { id, orgId: user.orgId }, include: { lines: true } });
  if (!b) throw notFound("Stipend batch not found.");
  return b;
}

export async function createStipendBatch(
  user: SessionUser,
  input: { periodMonth?: string; description?: string; lines?: { payeeName?: string; roleLabel?: string; grossCents?: number; payeCents?: number; pensionCents?: number }[] },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  const month = input.periodMonth?.trim() || monthKey();
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest("periodMonth must be YYYY-MM.");
  if (!Array.isArray(input?.lines) || !input.lines.length) throw badRequest("At least one stipend line is required.");
  const computed = input.lines.map((l) => {
    const gross = Math.round(Number(l.grossCents) || 0);
    const paye = Math.round(Number(l.payeCents) || 0);
    const pension = Math.round(Number(l.pensionCents) || 0);
    if (!l.payeeName?.trim()) throw badRequest("payeeName is required on every line.");
    if (gross <= 0) throw badRequest("grossCents must be positive on every line.");
    if (paye + pension > gross) throw badRequest(`Deductions exceed gross for ${l.payeeName}.`);
    return { payeeName: l.payeeName.trim(), roleLabel: l.roleLabel?.trim() || null, grossCents: gross, payeCents: paye, pensionCents: pension, netCents: gross - paye - pension };
  });
  const grossTotal = computed.reduce((a, l) => a + l.grossCents, 0);
  const dedTotal = computed.reduce((a, l) => a + l.payeCents + l.pensionCents, 0);
  const netTotal = grossTotal - dedTotal;

  const batch = await db.stipendBatch.create({
    data: {
      orgId: user.orgId,
      periodMonth: month,
      description: input.description?.trim() || null,
      grossCents: grossTotal,
      deductionsCents: dedTotal,
      netCents: netTotal,
      status: "draft",
      createdByName: user.name,
      lines: { create: computed.map((l) => ({ orgId: user.orgId, ...l })) },
    },
    include: { lines: true },
  });
  await audit({ orgId: user.orgId, actor: user, action: "stipend.create", entityType: "stipend_batch", entityId: batch.id, after: { month, grossCents: grossTotal, deductionsCents: dedTotal, netCents: netTotal, lines: computed.length }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: batch.id };
}

/** Post a draft stipend batch to the GL (Dr Stipends / Cr Bank + Cr PAYE Payable). */
export async function postStipendBatch(
  user: SessionUser,
  batchId: string,
  input: { bankAccountId?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  const batch = await db.stipendBatch.findFirst({ where: { id: batchId, orgId: user.orgId }, include: { lines: true } });
  if (!batch) throw notFound("Stipend batch not found.");
  if (batch.status !== "draft") throw badRequest("Only draft batches can be posted.");
  const stipendAcct = await db.account.findFirst({ where: { orgId: user.orgId, code: "5400" } });
  if (!stipendAcct) throw badRequest("Stipends account (5400) not found in the chart of accounts.");
  let bankCashId: string | null = null;
  if (input.bankAccountId) {
    const bank = await db.bankAccount.findFirst({ where: { id: input.bankAccountId, orgId: user.orgId } });
    bankCashId = bank?.glAccountId ?? null;
  }
  if (!bankCashId) bankCashId = ((await db.account.findFirst({ where: { orgId: user.orgId, code: "1010" } }))?.id ?? (await db.account.findFirst({ where: { orgId: user.orgId, code: "1000" } }))?.id) ?? null;
  if (!bankCashId) throw badRequest("No bank account available for stipend payment.");

  const lines: { accountId: string; fundId: string | null; debitCents: number; creditCents: number }[] = [
    { accountId: stipendAcct.id, fundId: null, debitCents: batch.grossCents, creditCents: 0 },
    { accountId: bankCashId, fundId: null, debitCents: 0, creditCents: batch.netCents },
  ];
  if (batch.deductionsCents > 0) {
    const payeAcct = await db.account.findFirst({ where: { orgId: user.orgId, code: "2160" } });
    if (!payeAcct) throw badRequest("WHT/PAYE Payable account (2160) not found in the chart of accounts.");
    lines.push({ accountId: payeAcct.id, fundId: null, debitCents: 0, creditCents: batch.deductionsCents });
  }

  const entry = await createJournalEntry(user, {
    entryDate: new Date(),
    memo: `Stipends & payroll — ${batch.periodMonth}${batch.description ? ` (${batch.description})` : ""}`,
    sourceType: "payroll",
    sourceId: batch.id,
    lines,
  });
  const updated = await db.stipendBatch.update({
    where: { id: batch.id },
    data: { status: "posted", bankAccountId: input.bankAccountId || null, journalEntryId: entry.id },
  });
  await audit({ orgId: user.orgId, actor: user, action: "stipend.post", entityType: "stipend_batch", entityId: batch.id, after: { grossCents: batch.grossCents, netCents: batch.netCents, deductionsCents: batch.deductionsCents, journalEntryId: entry.id }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: batch.id, status: "posted", journalEntryId: entry.id };
}

export { monthKey };
