// ─────────────────────────────────────────────────────────────────────────────
// Fresh-tenant defaults — shared by self-signup provisioning (onboarding.ts)
// and by maintenance scripts (e.g. scripts/cleanup-demo-data.ts) so every
// provisioned church starts from the same funds + chart-of-accounts skeleton.
// Keep in sync with the tenant onboarding spec (§5: default funds + CoA).
// ─────────────────────────────────────────────────────────────────────────────

import type { Prisma } from "@prisma/client";

export const DEFAULT_FUNDS = [
  { name: "General Fund", code: "100", type: "general", isSystemFund: false },
  { name: "Tithes & Offerings", code: "110", type: "tithe", isSystemFund: true },
  { name: "Missions", code: "300", type: "missions", isSystemFund: false },
  { name: "Building Fund", code: "200", type: "building", isSystemFund: false },
];

export const DEFAULT_ACCOUNTS = [
  { code: "1000", name: "Cash — Operating Account", type: "asset", fundRestriction: "unrestricted" },
  { code: "1100", name: "Cash — Savings", type: "asset", fundRestriction: "unrestricted" },
  { code: "2000", name: "Accounts Payable", type: "liability", fundRestriction: "unrestricted" },
  { code: "3000", name: "Net Assets — Unrestricted", type: "net_asset", fundRestriction: "unrestricted" },
  { code: "3100", name: "Net Assets — Temporarily Restricted", type: "net_asset", fundRestriction: "temp_restricted" },
  { code: "3200", name: "Net Assets — Permanently Restricted", type: "net_asset", fundRestriction: "perm_restricted" },
  { code: "4000", name: "General Offerings", type: "revenue", fundRestriction: "unrestricted" },
  { code: "4100", name: "Tithes", type: "revenue", fundRestriction: "unrestricted" },
  { code: "4200", name: "Missions Donations", type: "revenue", fundRestriction: "temp_restricted" },
  { code: "4300", name: "Building Donations", type: "revenue", fundRestriction: "temp_restricted" },
  { code: "5000", name: "Ministry Expenses", type: "expense", fundRestriction: "unrestricted", functionalClass: "program" },
  { code: "5100", name: "Salaries & Housing", type: "expense", fundRestriction: "unrestricted", functionalClass: "program" },
  { code: "5200", name: "Utilities & Facilities", type: "expense", fundRestriction: "unrestricted", functionalClass: "admin" },
  { code: "5300", name: "Office & Administrative", type: "expense", fundRestriction: "unrestricted", functionalClass: "admin" },
  { code: "6000", name: "Fundraising Expenses", type: "expense", fundRestriction: "unrestricted", functionalClass: "fundraising" },
];

/**
 * (Re)create the standard fund + CoA skeleton for an org — identical to what
 * self-signup provisions. Safe to call multiple times only when the org has
 * no existing funds/accounts (unique constraint on [orgId, code]).
 */
export async function provisionDefaults(tx: Prisma.TransactionClient, orgId: string) {
  for (const [i, f] of DEFAULT_FUNDS.entries()) {
    await tx.fund.create({ data: { orgId, name: f.name, code: f.code, type: f.type, isSystemFund: f.isSystemFund, sortOrder: i } });
  }
  for (const a of DEFAULT_ACCOUNTS) {
    await tx.account.create({
      data: {
        orgId, code: a.code, name: a.name, type: a.type,
        fundRestriction: a.fundRestriction, functionalClass: (a as { functionalClass?: string }).functionalClass ?? null,
      },
    });
  }
}
