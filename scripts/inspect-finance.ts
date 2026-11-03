import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const ORG = "cmvu5zyeo0000rcc602zcnf83";
async function main() {
  const [accounts, funds, donations, batches, splits, jes, bills, vouchers, stipends, runs, receipts, deposits, pettyD, pettyR, scheds, bankTxns, online, statements, pledges, recurring, notifications] = await Promise.all([
    db.account.count({ where: { orgId: ORG } }),
    db.fund.findMany({ where: { orgId: ORG }, select: { name: true, code: true, type: true, isSystemFund: true, revenueAccountId: true, glAccountCode: true, isActive: true } }),
    db.donation.count({ where: { orgId: ORG } }),
    db.batch.count({ where: { orgId: ORG } }),
    db.donationSplit.count({ where: { orgId: ORG } }),
    db.journalEntry.count({ where: { orgId: ORG } }),
    db.bill.count({ where: { orgId: ORG } }),
    db.paymentVoucher.count({ where: { orgId: ORG } }),
    db.stipendBatch.count({ where: { orgId: ORG } }),
    db.payrollRun.count({ where: { orgId: ORG } }),
    db.otherReceipt.count({ where: { orgId: ORG } }),
    db.cashDeposit.count({ where: { orgId: ORG } }),
    db.pettyCashDisbursement.count({ where: { orgId: ORG } }),
    db.pettyCashReplenish.count({ where: { orgId: ORG } }),
    db.remittanceSchedule.count({ where: { orgId: ORG } }),
    db.bankTransaction.count({ where: { orgId: ORG } }),
    db.onlinePayment.count({ where: { orgId: ORG } }),
    db.givingStatement.count({ where: { orgId: ORG } }),
    db.pledge.count({ where: { orgId: ORG } }),
    db.recurringGift.count({ where: { orgId: ORG } }),
    db.notification.count({ where: { orgId: ORG, module: { in: ["giving", "accounting"] } } }),
  ]);
  console.log("accounts:", accounts);
  console.log("funds:", JSON.stringify(funds, null, 1));
  console.log({ donations, batches, splits, jes, bills, vouchers, stipends, runs, receipts, deposits, pettyD, pettyR, scheds, bankTxns, online, statements, pledges, recurring, notifications });
  const accts = await db.account.findMany({ where: { orgId: ORG, code: { in: ["4000", "4100", "1000", "1010", "1020"] } }, select: { code: true, name: true, type: true } });
  console.log("key accounts:", JSON.stringify(accts));
}
main().finally(() => db.$disconnect());
