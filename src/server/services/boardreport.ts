import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, forbidden, notFound } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import { assertFeature } from "@/server/services/features";
import { attendanceReport, givingReport, newPeopleReport } from "@/server/services/reports";
import { reportPosition, reportFundBalances, reportActivities } from "@/server/services/accounting";
import { checklistFor } from "@/server/services/tenant/compliance";
import { money } from "@/server/services/giving";

function fmtDateS(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Board Reporting — natural-language-triggered, permission-scoped board packs.
 *
 * RBAC CONTRACT (the reason this feature exists):
 *  • Data is gathered through the SAME permission-scoped service functions the
 *    normal UI uses, with the REQUESTER'S REAL SESSION — never a privileged
 *    system account. Asking nicely in natural language cannot escalate privilege.
 *  • Section-level gates mirror the UI: giving/accounting figures only appear
 *    if the requester already holds `giving.view.all` or `accounting.view`
 *    (aggregate-only — the report NEVER contains individual donor line-items,
 *    even for viewers who could normally see them elsewhere).
 *  • Every generation stores a frozen `snapshotJson` (reproducible/auditable)
 *    plus `scopeNotes` documenting exactly which sections were included and why.
 *  • The Shepherd AI tool is only in the LLM catalog for users holding
 *    `reports.board.generate` (standard filterToolsFor path) and re-checked in
 *    executeTool. Every generation is audited.
 */

export const BOARD_REPORT_TYPES = ["quarterly_trustee", "annual_agm", "financial_summary"] as const;
export type BoardReportType = (typeof BOARD_REPORT_TYPES)[number];

export const BOARD_SECTIONS = {
  membership: "Membership snapshot & growth",
  attendance: "Attendance trends",
  giving_summary: "Giving by fund (aggregate)",
  accounting_position: "Financial position & expenses",
  compliance: "Compliance status",
} as const;
export type BoardSection = keyof typeof BOARD_SECTIONS;

export function defaultSectionsFor(type: BoardReportType): BoardSection[] {
  switch (type) {
    case "quarterly_trustee":
      return ["membership", "attendance", "giving_summary", "accounting_position", "compliance"];
    case "annual_agm":
      return ["membership", "attendance", "giving_summary", "accounting_position", "compliance"];
    case "financial_summary":
      return ["giving_summary", "accounting_position"];
  }
}

async function ensureSystemTemplates(orgId: string) {
  const count = await db.reportTemplate.count({ where: { orgId, isActive: true } });
  if (count > 0) return;
  await db.reportTemplate.createMany({
    data: BOARD_REPORT_TYPES.map((type) => ({
      orgId,
      name:
        type === "quarterly_trustee" ? "Quarterly Trustee Report" :
        type === "annual_agm" ? "Annual AGM Report" : "Financial Summary",
      type,
      sectionsJson: JSON.stringify(defaultSectionsFor(type)),
    })),
  });
}

export async function listTemplates(user: SessionUser) {
  await ensureSystemTemplates(user.orgId);
  const templates = await db.reportTemplate.findMany({
    where: { OR: [{ orgId: user.orgId }, { orgId: null }], isActive: true },
    orderBy: [{ orgId: "asc" }, { name: "asc" }],
  });
  return {
    items: templates.map((t) => ({
      id: t.id,
      orgId: t.orgId,
      name: t.name,
      type: t.type as BoardReportType,
      sections: JSON.parse(t.sectionsJson) as BoardSection[],
      isSystem: t.orgId === null,
    })),
  };
}

export async function upsertTemplate(
  user: SessionUser,
  input: { id?: string; name?: string; type?: BoardReportType; sections?: BoardSection[] },
  meta: { ip?: string; userAgent?: string },
) {
  if (!can(user, "reports.templates.manage")) throw forbidden('Requires "reports.templates.manage" permission.');
  if (!input.name?.trim()) throw badRequest("Template name is required.");
  const type = (input.type && BOARD_REPORT_TYPES.includes(input.type) ? input.type : "custom") as BoardReportType;
  const sections = (input.sections ?? defaultSectionsFor(type)).filter((s) => s in BOARD_SECTIONS);
  if (input.id) {
    const existing = await db.reportTemplate.findFirst({ where: { id: input.id, orgId: user.orgId } });
    if (!existing) throw notFound("Template not found.");
    await db.reportTemplate.update({
      where: { id: input.id },
      data: { name: input.name.trim(), type, sectionsJson: JSON.stringify(sections) },
    });
  } else {
    await db.reportTemplate.create({
      data: { orgId: user.orgId, name: input.name.trim(), type, sectionsJson: JSON.stringify(sections), createdByMembershipId: user.membershipId },
    });
  }
  await audit({ orgId: user.orgId, actor: user, action: "report.template_save", entityType: "report_template", entityId: input.id ?? "new", after: { name: input.name, type, sections }, ip: meta.ip, userAgent: meta.userAgent });
  return listTemplates(user);
}

export interface BoardSnapshot {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  orgName: string;
  requestedBy: string;
  sections: Partial<Record<BoardSection, unknown>>;
  scopeNotes: string[];
}

/**
 * Gather data through the requester's own session using existing scoped
 * services. Sections the requester cannot see through normal UI navigation
 * are EXCLUDED (never downsampled, never faked) and documented in scopeNotes.
 */
export async function gatherSnapshot(
  user: SessionUser,
  periodStart: Date,
  periodEnd: Date,
  sections: BoardSection[],
): Promise<BoardSnapshot> {
  const org = await db.organization.findUnique({
    where: { id: user.orgId },
    select: { name: true, settings: true, cacNumber: true, status: true, cacRegistrationDate: true, cacCertificateFileId: true, bankName: true, bankAccountNumberEnc: true, bankAccountName: true, ndpaAcknowledgedAt: true, trustees: { select: { idNumberEnc: true } } },
  });
  if (!org) throw notFound("Organization not found.");

  const snapshot: BoardSnapshot = {
    generatedAt: new Date().toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    orgName: org.name,
    requestedBy: user.name,
    sections: {},
    scopeNotes: [],
  };

  // People module — requires the same people.view the requester already has.
  if (sections.includes("membership")) {
    if (!can(user, "people.view")) {
      snapshot.scopeNotes.push("Membership: excluded — requester does not hold people.view.");
    } else {
      const [total, byStage, newPeople] = await Promise.all([
        db.person.count({ where: { orgId: user.orgId, status: "active" } }),
        db.person.groupBy({ by: ["lifecycleStage"], where: { orgId: user.orgId, status: "active" }, _count: { _all: true } }),
        newPeopleReport(user, Math.max(30, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000))),
      ]);
      snapshot.sections.membership = {
        totalActive: total,
        byStage: byStage.map((s) => ({ stage: s.lifecycleStage, count: s._count._all })),
        newInPeriod: { count: newPeople.firstTime.length, guestsToIntegrating: newPeople.guestsToIntegrating },
      };
    }
  }

  // Attendance — same report the Reports module shows (reports.view).
  if (sections.includes("attendance")) {
    if (!can(user, "reports.view")) {
      snapshot.scopeNotes.push("Attendance: excluded — requester does not hold reports.view.");
    } else {
      const weeks = Math.min(26, Math.max(4, Math.round((periodEnd.getTime() - periodStart.getTime()) / (7 * 86400000))));
      snapshot.sections.attendance = await attendanceReport(user, weeks);
    }
  }

  // Giving (AGGREGATE ONLY — never line-items). Included only when the
  // requester already sees these aggregates through their normal access:
  // giving.view.all (finance/ledger view) or accounting.view (aggregate oversight).
  if (sections.includes("giving_summary")) {
    if (can(user, "giving.view.all") || can(user, "accounting.view")) {
      const months = Math.min(36, Math.max(3, Math.round((periodEnd.getTime() - periodStart.getTime()) / (30 * 86400000))));
      const [trend, funds] = await Promise.all([
        givingReport(user, months),
        reportFundBalances(user),
      ]);
      snapshot.sections.giving_summary = {
        trend: (trend as { series?: unknown }).series ?? trend,
        fundsBalance: (funds as { items?: unknown }).items ?? funds,
        note: "Aggregate figures only — the board report never contains individual donor records.",
      };
      snapshot.scopeNotes.push(
        can(user, "giving.view.all")
          ? "Giving: aggregate totals included (requester holds giving.view.all)."
          : "Giving: aggregate totals included via accounting aggregate access (requester does NOT hold giving.view.all — no individual records).",
      );
    } else {
      snapshot.scopeNotes.push("Giving: excluded — requester holds neither giving.view.all nor accounting.view.");
    }
  }

  // Accounting position/expenses — accounting.view (same as Accounting dashboard).
  if (sections.includes("accounting_position")) {
    if (!can(user, "accounting.view")) {
      snapshot.scopeNotes.push("Financial position: excluded — requester does not hold accounting.view.");
    } else {
      const [position, activities] = await Promise.all([
        reportPosition(user, periodEnd.toISOString().slice(0, 10)),
        reportActivities(user, periodStart.toISOString().slice(0, 10), periodEnd.toISOString().slice(0, 10)),
      ]);
      snapshot.sections.accounting_position = { position, activities };
    }
  }

  // Compliance — checklist booleans only (never decrypted identifiers).
  if (sections.includes("compliance")) {
    const checklist = checklistFor({
      cacNumber: org.cacNumber,
      cacRegistrationDate: org.cacRegistrationDate,
      cacCertificateFileId: org.cacCertificateFileId,
      bankName: org.bankName,
      bankAccountNumberEnc: org.bankAccountNumberEnc,
      bankAccountName: org.bankAccountName,
      ndpaAcknowledgedAt: org.ndpaAcknowledgedAt,
      trustees: org.trustees,
    });
    snapshot.sections.compliance = {
      items: checklist.items,
      allDone: checklist.allDone,
      orgStatus: org.status,
      note: "Completion status only — document identifiers are never included in board packs.",
    };
    snapshot.scopeNotes.push("Compliance: completion booleans only (no document identifiers).");
  }

  return snapshot;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function tableHtml(columns: string[], rows: (string | number)[][]): string {
  if (!rows.length) return `<p class="muted">No data for this period.</p>`;
  return `<table><thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

/** Render the frozen snapshot into a clean, print-ready HTML document. */
export function renderBoardReportHtml(snapshot: BoardSnapshot, templateName: string): string {
  const s = snapshot.sections;
  const parts: string[] = [];

  if (s.membership) {
    const m = s.membership as { totalActive: number; byStage: { stage: string; count: number }[]; newInPeriod: { count: number } };
    parts.push(`<h2>Membership</h2>${tableHtml(["Metric", "Value"], [
      ["Active people", m.totalActive],
      ["New in period", m.newInPeriod?.count ?? 0],
      ...m.byStage.map((b) => [`Stage: ${b.stage}`, b.count] as (string | number)[]),
    ])}`);
  }
  if (s.attendance) {
    const a = s.attendance as { series?: { week?: string; label?: string; present?: number }[]; average?: number; summary?: unknown };
    const series = (a.series ?? []) as { week?: string; label?: string; present?: number }[];
    parts.push(`<h2>Attendance</h2>${tableHtml(["Week", "Present"], series.slice(-13).map((w) => [w.label ?? w.week ?? "—", w.present ?? 0]))}`);
  }
  if (s.giving_summary) {
    const g = s.giving_summary as { trend?: { month?: string; totalCents?: number }[]; fundsBalance?: { fund?: string; name?: string; balanceCents?: number }[]; note?: string };
    const trend = (g.trend ?? []) as { month?: string; totalCents?: number }[];
    const funds = (g.fundsBalance ?? []) as { fund?: string; name?: string; balanceCents?: number }[];
    parts.push(`<h2>Giving (aggregate)</h2>
      <p class="muted">${esc(g.note ?? "")}</p>
      ${tableHtml(["Month", "Total"], trend.slice(-12).map((t) => [t.month ?? "—", money(t.totalCents ?? 0)]))}
      <h3>Fund balances</h3>
      ${tableHtml(["Fund", "Balance"], funds.map((f) => [f.name ?? f.fund ?? "—", money(f.balanceCents ?? 0)]))}`);
  }
  if (s.accounting_position) {
    const p = s.accounting_position as { position?: Record<string, unknown>; activities?: Record<string, unknown> };
    const pos = (p.position ?? {}) as Record<string, number | { totalCents?: number }>;
    const row = (label: string, v: unknown): (string | number)[] => [label, money(typeof v === "number" ? v : (v as { totalCents?: number })?.totalCents ?? 0)];
    const act = (p.activities ?? {}) as { revenue?: { fundName?: string; amountCents?: number }[]; expenses?: { fundName?: string; amountCents?: number }[]; totalRevenueCents?: number; totalExpenseCents?: number; netCents?: number };
    parts.push(`<h2>Financial position (as of period end)</h2>${tableHtml(["Item", "Amount"], [
      row("Assets", pos.assets),
      row("Liabilities", pos.liabilities),
      row("Net assets", pos.netAssets),
    ])}`);
    parts.push(`<h3>Activity in period</h3>
      ${tableHtml(["Fund", "Revenue"], (act.revenue ?? []).map((r) => [r.fundName ?? "—", money(r.amountCents ?? 0)]))}
      ${tableHtml(["Fund", "Expenses"], (act.expenses ?? []).map((r) => [r.fundName ?? "—", money(r.amountCents ?? 0)]))}
      ${tableHtml(["Total", "Amount"], [["Total revenue", money(act.totalRevenueCents ?? 0)], ["Total expenses", money(act.totalExpenseCents ?? 0)], ["Net", money(act.netCents ?? 0)]])}`);
  }
  if (s.compliance) {
    const c = s.compliance as { items: { label: string; done: boolean }[]; allDone: boolean; orgStatus: string; note?: string };
    parts.push(`<h2>Compliance</h2>${tableHtml(["Requirement", "Status"], c.items.map((i) => [i.label, i.done ? "Complete" : "Outstanding"]))}
      <p class="muted">${esc(c.note ?? "")}</p>`);
  }

  const scopeNotes = snapshot.scopeNotes.length
    ? `<div class="scope"><h3>Scope & visibility notes</h3><ul>${snapshot.scopeNotes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(templateName)} — ${esc(snapshot.orgName)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1c1917; max-width: 800px; margin: 40px auto; padding: 0 24px; font-size: 14px; line-height: 1.55; }
  h1 { font-size: 26px; margin-bottom: 4px; } h2 { font-size: 18px; border-bottom: 1px solid #d6d3d1; padding-bottom: 4px; margin-top: 32px; }
  h3 { font-size: 15px; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #e7e5e4; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #78716c; }
  td:last-child, th:last-child { text-align: right; }
  .cover-meta { color: #57534e; font-size: 13px; }
  .muted { color: #78716c; font-size: 12px; }
  .scope { background: #f5f5f4; border: 1px solid #e7e5e4; border-radius: 8px; padding: 12px 16px; margin-top: 32px; }
  .ai-label { display: inline-block; background: #fef3c7; color: #92400e; border: 1px solid #fde68a; border-radius: 999px; padding: 2px 10px; font-size: 11px; font-weight: 600; }
  footer { margin-top: 40px; border-top: 1px solid #d6d3d1; padding-top: 12px; color: #78716c; font-size: 11px; }
  @media print { body { margin: 12mm auto; } }
</style></head>
<body>
  <h1>${esc(templateName)}</h1>
  <p class="cover-meta"><strong>${esc(snapshot.orgName)}</strong> · Period ${fmtDateS(snapshot.periodStart)} – ${fmtDateS(snapshot.periodEnd)}<br>
  Prepared for ${esc(snapshot.requestedBy)} on ${fmtDateS(snapshot.generatedAt)} · <span class="ai-label">AI-assisted — human-reviewed</span></p>
  ${parts.join("\n")}
  ${scopeNotes}
  <footer>Generated by ChurchOS Board Reporting · Figures frozen at generation time (auditable snapshot) · Aggregate-only: contains no individual donor or member records.</footer>
</body></html>`;
}

export async function generateBoardReport(
  user: SessionUser,
  input: { templateType?: BoardReportType; templateId?: string; periodStart: string; periodEnd: string; sections?: BoardSection[]; source?: "chat" | "screen" },
  meta: { ip?: string; userAgent?: string },
) {
  if (!can(user, "reports.board.generate")) throw forbidden('Requires "reports.board.generate" permission.');
  await assertFeature(user.orgId, "featureBoardReports");
  if (!can(user, "reports.view") && !can(user, "accounting.view")) {
    throw forbidden("Board reporting also requires reports.view or accounting.view to gather any data.");
  }

  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) throw badRequest("Invalid period dates.");
  if (periodEnd <= periodStart) throw badRequest("Period end must be after period start.");

  let templateName = "Board Report";
  let templateId: string | null = null;
  let sections: BoardSection[] = defaultSectionsFor("quarterly_trustee");
  if (input.templateId) {
    await ensureSystemTemplates(user.orgId);
    const t = await db.reportTemplate.findFirst({ where: { id: input.templateId, OR: [{ orgId: user.orgId }, { orgId: null }] } });
    if (!t) throw notFound("Template not found.");
    templateName = t.name;
    templateId = t.id;
    sections = JSON.parse(t.sectionsJson) as BoardSection[];
  } else if (input.templateType && BOARD_REPORT_TYPES.includes(input.templateType)) {
    await ensureSystemTemplates(user.orgId);
    const t = await db.reportTemplate.findFirst({ where: { orgId: user.orgId, type: input.templateType, isActive: true } });
    templateName = t?.name ?? input.templateType;
    templateId = t?.id ?? null;
    sections = t ? (JSON.parse(t.sectionsJson) as BoardSection[]) : defaultSectionsFor(input.templateType);
  }
  if (input.sections?.length) {
    // Section toggles only narrow the template (never widen beyond permission scope —
    // gatherSnapshot re-checks every section anyway).
    const allowed = new Set(sections);
    sections = sections.filter((s) => input.sections!.includes(s));
    if (sections.length === 0) sections = [...allowed];
  }

  const gen = await db.reportGeneration.create({
    data: {
      orgId: user.orgId,
      templateId,
      templateType: input.templateType ?? templateName,
      requestedByMembershipId: user.membershipId,
      requestedByName: user.name,
      periodStart,
      periodEnd,
      status: "generating",
    },
  });

  try {
    const snapshot = await gatherSnapshot(user, periodStart, periodEnd, sections);
    const html = renderBoardReportHtml(snapshot, templateName);
    await db.reportGeneration.update({
      where: { id: gen.id },
      data: { status: "ready", snapshotJson: JSON.stringify(snapshot), htmlSnapshot: html, generatedAt: new Date() },
    });
    await audit({
      orgId: user.orgId, actor: user, action: "report.board_generate", entityType: "report_generation", entityId: gen.id,
      after: { templateType: input.templateType ?? templateName, periodStart: input.periodStart, periodEnd: input.periodEnd, sections, scopeNotes: snapshot.scopeNotes, source: input.source ?? "screen" },
      ip: meta.ip, userAgent: meta.userAgent,
    });
    return {
      id: gen.id,
      status: "ready" as const,
      templateName,
      sections: Object.keys(snapshot.sections),
      scopeNotes: snapshot.scopeNotes,
      downloadUrl: `/api/v1/reports/board/${gen.id}/download`,
    };
  } catch (err) {
    await db.reportGeneration.update({ where: { id: gen.id }, data: { status: "failed" } }).catch(() => {});
    throw err;
  }
}

export async function listBoardReports(user: SessionUser) {
  if (!can(user, "reports.board.view") && !can(user, "reports.board.generate")) {
    throw forbidden('Requires "reports.board.view" permission.');
  }
  const items = await db.reportGeneration.findMany({
    where: { orgId: user.orgId },
    orderBy: { periodStart: "desc" },
    take: 50,
  });
  return {
    items: items.map((r) => ({
      id: r.id,
      templateType: r.templateType,
      requestedByName: r.requestedByName,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      status: r.status,
      generatedAt: r.generatedAt,
      downloadUrl: r.status === "ready" ? `/api/v1/reports/board/${r.id}/download` : null,
    })),
  };
}

export async function getBoardReport(user: SessionUser, id: string) {
  if (!can(user, "reports.board.view") && !can(user, "reports.board.generate")) {
    throw forbidden('Requires "reports.board.view" permission.');
  }
  const r = await db.reportGeneration.findFirst({ where: { id, orgId: user.orgId } });
  if (!r) throw notFound("Report not found.");
  return {
    id: r.id,
    templateType: r.templateType,
    requestedByName: r.requestedByName,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    status: r.status,
    generatedAt: r.generatedAt,
    snapshot: r.snapshotJson ? JSON.parse(r.snapshotJson) : null,
    html: r.htmlSnapshot,
  };
}

/** Serves the frozen HTML (print → PDF by the browser, same pattern as giving statements). */
export async function downloadBoardReport(user: SessionUser, id: string) {
  const r = await db.reportGeneration.findFirst({ where: { id, orgId: user.orgId } });
  if (!r) throw notFound("Report not found.");
  if (!can(user, "reports.board.view") && !can(user, "reports.board.generate")) {
    throw forbidden('Requires "reports.board.view" permission.');
  }
  if (r.status !== "ready" || !r.htmlSnapshot) throw notFound("Report is not ready.");
  return r.htmlSnapshot;
}
