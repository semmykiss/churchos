import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound, forbidden } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { createJournalEntry } from "@/server/services/accounting";

/**
 * Stipends, Payroll & Honoraria service.
 * Posts a balanced GL entry per batch:
 *   Dr 5400 Pastoral & Staff Stipends (gross)
 *   Cr 1010 Operating Bank (net payable)
 *   Cr 2160 WHT / PAYE Payable (deductions — PAYE / pension)
 * Lines track individual payees for the payslip/PDF.
 */

function assertManage(user: SessionUser) {
  if (!can(user, "accounting.manage")) throw forbidden("Requires accounting.manage permission.");
}
function assertView(user: SessionUser) {
  if (!can(user, "accounting.view") && !can(user, "accounting.manage")) throw forbidden("Requires accounting.view permission.");
}

function monthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

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
  if (!bankCashId) bankCashId = (await db.account.findFirst({ where: { orgId: user.orgId, code: "1010" } }))?.id ?? (await db.account.findFirst({ where: { orgId: user.orgId, code: "1000" } }))?.id;
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
