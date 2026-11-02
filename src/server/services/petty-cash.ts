import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound, forbidden } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { createJournalEntry } from "@/server/services/accounting";

/**
 * Petty Cash (Imprest) service.
 *  • Disburse: Dr Expense / Cr 1025 Petty Cash Float
 *  • Replenish: Dr 1025 Petty Cash Float / Cr 1010 Operating Bank
 *  • Float balance = sum of debits − credits to the 1025 account.
 */

const PETTY_CODE = "1025";
const BANK_CODE = "1010";

function assertManage(user: SessionUser) {
  if (!can(user, "accounting.manage")) throw forbidden("Requires accounting.manage permission.");
}
function assertView(user: SessionUser) {
  if (!can(user, "accounting.view") && !can(user, "accounting.manage")) throw forbidden("Requires accounting.view permission.");
}

async function pettyCashAccount(orgId: string) {
  const acct = await db.account.findFirst({ where: { orgId, code: PETTY_CODE } });
  if (!acct) throw badRequest("Petty Cash Float account (1025) not found in the chart of accounts.");
  return acct;
}

/** Current petty cash balance (debit-normal asset) + float cap if configured. */
export async function getPettyCashStatus(user: SessionUser) {
  assertView(user);
  const acct = await pettyCashAccount(user.orgId);
  const lines = await db.journalLine.findMany({
    where: { orgId: user.orgId, accountId: acct.id, journalEntry: { reversedByEntryId: null } },
    select: { debitCents: true, creditCents: true },
  });
  const balance = lines.reduce((a, l) => a + l.debitCents - l.creditCents, 0);
  return { accountId: acct.id, balanceCents: balance };
}

export async function listPettyCashDisbursements(user: SessionUser) {
  assertView(user);
  const rows = await db.pettyCashDisbursement.findMany({ where: { orgId: user.orgId }, orderBy: { disbursedOn: "desc" }, take: 200 });
  return { items: rows };
}

export async function disbursePettyCash(
  user: SessionUser,
  input: { voucherRef?: string; disbursedOn?: string; payeeName?: string; purpose?: string; expenseAccountId?: string; amountCents?: number },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  if (!input?.payeeName?.trim()) throw badRequest("payeeName is required.");
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("amountCents must be a positive whole number of kobo.");
  if (!input.expenseAccountId) throw badRequest("expenseAccountId is required.");
  const expAcct = await db.account.findFirst({ where: { id: input.expenseAccountId, orgId: user.orgId } });
  if (!expAcct) throw notFound("Expense account not found.");
  const petty = await pettyCashAccount(user.orgId);
  const entry = await createJournalEntry(user, {
    entryDate: input.disbursedOn ? new Date(input.disbursedOn) : new Date(),
    memo: `Petty cash — ${input.payeeName}${input.purpose ? ` (${input.purpose})` : ""}`,
    sourceType: "petty_cash",
    sourceId: undefined as any,
    lines: [
      { accountId: expAcct.id, debitCents: amount },
      { accountId: petty.id, creditCents: amount },
    ],
  });
  const row = await db.pettyCashDisbursement.create({
    data: {
      orgId: user.orgId,
      voucherRef: input.voucherRef?.trim() || null,
      disbursedOn: input.disbursedOn ? new Date(input.disbursedOn) : new Date(),
      payeeName: input.payeeName.trim(),
      purpose: input.purpose?.trim() || null,
      expenseAccountId: expAcct.id,
      amountCents: amount,
      journalEntryId: entry.id,
      createdByName: user.name,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "petty.disburse", entityType: "petty_cash_disbursement", entityId: row.id, after: { amountCents: amount, journalEntryId: entry.id }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: row.id, journalEntryId: entry.id };
}

export async function replenishPettyCash(
  user: SessionUser,
  input: { replenishedOn?: string; amountCents?: number; fromBankAccountId?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("amountCents must be a positive whole number of kobo.");
  const petty = await pettyCashAccount(user.orgId);
  let bankCashId: string | null = null;
  if (input.fromBankAccountId) {
    const bank = await db.bankAccount.findFirst({ where: { id: input.fromBankAccountId, orgId: user.orgId } });
    bankCashId = bank?.glAccountId ?? null;
  }
  if (!bankCashId) bankCashId = (await db.account.findFirst({ where: { orgId: user.orgId, code: BANK_CODE } }))?.id ?? null;
  if (!bankCashId) throw badRequest("No bank account available to replenish from.");
  const entry = await createJournalEntry(user, {
    entryDate: input.replenishedOn ? new Date(input.replenishedOn) : new Date(),
    memo: "Petty cash float replenishment",
    sourceType: "petty_replenish",
    sourceId: undefined as any,
    lines: [
      { accountId: petty.id, debitCents: amount },
      { accountId: bankCashId, creditCents: amount },
    ],
  });
  const row = await db.pettyCashReplenish.create({
    data: {
      orgId: user.orgId,
      replenishedOn: input.replenishedOn ? new Date(input.replenishedOn) : new Date(),
      amountCents: amount,
      fromBankAccountId: input.fromBankAccountId || null,
      journalEntryId: entry.id,
      createdByName: user.name,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "petty.replenish", entityType: "petty_cash_replenish", entityId: row.id, after: { amountCents: amount, journalEntryId: entry.id }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: row.id, journalEntryId: entry.id };
}
