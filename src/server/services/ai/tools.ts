import { db } from "@/server/db";
import { can, canAny, type SessionUser } from "@/server/permissions";
import { badRequest, notFound } from "@/server/http";
import { money, scopeGivingQuery } from "@/server/services/giving";
import { getPersonDetail } from "@/server/services/people";
import { listCases, createCase } from "@/server/services/care";
import { reportActivities, reportPosition, reportFundBalances, reportGivingBreakdown, listBills } from "@/server/services/accounting";
import { attendanceReport, givingReport } from "@/server/services/reports";
import { listEvents } from "@/server/services/events";
import { getPortalMe } from "@/server/services/portal";
import { lookup } from "@/server/services/ai/bible";
import * as risk from "@/server/services/risk";
import * as boardreport from "@/server/services/boardreport";
import * as sermon from "@/server/services/sermon";
import * as rota from "@/server/services/rota";

/**
 * Shepherd AI — tool registry (backend only). THE GOLDEN RULE:
 * the model never receives database access and never sees unscoped data.
 * Every tool is a thin wrapper around an EXISTING, ALREADY-SCOPED service
 * function; the same permission rule is re-validated inside the handler
 * (defense-in-depth) and every execution is written to ai_tool_audit_log.
 *
 * The set of tools exposed to the LLM is filtered per user BEFORE the model
 * sees the catalog (filterToolsFor) — a member's schema never contains
 * getGivingSummary at all, so the model cannot even ask for it.
 */

export interface AiToolContext {
  user: SessionUser;
  conversationId: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** Structured card the chat UI renders inline (money pre-formatted in ₦). */
export interface AiReportCard {
  kind: "giving_summary" | "fund_balances" | "financial_report" | "attendance" | "events" | "schedule" | "care_cases" | "bills" | "profile" | "risk_flag" | "board_report" | "sermon_draft" | "serving";
  title: string;
  subtitle?: string;
  stats?: { label: string; value: string }[];
  table?: { columns: string[]; rows: (string | number)[][] };
  /** Raw rows for CSV export (money as naira decimals, not display strings). */
  csv?: { name: string; columns: string[]; rows: (string | number)[][] };
}

export interface AiToolResult {
  ok: boolean;
  denied?: boolean;
  /** Compact factual summary the LLM grounds its answer in. */
  forModel: string;
  card?: AiReportCard;
  rows?: number;
}

export interface AiToolDef {
  name: string;
  label: string; // short human label for the transparency chip
  description: string; // shown to the LLM in the catalog
  argsSpec: string; // argument spec shown to the LLM
  /** Required permissions — the tool exists in the LLM schema only if the caller passes. */
  anyOf?: string[];
  run: (args: Record<string, unknown>, ctx: AiToolContext) => Promise<AiToolResult>;
}

const fmtN = (n: number | null | undefined) => money(n ?? 0);
const dayStr = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const startOfYear = (d = new Date()) => new Date(d.getFullYear(), 0, 1);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/** server-side permission re-check used by every handler (defense-in-depth) */
function assertPerm(ctx: AiToolContext, anyOf: string[] | undefined): boolean {
  if (!anyOf?.length) return true;
  return canAny(ctx.user, anyOf);
}

function deniedResult(toolName: string): AiToolResult {
  return {
    ok: false,
    denied: true,
    rows: 0,
    forModel: `ACCESS DENIED: the current user does not have the permission required for ${toolName}. Tell the user kindly that this information is outside their access. Never reveal what data would have been returned.`,
  };
}

// ── helpers to build giving summaries (reuse the module's scoping rule) ──────

interface GivingAgg {
  totalCents: number;
  ytdCents: number;
  count: number;
  byFund: { name: string; amountCents: number }[];
  recent: { date: string; amountCents: number; method: string; status: string; funds: string[] }[];
}

async function givingAggregate(orgId: string, whereBase: Record<string, unknown>, opts: { recentTake?: number } = {}): Promise<GivingAgg> {
  const where = { ...whereBase, status: "posted" };
  const [donations, reversalTargets] = await Promise.all([
    db.donation.findMany({ where, orderBy: { receivedOn: "desc" }, take: 400, include: { splits: { include: { fund: true } } } }),
    db.donation.findMany({ where: { orgId, reversalOfId: { not: null } }, select: { reversalOfId: true } }),
  ]);
  const reversed = new Set(reversalTargets.map((r) => r.reversalOfId));
  const gifts = donations.filter((d) => !reversed.has(d.id));
  const ytdStart = startOfYear();
  const fundTotals = new Map<string, number>();
  let total = 0;
  let ytd = 0;
  for (const d of gifts) {
    total += d.amountCents;
    if (d.receivedOn >= ytdStart) ytd += d.amountCents;
    for (const s of d.splits) fundTotals.set(s.fund.name, (fundTotals.get(s.fund.name) ?? 0) + s.amountCents);
  }
  return {
    totalCents: total,
    ytdCents: ytd,
    count: gifts.length,
    byFund: [...fundTotals.entries()].map(([name, amountCents]) => ({ name, amountCents })).sort((a, b) => b.amountCents - a.amountCents),
    recent: gifts.slice(0, opts.recentTake ?? 8).map((d) => ({
      date: ymd(d.receivedOn),
      amountCents: d.amountCents,
      method: d.method,
      status: d.status,
      funds: d.splits.map((s) => `${s.fund.name}: ${money(s.amountCents)}`),
    })),
  };
}

function givingCard(title: string, subtitle: string, agg: GivingAgg, personLabel?: string): AiReportCard {
  return {
    kind: "giving_summary",
    title,
    subtitle,
    stats: [
      { label: personLabel ? `${personLabel} — YTD` : "YTD total", value: fmtN(agg.ytdCents) },
      { label: "All-time", value: fmtN(agg.totalCents) },
      { label: "Gifts", value: String(agg.count) },
    ],
    table: {
      columns: ["Date", "Amount", "Method", "Funds"],
      rows: agg.recent.map((g) => [g.date, fmtN(g.amountCents), g.method, g.funds.join(", ") || "—"]),
    },
    csv: {
      name: "giving-summary",
      columns: ["Date", "Amount (NGN)", "Method", "Status", "Funds"],
      rows: agg.recent.map((g) => [g.date, (g.amountCents / 100).toFixed(2), g.method, g.status, g.funds.join("; ")]),
    },
  };
}

// ── the tool catalog ─────────────────────────────────────────────────────────

export const AI_TOOLS: AiToolDef[] = [
  {
    name: "getMyProfile",
    label: "Your profile",
    description: "The current user's own profile: name, lifecycle stage, household, groups, tags.",
    argsSpec: "{} — no arguments",
    run: async (_args, ctx) => {
      if (!ctx.user.personId) {
        return { ok: true, rows: 0, forModel: "The user has no linked person record in the directory." };
      }
      const detail = await getPersonDetail(ctx.user, ctx.user.personId);
      const p = detail.person;
      const card: AiReportCard = {
        kind: "profile",
        title: `${p.firstName} ${p.lastName}`,
        subtitle: [p.lifecycleStage, detail.household?.name].filter(Boolean).join(" · "),
        table: detail.groups.length
          ? { columns: ["Group", "Role"], rows: detail.groups.map((g) => [g.name, g.role]) }
          : undefined,
      };
      return {
        ok: true,
        rows: 1,
        card,
        forModel: `User's profile: ${p.firstName} ${p.lastName}${p.preferredName ? ` (prefers ${p.preferredName})` : ""}, stage "${p.lifecycleStage}", membership "${p.membershipStatus}". Household: ${detail.household?.name ?? "none"}. Groups: ${detail.groups.map((g) => `${g.name} (${g.role})`).join(", ") || "none"}.`,
      };
    },
  },
  {
    name: "getPersonProfile",
    label: "Person profile",
    description: "Look up a person's directory profile (what the People module shows this viewer). Giving/care sections follow the viewer's permissions automatically.",
    argsSpec: '{ "personId": "<id>" } — required',
    anyOf: ["people.view"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["people.view"])) return deniedResult("getPersonProfile");
      const personId = String(args.personId ?? "").trim();
      if (!personId) throw badRequest("personId is required.");
      const detail = await getPersonDetail(ctx.user, personId);
      const p = detail.person;
      // data minimization: only directory-level fields enter model context
      return {
        ok: true,
        rows: 1,
        card: {
          kind: "profile",
          title: `${p.firstName} ${p.lastName}`,
          subtitle: [p.lifecycleStage, detail.household?.name].filter(Boolean).join(" · "),
          table: detail.groups.length ? { columns: ["Group", "Role"], rows: detail.groups.map((g) => [g.name, g.role]) } : undefined,
        },
        forModel: `Person: ${p.firstName} ${p.lastName}, stage "${p.lifecycleStage}", membership "${p.membershipStatus}". Household: ${detail.household?.name ?? "none"} (${detail.household?.members.map((m) => `${m.name} — ${m.role}`).join(", ") ?? "no members"}). Groups: ${detail.groups.map((g) => `${g.name} (${g.role})`).join(", ") || "none"}. Giving visible to this viewer: ${detail.giving.visible ? `yes — total ${money(detail.giving.total ?? 0)}` : "no (hidden by permissions)"}.`,
      };
    },
  },
  {
    name: "getMyGivingSummary",
    label: "Your giving",
    description: "The current user's OWN giving history and totals (YTD, all-time, by fund, recent gifts). Always scoped to self — a personId argument is ignored by design.",
    argsSpec: '{ "personId": "IGNORED" } — the server forces this tool to the signed-in user',
    anyOf: ["giving.view.own"],
    run: async (_args, ctx) => {
      if (!assertPerm(ctx, ["giving.view.own"])) return deniedResult("getMyGivingSummary");
      if (!ctx.user.personId) return { ok: true, rows: 0, forModel: "The user has no linked person record, so no giving history exists." };
      // hard scope: personId forced to self, mirroring scopeGivingQuery's rule
      const agg = await givingAggregate(ctx.user.orgId, scopeGivingQuery(ctx.user, { orgId: ctx.user.orgId, personId: ctx.user.personId }));
      return {
        ok: true,
        rows: agg.count,
        card: givingCard("My giving", `YTD ${new Date().getFullYear()} · posted gifts`, agg),
        forModel: `The user's own giving — YTD ${new Date().getFullYear()}: ${money(agg.ytdCents)}; all-time: ${money(agg.totalCents)} across ${agg.count} posted gifts. By fund: ${agg.byFund.map((f) => `${f.name} ${money(f.amountCents)}`).join(", ") || "none"}. Recent: ${agg.recent.map((g) => `${g.date} ${money(g.amountCents)} (${g.funds.join(", ") || "unassigned"})`).join("; ") || "none"}.`,
      };
    },
  },
  {
    name: "getGivingSummary",
    label: "Giving records",
    description: "Church-wide giving totals for a date range, or an individual's giving when personId is provided. Requires viewing everyone's giving records.",
    argsSpec: '{ "personId"?: "<id>", "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" }',
    anyOf: ["giving.view.all"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["giving.view.all"])) return deniedResult("getGivingSummary");
      const personId = typeof args.personId === "string" && args.personId.trim() ? args.personId.trim() : null;
      if (personId) {
        const person = await db.person.findFirst({ where: { id: personId, orgId: ctx.user.orgId, deletedAt: null } });
        if (!person) throw notFound("Person not found.");
        const agg = await givingAggregate(ctx.user.orgId, { orgId: ctx.user.orgId, personId });
        const name = `${person.firstName} ${person.lastName}`;
        return {
          ok: true,
          rows: agg.count,
          card: givingCard(`${name}'s giving`, "Posted gifts · all time", agg, name),
          forModel: `Giving for ${name} — YTD: ${money(agg.ytdCents)}; all-time: ${money(agg.totalCents)} across ${agg.count} gifts. By fund: ${agg.byFund.map((f) => `${f.name} ${money(f.amountCents)}`).join(", ") || "none"}. Recent: ${agg.recent.map((g) => `${g.date} ${money(g.amountCents)}`).join("; ") || "none"}.`,
        };
      }
      const year = new Date().getFullYear();
      const from = typeof args.from === "string" && args.from ? args.from : `${year}-01-01`;
      const to = typeof args.to === "string" && args.to ? args.to : ymd(addDays(new Date(), 1));
      const agg = await givingAggregate(ctx.user.orgId, { orgId: ctx.user.orgId, receivedOn: { gte: new Date(from), lte: new Date(`${to}T23:59:59`) } });
      const byMethod = new Map<string, number>();
      const all = await db.donation.findMany({ where: { orgId: ctx.user.orgId, status: "posted", receivedOn: { gte: new Date(from), lte: new Date(`${to}T23:59:59`) } }, select: { method: true, amountCents: true } });
      for (const d of all) byMethod.set(d.method, (byMethod.get(d.method) ?? 0) + d.amountCents);
      return {
        ok: true,
        rows: agg.count,
        card: givingCard("Church giving", `${dayStr(from)} – ${dayStr(to)} · all donors`, agg),
        forModel: `Church-wide giving ${from} to ${to}: total ${money(agg.totalCents)} across ${agg.count} posted gifts. By fund: ${agg.byFund.map((f) => `${f.name} ${money(f.amountCents)}`).join(", ") || "none"}. By method: ${[...byMethod.entries()].map(([m, c]) => `${m} ${money(c)}`).join(", ") || "none"}.`,
      };
    },
  },
  {
    name: "getFundBalances",
    label: "Fund balances",
    description: "Net balance per fund (revenue minus expenses charged to the fund), all-time as of today.",
    argsSpec: "{} — no arguments",
    anyOf: ["giving.view.all", "accounting.view"],
    run: async (_args, ctx) => {
      if (!assertPerm(ctx, ["giving.view.all", "accounting.view"])) return deniedResult("getFundBalances");
      const rep = await reportFundBalances(ctx.user);
      const rows = rep.items.map((b) => ({ name: b.name, type: b.type, revenueCents: b.revenueCents, expenseCents: b.expenseCents, balanceCents: b.balanceCents }));
      return {
        ok: true,
        rows: rows.length,
        card: {
          kind: "fund_balances",
          title: "Fund balances",
          subtitle: `As of ${dayStr(rep.asOf)} · net = revenue − expenses`,
          table: { columns: ["Fund", "Received", "Spent", "Balance"], rows: rows.map((r) => [r.name, fmtN(r.revenueCents), fmtN(r.expenseCents), fmtN(r.balanceCents)]) },
          csv: { name: "fund-balances", columns: ["Fund", "Type", "Received (NGN)", "Spent (NGN)", "Balance (NGN)"], rows: rows.map((r) => [r.name, r.type, (r.revenueCents / 100).toFixed(2), (r.expenseCents / 100).toFixed(2), (r.balanceCents / 100).toFixed(2)]) },
        },
        forModel: `Fund balances as of ${dayStr(rep.asOf)}: ${rows.map((r) => `${r.name} balance ${money(r.balanceCents)} (received ${money(r.revenueCents)}, spent ${money(r.expenseCents)})`).join("; ") || "no fund activity yet"}.`,
      };
    },
  },
  {
    name: "generateFinancialReport",
    label: "Financial report",
    description: "Generate a structured financial report. reportType one of: statement_of_activities, statement_of_financial_position, fund_balances, giving_breakdown.",
    argsSpec: '{ "reportType": "statement_of_activities|statement_of_financial_position|fund_balances|giving_breakdown", "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" }',
    anyOf: ["accounting.view"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["accounting.view"])) return deniedResult("generateFinancialReport");
      const type = String(args.reportType ?? "").trim();
      const from = typeof args.from === "string" && args.from ? args.from : undefined;
      const to = typeof args.to === "string" && args.to ? args.to : undefined;
      if (type === "statement_of_activities") {
        const rep = await reportActivities(ctx.user, from, to);
        const subtitle = `${dayStr(rep.range.from)} – ${dayStr(rep.range.to)}`;
        return {
          ok: true,
          rows: rep.revenue.length + rep.expenses.length,
          card: {
            kind: "financial_report",
            title: "Statement of Activities",
            subtitle,
            stats: [
              { label: "Total income", value: fmtN(rep.totalRevenueCents) },
              { label: "Total expense", value: fmtN(rep.totalExpenseCents) },
              { label: "Net", value: fmtN(rep.netCents) },
            ],
            table: {
              columns: ["Fund", "Income", "Expense"],
              rows: [...rep.revenue.map((r) => [r.fundName, fmtN(r.amountCents), "—"] as (string | number)[]), ...rep.expenses.map((e) => [e.fundName, "—", fmtN(e.amountCents)] as (string | number)[])],
            },
            csv: {
              name: "statement-of-activities",
              columns: ["Fund", "Income (NGN)", "Expense (NGN)"],
              rows: [...rep.revenue.map((r) => [r.fundName, (r.amountCents / 100).toFixed(2), ""] as (string | number)[]), ...rep.expenses.map((e) => [e.fundName, "", (e.amountCents / 100).toFixed(2)] as (string | number)[])],
            },
          },
          forModel: `Statement of Activities ${subtitle}: total income ${money(rep.totalRevenueCents)}, total expense ${money(rep.totalExpenseCents)}, net ${money(rep.netCents)}. Income by fund: ${rep.revenue.map((r) => `${r.fundName} ${money(r.amountCents)}`).join(", ") || "none"}. Expenses by fund: ${rep.expenses.map((e) => `${e.fundName} ${money(e.amountCents)}`).join(", ") || "none"}. Program/admin/fundraising split: ${money(rep.byFunctional.program)}/${money(rep.byFunctional.admin)}/${money(rep.byFunctional.fundraising)}.`,
        };
      }
      if (type === "statement_of_financial_position") {
        const rep = await reportPosition(ctx.user);
        const subtitle = `As of ${dayStr(rep.asOf)}`;
        return {
          ok: true,
          rows: rep.assets.length + rep.liabilities.length + rep.netAssets.length,
          card: {
            kind: "financial_report",
            title: "Statement of Financial Position",
            subtitle,
            stats: [
              { label: "Assets", value: fmtN(rep.totalAssetsCents) },
              { label: "Liabilities", value: fmtN(rep.totalLiabilitiesCents) },
              { label: "Net assets", value: fmtN(rep.totalNetAssetsCents) },
            ],
            table: {
              columns: ["Account", "Class", "Balance"],
              rows: [
                ...rep.assets.map((a) => [a.name, "Asset", fmtN(a.balanceCents)] as (string | number)[]),
                ...rep.liabilities.map((l) => [l.name, "Liability", fmtN(l.balanceCents)] as (string | number)[]),
                ...rep.netAssets.map((n) => [n.name, `Net asset (${n.restriction})`, fmtN(n.balanceCents)] as (string | number)[]),
              ],
            },
            csv: { name: "statement-of-position", columns: ["Account", "Class", "Balance (NGN)"], rows: [...rep.assets.map((a) => [a.name, "asset", (a.balanceCents / 100).toFixed(2)]), ...rep.liabilities.map((l) => [l.name, "liability", (l.balanceCents / 100).toFixed(2)]), ...rep.netAssets.map((n) => [n.name, `net_asset ${n.restriction}`, (n.balanceCents / 100).toFixed(2)])] },
          },
          forModel: `Financial position as of ${subtitle}: assets ${money(rep.totalAssetsCents)}, liabilities ${money(rep.totalLiabilitiesCents)}, net assets ${money(rep.totalNetAssetsCents)} (undesignated surplus ${money(rep.undesignatedSurplusCents)}).`,
        };
      }
      if (type === "fund_balances") {
        const rep = await reportFundBalances(ctx.user);
        return {
          ok: true,
          rows: rep.items.length,
          card: {
            kind: "fund_balances",
            title: "Fund balances",
            subtitle: `As of ${dayStr(rep.asOf)}`,
            table: { columns: ["Fund", "Received", "Spent", "Balance"], rows: rep.items.map((b) => [b.name, fmtN(b.revenueCents), fmtN(b.expenseCents), fmtN(b.balanceCents)]) },
            csv: { name: "fund-balances", columns: ["Fund", "Received (NGN)", "Spent (NGN)", "Balance (NGN)"], rows: rep.items.map((b) => [b.name, (b.revenueCents / 100).toFixed(2), (b.expenseCents / 100).toFixed(2), (b.balanceCents / 100).toFixed(2)]) },
          },
          forModel: `Fund balances: ${rep.items.map((b) => `${b.name} ${money(b.balanceCents)}`).join("; ") || "no activity"}.`,
        };
      }
      if (type === "giving_breakdown") {
        const rep = await reportGivingBreakdown(ctx.user, from, to);
        const subtitle = `${dayStr(rep.range.from)} – ${dayStr(rep.range.to)}`;
        const byType = rep.items as { type: string; amountCents: number; count: number }[];
        const TYPE_LABELS: Record<string, string> = { tithe: "Tithe", general: "General", designated: "Designated", restricted: "Restricted", building: "Building", missions: "Missions" };
        return {
          ok: true,
          rows: byType.length,
          card: {
            kind: "financial_report",
            title: "Giving breakdown",
            subtitle,
            stats: [
              { label: "Total giving", value: fmtN(rep.totalCents) },
              { label: "Gifts", value: String(rep.giftCount) },
            ],
            table: { columns: ["Fund type", "Received", "Gifts"], rows: byType.map((r) => [TYPE_LABELS[r.type] ?? r.type, fmtN(r.amountCents), r.count]) },
            csv: { name: "giving-breakdown", columns: ["Fund type", "Received (NGN)", "Gifts"], rows: byType.map((r) => [TYPE_LABELS[r.type] ?? r.type, (r.amountCents / 100).toFixed(2), r.count]) },
          },
          forModel: `Giving breakdown ${subtitle}: total ${money(rep.totalCents)} across ${rep.giftCount} gifts. By fund type: ${byType.map((r) => `${TYPE_LABELS[r.type] ?? r.type} ${money(r.amountCents)} (${r.count} gifts)`).join(", ") || "none"}.`,
        };
      }
      throw badRequest(`Unknown reportType "${type}". Use statement_of_activities, statement_of_financial_position, fund_balances, or giving_breakdown.`);
    },
  },
  {
    name: "getGivingTrend",
    label: "Giving trend",
    description: "Monthly giving totals for the last N months (default 6, max 36), plus YTD vs last year.",
    argsSpec: '{ "months"?: 6 }',
    anyOf: ["reports.view"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["reports.view"])) return deniedResult("getGivingTrend");
      const months = Math.min(36, Math.max(1, Math.round(Number(args.months) || 6)));
      const rep = await givingReport(ctx.user, months);
      const series = rep.series.slice(-months);
      const changePct = rep.ytdLastYearCents ? Math.round(((rep.ytdCents - rep.ytdLastYearCents) / rep.ytdLastYearCents) * 100) : null;
      return {
        ok: true,
        rows: series.length,
        card: {
          kind: "financial_report",
          title: "Giving trend",
          subtitle: `Last ${series.length} months · YTD vs last year`,
          stats: [
            { label: "YTD", value: fmtN(rep.ytdCents) },
            { label: "Same period last year", value: fmtN(rep.ytdLastYearCents) },
            { label: "Avg / week", value: fmtN(rep.avgWeeklyCents) },
          ],
          table: { columns: ["Month", "Total"], rows: series.map((s) => [s.label, fmtN(s.totalCents)]) },
          csv: { name: "giving-trend", columns: ["Month", "Total (NGN)"], rows: series.map((s) => [s.label, (s.totalCents / 100).toFixed(2)]) },
        },
        forModel: `Giving trend: YTD ${money(rep.ytdCents)} vs ${money(rep.ytdLastYearCents)} the same period last year${changePct !== null ? ` (${changePct >= 0 ? "up" : "down"} ${Math.abs(changePct)}%)` : ""}; weekly average ${money(rep.avgWeeklyCents)}. Last months: ${series.map((s) => `${s.label} ${money(s.totalCents)}`).join(", ") || "no data"}. Top funds YTD: ${rep.topFunds.map((f) => `${f.fund} ${money(f.totalCents)}`).join(", ") || "none"}.`,
      };
    },
  },
  {
    name: "getAttendanceTrends",
    label: "Attendance trends",
    description: "Weekly attendance headcount for the last N weeks (default 8, max 52), with adult/kid split and per-service averages.",
    argsSpec: '{ "weeks"?: 8 }',
    anyOf: ["reports.view"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["reports.view"])) return deniedResult("getAttendanceTrends");
      const weeks = Math.min(52, Math.max(1, Math.round(Number(args.weeks) || 8)));
      const rep = await attendanceReport(ctx.user, weeks);
      const series = rep.series.slice(-weeks);
      const avg = series.length ? Math.round(series.reduce((a, s) => a + s.headcount, 0) / series.length) : 0;
      const last = series.length ? series[series.length - 1] : null;
      return {
        ok: true,
        rows: series.length,
        card: {
          kind: "attendance",
          title: "Attendance trends",
          subtitle: `Last ${series.length} weeks`,
          stats: [
            { label: "Avg weekly", value: String(avg) },
            { label: "Latest week", value: last ? `${last.label}: ${last.headcount}` : "—" },
          ],
          table: { columns: ["Week", "Headcount", "Adults", "Kids"], rows: series.map((s) => [s.label, s.headcount, s.uniqueAdults, s.uniqueKids]) },
          csv: { name: "attendance-trend", columns: ["Week start", "Headcount", "Adults", "Kids"], rows: series.map((s) => [ymd(s.weekStart), s.headcount, s.uniqueAdults, s.uniqueKids]) },
        },
        forModel: `Attendance over the last ${series.length} weeks — average headcount ${avg}. Weekly: ${series.map((s) => `${s.label} ${s.headcount}`).join(", ") || "no events"}. By service avg: ${rep.byCampusByService.map((b) => `${b.name} ${b.avgHeadcount}`).join(", ") || "n/a"}.`,
      };
    },
  },
  {
    name: "getHouseholdFamily",
    label: "Family / household",
    description: "A person's household members, guardians, and dependents (same visibility rules as the People module's Family tab).",
    argsSpec: '{ "personId": "<id>" } — required',
    anyOf: ["people.view"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["people.view"])) return deniedResult("getHouseholdFamily");
      const personId = String(args.personId ?? "").trim();
      if (!personId) throw badRequest("personId is required.");
      const detail = await getPersonDetail(ctx.user, personId);
      const fam = detail.household;
      return {
        ok: true,
        rows: fam?.members.length ?? 0,
        card: fam
          ? {
              kind: "profile",
              title: fam.name,
              subtitle: "Household",
              table: { columns: ["Name", "Role"], rows: fam.members.map((m) => [m.name + (m.isThisPerson ? " (this person)" : ""), m.role]) },
            }
          : { kind: "profile", title: detail.person.firstName + " " + detail.person.lastName, subtitle: "No household on file" },
        forModel: `Household of ${detail.person.firstName} ${detail.person.lastName}: ${fam ? `${fam.name} — members: ${fam.members.map((m) => `${m.name} (${m.role})`).join(", ")}` : "no household on file"}. Guardians: ${detail.guardians.map((g) => `${g.name} (${g.relationshipType})`).join(", ") || "none"}. Dependents: ${detail.dependents.map((d) => `${d.name} (${d.relationshipType})`).join(", ") || "none"}.`,
      };
    },
  },
  {
    name: "getCareCaseSummary",
    label: "Care cases",
    description: "Summarize pastoral care cases the viewer's role can see (confidentiality tiers enforced by the Care module's own scoping). Never available to plain members.",
    argsSpec: '{ "personId"?: "<id>", "urgency"?: "low|normal|high|urgent", "status"?: "open|closed" }',
    anyOf: ["care.view"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["care.view"])) return deniedResult("getCareCaseSummary");
      const q: Record<string, string> = {};
      if (typeof args.personId === "string" && args.personId.trim()) q.personId = args.personId.trim();
      if (typeof args.urgency === "string" && args.urgency.trim()) q.urgency = args.urgency.trim();
      if (typeof args.status === "string" && args.status.trim()) q.status = args.status.trim();
      const rep = await listCases(ctx.user, q);
      const items = rep.items.slice(0, 20);
      return {
        ok: true,
        rows: items.length,
        card: {
          kind: "care_cases",
          title: "Care cases",
          subtitle: `${items.length} shown · confidentiality tiers respected`,
          table: { columns: ["Person", "Type", "Urgency", "Status", "Opened"], rows: items.map((c) => [c.person.name, c.type, c.urgency, c.status, dayStr(c.openedAt)]) },
        },
        forModel: `Care cases visible to this viewer: ${items.map((c) => `${c.person.name} — ${c.type}, urgency ${c.urgency}, ${c.status} (opened ${dayStr(c.openedAt)})`).join("; ") || "none"}. NOTE: case notes and pastors-tier details are not exposed through this tool.`,
      };
    },
  },
  {
    name: "createCareReferral",
    label: "Create care referral",
    description: "Open a pastoral care case for a person (follow-up flag with a note). Use for staff-flagged concerns. For safeguarding emergencies the platform escalates automatically.",
    argsSpec: '{ "personId": "<id>", "note": "what was observed", "urgency"?: "low|normal|high|urgent" }',
    anyOf: ["care.create"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["care.create"])) return deniedResult("createCareReferral");
      const personId = String(args.personId ?? "").trim();
      const note = String(args.note ?? "").trim();
      if (!personId || !note) throw badRequest("personId and note are required.");
      const urgency = ["low", "normal", "high", "urgent"].includes(String(args.urgency)) ? String(args.urgency) : "normal";
      const person = await db.person.findFirst({ where: { id: personId, orgId: ctx.user.orgId, deletedAt: null } });
      if (!person) throw notFound("Person not found.");
      const c = await createCase(
        ctx.user,
        { personId, type: "follow_up", summary: note.slice(0, 500), urgency, confidentialityTier: "staff" },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      );
      return {
        ok: true,
        rows: 1,
        forModel: `Care referral created: case ${c.id} for ${c.person.name} (follow-up, urgency ${c.urgency}, tier ${c.confidentialityTier}). The care team will see it in the Care module.`,
      };
    },
  },
  {
    name: "bibleLookup",
    label: "Bible lookup",
    description: "Fetch EXACT scripture text for a reference (e.g. 'Romans 8:28') or topic (e.g. 'anxiety') from the local World English Bible dataset. Quote results verbatim with the citation.",
    argsSpec: '{ "reference_or_topic": "John 3:16" } — required',
    run: async (args) => {
      const q = String(args.reference_or_topic ?? args.reference ?? args.topic ?? "").trim();
      if (!q) throw badRequest("reference_or_topic is required.");
      const hit = lookup(q);
      if (!hit) {
        return {
          ok: false,
          rows: 0,
          forModel: `No exact text for "${q}" in the verified local dataset. Discuss the topic from general knowledge WITHOUT presenting remembered text as a direct quotation, cite the reference (Book Chapter:Verse), and encourage looking it up in a printed Bible or app.`,
        };
      }
      return {
        ok: true,
        rows: 1,
        forModel: `EXACT TEXT — ${hit.reference} (WEB, public domain): "${hit.text}" Quote this verbatim with the citation and note the translation is WEB.`,
      };
    },
  },
  {
    name: "getUpcomingEvents",
    label: "Upcoming events",
    description: "Upcoming events and services for the next N days (default 14).",
    argsSpec: '{ "days"?: 14 }',
    anyOf: ["events.view"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["events.view"])) return deniedResult("getUpcomingEvents");
      const days = Math.min(90, Math.max(1, Math.round(Number(args.days) || 14)));
      const from = ymd(new Date());
      const to = ymd(addDays(new Date(), days));
      const rep = await listEvents(ctx.user, { from, to });
      const items = (rep.items ?? []).slice(0, 12);
      return {
        ok: true,
        rows: items.length,
        card: {
          kind: "events",
          title: "Upcoming events",
          subtitle: `Next ${days} days`,
          table: { columns: ["Event", "When", "Status"], rows: items.map((e) => [e.name, `${dayStr(e.startsAt)} ${new Date(e.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`, e.status]) },
        },
        forModel: `Upcoming events (next ${days} days): ${items.map((e) => `${e.name} on ${dayStr(e.startsAt)} at ${new Date(e.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} (${e.status})`).join("; ") || "none scheduled"}.`,
      };
    },
  },
  {
    name: "getMyServingSchedule",
    label: "Your serving schedule",
    description: "The current user's own upcoming volunteer assignments (next 60 days). Always scoped to self.",
    argsSpec: "{} — no arguments",
    run: async (_args, ctx) => {
      if (!ctx.user.personId) return { ok: true, rows: 0, forModel: "The user has no linked person record, so there is no serving schedule." };
      const me = await getPortalMe(ctx.user);
      const items = me.schedule ?? [];
      return {
        ok: true,
        rows: items.length,
        card: {
          kind: "schedule",
          title: "My serving schedule",
          subtitle: "Next 60 days",
          table: { columns: ["When", "Role", "Event", "Status"], rows: items.map((a) => [`${dayStr(a.startsAt)} ${new Date(a.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`, a.roleName, a.eventName ?? "—", a.status]) },
        },
        forModel: `The user's upcoming serving assignments: ${items.map((a) => `${a.roleName} at ${a.eventName ?? "event"} on ${dayStr(a.startsAt)} (${a.status})`).join("; ") || "none in the next 60 days"}.`,
      };
    },
  },
  {
    name: "getBillsDue",
    label: "Bills due",
    description: "Open vendor bills due within the next N days (default 7), or already overdue.",
    argsSpec: '{ "days"?: 7 }',
    anyOf: ["accounting.view"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["accounting.view"])) return deniedResult("getBillsDue");
      const days = Math.min(90, Math.max(1, Math.round(Number(args.days) || 7)));
      const rep = await listBills(ctx.user);
      const horizon = addDays(new Date(), days);
      const items = rep.items
        .filter((b) => b.status === "open" && b.balanceCents > 0 && new Date(b.dueDate) <= horizon)
        .slice(0, 12);
      const total = items.reduce((a, b) => a + b.balanceCents, 0);
      return {
        ok: true,
        rows: items.length,
        card: {
          kind: "bills",
          title: "Bills due",
          subtitle: `Open bills due within ${days} day${days === 1 ? "" : "s"}`,
          stats: [{ label: "Total due", value: fmtN(total) }],
          table: { columns: ["Vendor", "Due", "Balance", "Status"], rows: items.map((b) => [b.vendor.name, dayStr(b.dueDate), fmtN(b.balanceCents), new Date(b.dueDate) < new Date() ? "overdue" : "upcoming"]) },
          csv: { name: "bills-due", columns: ["Vendor", "Due date", "Balance (NGN)"], rows: items.map((b) => [b.vendor.name, ymd(new Date(b.dueDate)), (b.balanceCents / 100).toFixed(2)]) },
        },
        forModel: `Bills due within ${days} days: ${items.map((b) => `${b.vendor.name} ${money(b.balanceCents)} due ${dayStr(b.dueDate)}${new Date(b.dueDate) < new Date() ? " (OVERDUE)" : ""}`).join("; ") || "none — all clear"}. Total: ${money(total)}.`,
      };
    },
  },

  // ═══ “AI Beyond the Chat” tools (same registration + permission-filter pattern) ═══
  {
    name: "explainRiskFlag",
    label: "Explain care flag",
    description: "Explain WHY a Care Radar flag exists: the exact signals, counts and thresholds that triggered it (deterministic — never a guess). Use before reaching out pastorally.",
    argsSpec: '{ "flagId": "..." }',
    anyOf: ["care.risk.view.all", "care.risk.view"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["care.risk.view"])) return deniedResult("explainRiskFlag");
      const flagId = String(args.flagId ?? "");
      if (!flagId) throw badRequest("flagId is required.");
      const data = await risk.loadFlagForExplanation(ctx.user, flagId);
      return {
        ok: true,
        rows: data.signals.length,
        card: {
          kind: "risk_flag",
          title: `Care Radar — ${data.level} flag`,
          subtitle: data.explanation,
          table: {
            columns: ["Signal", "Severity", "Reasoning"],
            rows: data.signals.map((s) => [s.type.replace(/_/g, " "), s.severity === 3 ? "urgent" : s.severity === 2 ? "elevated" : "watch", s.detailRestricted ?? s.detail]),
          },
        },
        forModel: `Deterministic Care Radar explanation (ground truth — do not add or soften facts): ${data.explanation} Present this warmly and pastorally; this is decision-support for a human, not a verdict about the person.`,
      };
    },
  },
  {
    name: "generateBoardReport",
    label: "Generate board report",
    description: "Generate a permission-scoped board/trustee report PDF (quarterly_trustee | annual_agm | financial_summary) for a period. Report data can never exceed what the requester may already see — aggregates only.",
    argsSpec: '{ "templateType": "quarterly_trustee", "periodStart": "YYYY-MM-DD", "periodEnd": "YYYY-MM-DD" }',
    anyOf: ["reports.board.generate"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["reports.board.generate"])) return deniedResult("generateBoardReport");
      const periodStart = String(args.periodStart ?? "");
      const periodEnd = String(args.periodEnd ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
        throw badRequest('periodStart and periodEnd must be "YYYY-MM-DD" dates.');
      }
      const templateType = String(args.templateType ?? "quarterly_trustee");
      if (!(boardreport.BOARD_REPORT_TYPES as readonly string[]).includes(templateType)) {
        throw badRequest(`templateType must be one of: ${boardreport.BOARD_REPORT_TYPES.join(" | ")}.`);
      }
      const result = await boardreport.generateBoardReport(
        ctx.user,
        { templateType: templateType as (typeof boardreport.BOARD_REPORT_TYPES)[number], periodStart, periodEnd, source: "chat" },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      );
      return {
        ok: true,
        rows: result.sections.length,
        card: {
          kind: "board_report",
          title: result.templateName,
          subtitle: `${periodStart} → ${periodEnd} · AI-assisted — human-reviewed · aggregate-only`,
          stats: [{ label: "Sections", value: String(result.sections.length) }, { label: "Status", value: "Ready" }],
          table: { columns: ["Included section", ""], rows: result.sections.map((s) => [s, ""]) },
        },
        forModel: `Board report generated (id ${result.id}). Included sections: ${result.sections.join(", ")}. Scope notes: ${result.scopeNotes.join(" | ") || "none"}. Download link for the user: ${result.downloadUrl} (relative to /api/v1). Remind the user the report is AI-assisted and aggregate-only, and to review before sharing with trustees.`,
      };
    },
  },
  {
    name: "generateSermonDraft",
    label: "Draft a sermon",
    description: "Create a sermon with an AI draft outline, curated cross-references, illustration prompts and worship songs matched from the REAL church song library (songs are never invented). Human edits and approves everything.",
    argsSpec: '{ "title": "...", "theme": "...", "scriptureRef": "...", "lengthMinutes"?: 35, "audienceNotes"?: "..." }',
    anyOf: ["sermon.create"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["sermon.create"])) return deniedResult("generateSermonDraft");
      const theme = String(args.theme ?? args.title ?? "").slice(0, 200);
      if (!theme) throw badRequest("A theme or title is required.");
      const title = String(args.title ?? theme).slice(0, 200);
      const created = await sermon.upsertSermon(
        ctx.user,
        { title, theme, primaryScriptureRef: args.scriptureRef ? String(args.scriptureRef).slice(0, 120) : undefined },
        {},
      );
      const gen = await sermon.generateDraft(
        ctx.user,
        created.id!,
        {
          theme,
          scriptureRef: args.scriptureRef ? String(args.scriptureRef) : undefined,
          lengthMinutes: Number(args.lengthMinutes) || 35,
          audienceNotes: args.audienceNotes ? String(args.audienceNotes).slice(0, 500) : undefined,
          sections: ["outline", "crossRefs", "illustrations", "songs"],
        },
        {},
      );
      return {
        ok: true,
        rows: (gen.outline?.points.length ?? 0) + gen.songs.length,
        card: {
          kind: "sermon_draft",
          title: `Draft v${gen.versionNumber} — ${gen.outline?.bigIdea || theme}`,
          subtitle: gen.outline ? `${gen.outline.points.length} points · ready for your edits in Sermon Studio` : "Open Sermon Studio to edit",
          table: {
            columns: ["Section", "Detail"],
            rows: [
              ["Big idea", gen.outline?.bigIdea ?? "—"],
              ...((gen.outline?.points ?? []).map((p, i) => [`${i + 1}. ${p.title}`, [p.scripture, ...p.subpoints].filter(Boolean).join(" — ")]) as (string | number)[][]),
              ...gen.songs.slice(0, 4).map((s) => [`♪ ${s.title}`, s.matchReason] as (string | number)[]),
            ],
          },
        },
        forModel: `A sermon "${title}" (id ${created.id}) was created with AI draft v${gen.versionNumber}. Big idea: ${gen.outline?.bigIdea ?? "—"}. Points: ${(gen.outline?.points ?? []).map((p, i) => `${i + 1}) ${p.title}`).join(" ")}. Songs matched from the real library: ${gen.songs.map((s) => s.title).join(", ") || "none"}. Direct the user to Sermon Studio to edit, regenerate sections, or export preaching notes. Emphasize it is a draft for their review — never preach it unreviewed.`,
      };
    },
  },
  {
    name: "whoIsFreeToServe",
    label: "Who's free to serve",
    description: "List which volunteers are available to serve on a date, honoring blockouts, rest windows and monthly limits (deterministic — real constraint data).",
    argsSpec: '{ "date": "YYYY-MM-DD" }',
    anyOf: ["schedule.assign", "serving.schedule.manage"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["schedule.assign", "serving.schedule.manage"])) return deniedResult("whoIsFreeToServe");
      const date = String(args.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('date must be "YYYY-MM-DD".');
      const res = await rota.whoIsFree(ctx.user, date);
      return {
        ok: true,
        rows: res.items.length,
        card: {
          kind: "serving",
          title: `Availability — ${date}`,
          subtitle: `${res.items.filter((i) => i.available).length} of ${res.rosterSize} roster volunteers available`,
          table: {
            columns: ["Volunteer", "Roles", "Status"],
            rows: res.items.map((i) => [i.name, i.roleNames.join(", ") || "any", i.available ? "available" : i.reason]),
          },
        },
        forModel: `Availability on ${date} (ground truth from the serving engine): ${res.items.map((i) => `${i.name} (${i.roleNames.join("/") || "any role"}) — ${i.available ? "AVAILABLE" : i.reason}`).join("; ") || "no roster volunteers configured yet"}.`,
      };
    },
  },
  {
    name: "explainAssignmentConflict",
    label: "Explain rota slot",
    description: "Explain why a rota slot is unfilled or why a specific volunteer was/wasn't chosen — grounded strictly in the scheduling engine's constraint data (blockouts, rest windows, monthly limits, fairness).",
    argsSpec: '{ "eventId": "...", "roleId": "..." }',
    anyOf: ["schedule.assign", "serving.schedule.manage"],
    run: async (args, ctx) => {
      if (!assertPerm(ctx, ["schedule.assign", "serving.schedule.manage"])) return deniedResult("explainAssignmentConflict");
      const eventId = String(args.eventId ?? "");
      const roleId = String(args.roleId ?? "");
      if (!eventId || !roleId) throw badRequest("eventId and roleId are required.");
      const ex = await rota.explainSlot(ctx.user.orgId, eventId, roleId);
      return {
        ok: true,
        rows: ex.exclusions.length,
        card: {
          kind: "serving",
          title: `${ex.roleName} — ${ex.eventName}`,
          subtitle: ex.status === "filled" && ex.chosen ? `Assigned: ${ex.chosen.name}` : "Unfilled slot",
          table: {
            columns: ["Volunteer", "Why not chosen"],
            rows: ex.status === "filled" && ex.chosen
              ? [[ex.chosen.name, `chosen — last served ${ex.chosen.daysSinceLastServed ?? "never"}, ${ex.chosen.servesLast90}× in 90d, ${ex.chosen.servesThisMonth}/${ex.chosen.maxTimesPerMonth} this month`], ...ex.exclusions.map((e) => [e.name, e.reason] as (string | number)[])]
              : ex.exclusions.map((e) => [e.name, e.reason] as (string | number)[]),
          },
        },
        forModel: `Ground truth from the scheduling engine for role "${ex.roleName}" on "${ex.eventName}": ${ex.facts.join(" ")} Summarize this faithfully — do not invent reasons or names beyond this list.`,
      };
    },
  },
];

export function toolByName(name: string): AiToolDef | undefined {
  return AI_TOOLS.find((t) => t.name === name);
}

/**
 * Permission-filtered tool catalog — called BEFORE the LLM ever sees the tool
 * list. A member's schema does not contain getGivingSummary AT ALL (not just
 * rejected: absent), which shrinks hallucination/jailbreak surface.
 */
export function filterToolsFor(user: SessionUser): AiToolDef[] {
  return AI_TOOLS.filter((t) => !t.anyOf?.length || canAny(user, t.anyOf));
}

export function toolCatalogLines(tools: AiToolDef[]): string[] {
  return tools.map((t) => `${t.name}(${t.argsSpec}) — ${t.description}`);
}

/** Public-safe list for the client UI (transparency chips + suggested prompts). */
export function toolInfosFor(user: SessionUser): { name: string; label: string; description: string }[] {
  return filterToolsFor(user).map((t) => ({ name: t.name, label: t.label, description: t.description }));
}

/** Execute one tool request with full defense-in-depth. */
export async function executeTool(name: string, rawArgs: unknown, ctx: AiToolContext): Promise<AiToolResult & { toolName: string }> {
  const tool = toolByName(name);
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  if (!tool) {
    return { toolName: name, ok: false, rows: 0, forModel: `Tool "${name}" does not exist. Tell the user you cannot do that.` };
  }
  let result: AiToolResult;
  let permOk = true;
  if (tool.anyOf?.length && !canAny(ctx.user, tool.anyOf)) {
    permOk = false;
    result = deniedResult(name);
  } else {
    try {
      result = await tool.run(args, ctx);
    } catch (err) {
      result = { ok: false, rows: 0, forModel: `The tool failed: ${err instanceof Error ? err.message : "unknown error"}. Apologize briefly and suggest the user retry or check the module directly.` };
    }
  }
  // compliance audit — every execution, allowed or denied
  await db.aiToolAuditLog.create({
    data: {
      orgId: ctx.user.orgId,
      conversationId: ctx.conversationId,
      userId: ctx.user.userId,
      toolName: name,
      arguments: JSON.stringify(args).slice(0, 2000),
      permissionCheckResult: permOk,
      rowsReturned: result.rows ?? 0,
    },
  }).catch(() => {});
  return { ...result, toolName: name };
}

/** Role-aware suggested prompts for the empty-conversation state. */
export function suggestedPromptsFor(user: SessionUser): string[] {
  const prompts: string[] = [];
  if (can(user, "giving.view.own")) prompts.push("How much have I given this year?");
  if (canAny(user, ["accounting.view", "giving.view.all"])) {
    prompts.push("Generate this month's fund balance report");
    prompts.push("Any bills due this week?");
  }
  if (can(user, "reports.view")) prompts.push("Summarize attendance trends this quarter");
  if (can(user, "giving.view.all")) prompts.push("Show the giving trend for the last 6 months");
  if (can(user, "events.view")) prompts.push("What's coming up on the church calendar?");
  prompts.push("What does the Bible say about anxiety?");
  prompts.push("I'm going through a hard season, can we talk?");
  return prompts.slice(0, 6);
}
