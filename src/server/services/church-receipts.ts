import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound, forbidden } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { createJournalEntry } from "@/server/services/accounting";

/**
 * Other Church Receipts (bookshop/media/hall rental/grants/interest/refunds)
 * + Cash Deposits (move 1020 Undeposited Cash → 1010 Operating Bank).
 * Each posts a balanced GL entry and is append-only.
 */

const RECEIPT_CATEGORIES = ["bookshop", "media", "hall_rental", "school", "clinic", "grant", "interest", "refund", "other"] as const;
const RECEIPT_METHODS = ["bank_transfer", "pos", "cash", "cheque"] as const;

function assertManage(user: SessionUser) {
  if (!can(user, "accounting.manage")) throw forbidden("Requires accounting.manage permission.");
}
function assertView(user: SessionUser) {
  if (!can(user, "accounting.view") && !can(user, "accounting.manage")) throw forbidden("Requires accounting.view permission.");
}

async function nextReceiptNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `R-${year}-`;
  const last = await db.otherReceipt.findFirst({ where: { orgId, receiptNumber: { startsWith: prefix } }, orderBy: { receiptNumber: "desc" }, select: { receiptNumber: true } });
  let seq = 1;
  if (last) {
    const m = last.receiptNumber.match(/(\d+)$/);
    if (m) seq = Number(m[1]) + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function listOtherReceipts(user: SessionUser, q: { from?: string; to?: string } = {}) {
  assertView(user);
  const where: any = { orgId: user.orgId };
  if (q.from || q.to) {
    where.receiptDate = {
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to ? { lte: new Date(new Date(q.to).getTime() + 86400000) } : {}),
    };
  }
  const receipts = await db.otherReceipt.findMany({ where, orderBy: { receiptDate: "desc" }, take: 300 });
  return { items: receipts.map((r) => ({ ...r, journalEntryId: r.journalEntryId })) };
}

export async function createOtherReceipt(
  user: SessionUser,
  input: { receiptDate?: string; category?: string; description?: string; amountCents?: number; bankAccountId?: string; revenueAccountId?: string; paymentMethod?: string; paymentRef?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("amountCents must be a positive whole number of kobo.");
  const category = input.category || "other";
  if (!(RECEIPT_CATEGORIES as readonly string[]).includes(category)) throw badRequest("Unknown receipt category.");
  const method = input.paymentMethod || "bank_transfer";
  if (!(RECEIPT_METHODS as readonly string[]).includes(method)) throw badRequest("Unknown payment method.");
  if (!input.revenueAccountId) throw badRequest("revenueAccountId is required.");
  const revAcct = await db.account.findFirst({ where: { id: input.revenueAccountId, orgId: user.orgId } });
  if (!revAcct) throw notFound("Revenue account not found.");
  // cash/bank account: bank.glAccountId if bank provided, else 1000
  let cashAccountId: string | null = null;
  if (input.bankAccountId) {
    const bank = await db.bankAccount.findFirst({ where: { id: input.bankAccountId, orgId: user.orgId } });
    cashAccountId = bank?.glAccountId ?? null;
  }
  if (!cashAccountId) cashAccountId = (await db.account.findFirst({ where: { orgId: user.orgId, code: "1000" } }))?.id ?? null;
  if (!cashAccountId) throw badRequest("No cash/bank account available.");

  const receiptNumber = await nextReceiptNumber(user.orgId);
  const entry = await createJournalEntry(user, {
    entryDate: input.receiptDate ? new Date(input.receiptDate) : new Date(),
    memo: `Receipt ${receiptNumber} — ${category}${input.description ? ` (${input.description})` : ""}`,
    sourceType: "other_receipt",
    sourceId: undefined as any, // set below once we have the receipt id
    lines: [
      { accountId: cashAccountId, debitCents: amount },
      { accountId: revAcct.id, creditCents: amount },
    ],
  });
  const receipt = await db.otherReceipt.create({
    data: {
      orgId: user.orgId,
      receiptNumber,
      receiptDate: input.receiptDate ? new Date(input.receiptDate) : new Date(),
      category,
      description: input.description?.trim() || null,
      amountCents: amount,
      bankAccountId: input.bankAccountId || null,
      revenueAccountId: revAcct.id,
      paymentMethod: method,
      paymentRef: input.paymentRef?.trim() || null,
      journalEntryId: entry.id,
      createdByName: user.name,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "receipt.create", entityType: "other_receipt", entityId: receipt.id, after: { receiptNumber, category, amountCents, journalEntryId: entry.id }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: receipt.id, receiptNumber, journalEntryId: entry.id };
}

// ── cash deposits (Safe → Bank) ───────────────────────────────────────────────

export async function listCashDeposits(user: SessionUser) {
  assertView(user);
  const deposits = await db.cashDeposit.findMany({ where: { orgId: user.orgId }, orderBy: { depositDate: "desc" }, take: 200 });
  return { items: deposits };
}

export async function recordCashDeposit(
  user: SessionUser,
  input: { depositDate?: string; bankAccountId?: string; tellerSlipNumber?: string; totalCents?: number; batchIds?: string[] },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  const amount = Math.round(Number(input?.totalCents));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("totalCents must be a positive whole number of kobo.");
  if (!input.bankAccountId) throw badRequest("bankAccountId is required.");
  const bank = await db.bankAccount.findFirst({ where: { id: input.bankAccountId, orgId: user.orgId } });
  if (!bank) throw notFound("Bank account not found.");
  const bankCashId = bank.glAccountId ?? (await db.account.findFirst({ where: { orgId: user.orgId, code: "1010" } }))?.id;
  const safeId = (await db.account.findFirst({ where: { orgId: user.orgId, code: "1020" } }))?.id ?? (await db.account.findFirst({ where: { orgId: user.orgId, code: "1000" } }))?.id;
  if (!bankCashId || !safeId) throw badRequest("Cash accounts (1020 Safe / 1010 Bank) not found in the chart.");

  const entry = await createJournalEntry(user, {
    entryDate: input.depositDate ? new Date(input.depositDate) : new Date(),
    memo: `Cash deposit to bank — teller ${input.tellerSlipNumber ?? "n/a"}`,
    sourceType: "cash_deposit",
    sourceId: undefined as any,
    lines: [
      { accountId: bankCashId, debitCents: amount },
      { accountId: safeId, creditCents: amount },
    ],
  });
  const deposit = await db.cashDeposit.create({
    data: {
      orgId: user.orgId,
      depositDate: input.depositDate ? new Date(input.depositDate) : new Date(),
      bankAccountId: bank.id,
      tellerSlipNumber: input.tellerSlipNumber?.trim() || null,
      totalCents: amount,
      batchIdsJson: input.batchIds ? JSON.stringify(input.batchIds) : null,
      journalEntryId: entry.id,
      createdByName: user.name,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "cash_deposit.create", entityType: "cash_deposit", entityId: deposit.id, after: { amountCents: amount, journalEntryId: entry.id }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: deposit.id, journalEntryId: entry.id };
}

export { RECEIPT_CATEGORIES, RECEIPT_METHODS };
