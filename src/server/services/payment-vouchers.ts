import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, notFound, forbidden, conflict } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { createJournalEntry } from "@/server/services/accounting";

/**
 * Payment Voucher service — the primary Nigerian church expense workflow:
 *   Request (accounting.vouchers.request) → Approve (accounting.vouchers.approve)
 *   → Disburse (accounting.manage) which posts a balanced GL entry:
 *     Dr Expense Account, Cr Bank/Petty Cash, Cr WHT Payable (2160) if WHT applies.
 * Append-only: corrections are reversing journal entries, never edits.
 */

const DEPARTMENTS = ["Music", "Media", "Maintenance", "Children", "Welfare", "Pastoral", "Admin", "Other"] as const;
const PV_METHODS = ["bank_transfer", "cash", "petty_cash", "cheque", "pos"] as const;

function assertRequest(user: SessionUser) {
  if (!can(user, "accounting.vouchers.request") && !can(user, "accounting.manage")) {
    throw forbidden("Requires accounting.vouchers.request permission.");
  }
}
function assertApprove(user: SessionUser) {
  if (!can(user, "accounting.vouchers.approve") && !can(user, "accounting.manage")) {
    throw forbidden("Requires accounting.vouchers.approve permission.");
  }
}
function assertManage(user: SessionUser) {
  if (!can(user, "accounting.manage")) throw forbidden("Requires accounting.manage permission.");
}

async function nextVoucherNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PV-${year}-`;
  const last = await db.paymentVoucher.findFirst({
    where: { orgId, voucherNumber: { startsWith: prefix } },
    orderBy: { voucherNumber: "desc" },
    select: { voucherNumber: true },
  });
  let seq = 1;
  if (last) {
    const m = last.voucherNumber.match(/(\d+)$/);
    if (m) seq = Number(m[1]) + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function listPaymentVouchers(user: SessionUser, q: { status?: string } = {}) {
  if (!can(user, "accounting.view") && !can(user, "accounting.vouchers.request")) {
    throw forbidden("Requires accounting.view or accounting.vouchers.request permission.");
  }
  // requesters without accounting.view only see their own PVs
  const where: any = { orgId: user.orgId };
  if (!can(user, "accounting.view")) where.requesterId = user.membershipId;
  if (q.status) where.status = q.status;
  const vouchers = await db.paymentVoucher.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 });
  return { items: vouchers.map((v) => toVoucherDTO(v)) };
}

export async function getPaymentVoucher(user: SessionUser, id: string) {
  if (!can(user, "accounting.view") && !can(user, "accounting.vouchers.request")) {
    throw forbidden("Requires accounting.view or accounting.vouchers.request permission.");
  }
  const v = await db.paymentVoucher.findFirst({ where: { id, orgId: user.orgId } });
  if (!v) throw notFound("Payment voucher not found.");
  if (!can(user, "accounting.view") && v.requesterId !== user.membershipId) throw forbidden("You can only view your own payment vouchers.");
  return toVoucherDTO(v);
}

export async function createPaymentVoucher(
  user: SessionUser,
  input: {
    department?: string; payeeName?: string; payeeBankName?: string; payeeAccountNumber?: string;
    purpose?: string; expenseAccountId?: string; fundId?: string; amountCents?: number;
    whtRateBps?: number;
  },
  meta: { ip?: string; userAgent?: string },
) {
  assertRequest(user);
  if (!input?.payeeName?.trim()) throw badRequest("Payee name is required.");
  const amount = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("amountCents must be a positive whole number of kobo.");
  if (input?.payeeAccountNumber && !/^\d{10}$/.test(input.payeeAccountNumber.trim())) {
    throw badRequest("payeeAccountNumber must be a 10-digit NUBAN.");
  }
  const whtRateBps = Math.max(0, Math.min(10000, Math.round(Number(input?.whtRateBps) || 0)));
  if (input?.department && !(DEPARTMENTS as readonly string[]).includes(input.department)) {
    throw badRequest("Unknown department.");
  }
  const voucherNumber = await nextVoucherNumber(user.orgId);
  const voucher = await db.paymentVoucher.create({
    data: {
      orgId: user.orgId,
      voucherNumber,
      requesterId: user.membershipId,
      department: input.department || null,
      payeeName: input.payeeName.trim(),
      payeeBankName: input.payeeBankName?.trim() || null,
      payeeAccountNumber: input.payeeAccountNumber?.trim() || null,
      purpose: input.purpose?.trim() || null,
      expenseAccountId: input.expenseAccountId || null,
      fundId: input.fundId || null,
      amountCents: amount,
      whtRateBps,
      status: "pending_approval",
      createdByName: user.name,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "pv.create", entityType: "payment_voucher", entityId: voucher.id, after: { voucherNumber, payeeName: voucher.payeeName, amountCents: amount, whtRateBps }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: voucher.id, voucherNumber };
}

export async function approvePaymentVoucher(user: SessionUser, voucherId: string, meta: { ip?: string; userAgent?: string }) {
  assertApprove(user);
  const v = await db.paymentVoucher.findFirst({ where: { id: voucherId, orgId: user.orgId } });
  if (!v) throw notFound("Payment voucher not found.");
  if (v.status !== "pending_approval") throw conflict(`Only pending vouchers can be approved (current: ${v.status}).`);
  if (v.requesterId === user.membershipId) throw badRequest("You cannot approve your own payment voucher (segregation of duties).");
  const updated = await db.paymentVoucher.update({
    where: { id: v.id },
    data: { status: "approved", approvedById: user.membershipId, approvedAt: new Date() },
  });
  await audit({ orgId: user.orgId, actor: user, action: "pv.approve", entityType: "payment_voucher", entityId: v.id, after: { voucherNumber: v.voucherNumber, approver: user.name }, ip: meta.ip, userAgent: meta.userAgent });
  return toVoucherDTO(updated);
}

export async function rejectPaymentVoucher(user: SessionUser, voucherId: string, note: string, meta: { ip?: string; userAgent?: string }) {
  assertApprove(user);
  if (!note?.trim()) throw badRequest("A rejection note is required.");
  const v = await db.paymentVoucher.findFirst({ where: { id: voucherId, orgId: user.orgId } });
  if (!v) throw notFound("Payment voucher not found.");
  if (v.status === "paid") throw conflict("A paid voucher cannot be rejected — reverse the journal entry instead.");
  const updated = await db.paymentVoucher.update({ where: { id: v.id }, data: { status: "rejected", rejectionNote: note.trim() } });
  await audit({ orgId: user.orgId, actor: user, action: "pv.reject", entityType: "payment_voucher", entityId: v.id, after: { note: note.trim() }, ip: meta.ip, userAgent: meta.userAgent });
  return toVoucherDTO(updated);
}

/** Disburse an approved voucher — posts the balanced settlement JE. */
export async function payPaymentVoucher(
  user: SessionUser,
  voucherId: string,
  input: { bankAccountId?: string; paymentMethod?: string; paymentRef?: string },
  meta: { ip?: string; userAgent?: string },
) {
  assertManage(user);
  const v = await db.paymentVoucher.findFirst({ where: { id: voucherId, orgId: user.orgId } });
  if (!v) throw notFound("Payment voucher not found.");
  if (v.status !== "approved") throw conflict(`Only approved vouchers can be paid (current: ${v.status}).`);
  if (!v.expenseAccountId) throw badRequest("This voucher has no expense account — cannot post to GL.");
  const method = input.paymentMethod ?? "bank_transfer";
  if (!(PV_METHODS as readonly string[]).includes(method)) throw badRequest("Unknown payment method.");
  // cash account: bank.glAccountId for bank/pos/cheque, else 1025 Petty Cash
  let cashAccountId: string | null = null;
  if (method === "petty_cash") {
    cashAccountId = (await db.account.findFirst({ where: { orgId: user.orgId, code: "1025" } }))?.id ?? null;
  } else if (input.bankAccountId) {
    const bank = await db.bankAccount.findFirst({ where: { id: input.bankAccountId, orgId: user.orgId } });
    cashAccountId = bank?.glAccountId ?? null;
  }
  if (!cashAccountId) cashAccountId = (await db.account.findFirst({ where: { orgId: user.orgId, code: "1000" } }))?.id ?? null;
  if (!cashAccountId) throw badRequest("No cash/bank account available for disbursement.");

  const whtAmount = Math.round((v.amountCents * v.whtRateBps) / 10000);
  const netPay = v.amountCents - whtAmount;

  const lines: { accountId: string; fundId: string | null; debitCents: number; creditCents: number }[] = [
    { accountId: v.expenseAccountId, fundId: v.fundId ?? null, debitCents: v.amountCents, creditCents: 0 },
    { accountId: cashAccountId, fundId: v.fundId ?? null, debitCents: 0, creditCents: netPay },
  ];
  if (whtAmount > 0) {
    const whtAcct = await db.account.findFirst({ where: { orgId: user.orgId, code: "2160" } });
    if (!whtAcct) throw badRequest("WHT Payable account (2160) not found in the chart of accounts.");
    lines.push({ accountId: whtAcct.id, fundId: v.fundId ?? null, debitCents: 0, creditCents: whtAmount });
  }

  const entry = await createJournalEntry(user, {
    entryDate: new Date(),
    memo: `Payment Voucher ${v.voucherNumber} — ${v.payeeName}${v.purpose ? ` (${v.purpose})` : ""}`,
    sourceType: "payment_voucher",
    sourceId: v.id,
    lines,
  });

  const updated = await db.paymentVoucher.update({
    where: { id: v.id },
    data: {
      status: "paid",
      paidById: user.membershipId,
      paidAt: new Date(),
      bankAccountId: input.bankAccountId || null,
      paymentMethod: method,
      paymentRef: input.paymentRef?.trim() || null,
      journalEntryId: entry.id,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "pv.pay", entityType: "payment_voucher", entityId: v.id, after: { voucherNumber: v.voucherNumber, amountCents: v.amountCents, whtCents: whtAmount, netCents: netPay, journalEntryId: entry.id }, ip: meta.ip, userAgent: meta.userAgent });
  return toVoucherDTO(updated);
}

export async function voidPaymentVoucher(user: SessionUser, voucherId: string, meta: { ip?: string; userAgent?: string }) {
  assertManage(user);
  const v = await db.paymentVoucher.findFirst({ where: { id: voucherId, orgId: user.orgId } });
  if (!v) throw notFound("Payment voucher not found.");
  if (v.status === "paid") throw conflict("A paid voucher cannot be voided — reverse the journal entry instead.");
  const updated = await db.paymentVoucher.update({ where: { id: v.id }, data: { status: "void" } });
  await audit({ orgId: user.orgId, actor: user, action: "pv.void", entityType: "payment_voucher", entityId: v.id, ip: meta.ip, userAgent: meta.userAgent });
  return toVoucherDTO(updated);
}

function toVoucherDTO(v: any) {
  return {
    id: v.id,
    voucherNumber: v.voucherNumber,
    requesterId: v.requesterId,
    department: v.department,
    payeeName: v.payeeName,
    payeeBankName: v.payeeBankName,
    payeeAccountNumber: v.payeeAccountNumber,
    purpose: v.purpose,
    expenseAccountId: v.expenseAccountId,
    fundId: v.fundId,
    amountCents: v.amountCents,
    whtRateBps: v.whtRateBps,
    whtCents: Math.round((v.amountCents * v.whtRateBps) / 10000),
    netCents: v.amountCents - Math.round((v.amountCents * v.whtRateBps) / 10000),
    status: v.status,
    approvedById: v.approvedById,
    approvedAt: v.approvedAt,
    paidById: v.paidById,
    paidAt: v.paidAt,
    bankAccountId: v.bankAccountId,
    paymentMethod: v.paymentMethod,
    paymentRef: v.paymentRef,
    journalEntryId: v.journalEntryId,
    rejectionNote: v.rejectionNote,
    createdByName: v.createdByName,
    createdAt: v.createdAt,
  };
}

export { DEPARTMENTS, PV_METHODS };
