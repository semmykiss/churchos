import { route } from "@/server/api/router";
import * as reports from "@/server/services/reports";

/**
 * Reports routes (thin controllers — all logic in services).
 * Everything below requires reports.view; the dashboard and dictionary
 * read the same definitions.
 */
export function registerReportRoutes() {
  route({
    method: "GET", pattern: "reports/this-week", permission: "reports.view",
    handler: async (ctx) => reports.thisWeekReport(ctx.user!),
  });

  route({
    method: "GET", pattern: "reports/attendance", permission: "reports.view",
    handler: async (ctx) => reports.attendanceReport(ctx.user!, Number(ctx.query.get("weeks") ?? 12)),
  });

  route({
    method: "GET", pattern: "reports/giving", permission: "reports.view",
    handler: async (ctx) => reports.givingReport(ctx.user!, Number(ctx.query.get("months") ?? 12)),
  });

  route({
    method: "GET", pattern: "reports/groups", permission: "reports.view",
    handler: async (ctx) => reports.groupsReport(ctx.user!),
  });

  route({
    method: "GET", pattern: "reports/volunteers", permission: "reports.view",
    handler: async (ctx) => reports.volunteersReport(ctx.user!),
  });

  route({
    method: "GET", pattern: "reports/new-people", permission: "reports.view",
    handler: async (ctx) => reports.newPeopleReport(ctx.user!, Number(ctx.query.get("days") ?? 30)),
  });

  route({
    method: "GET", pattern: "reports/metric-dictionary", permission: "reports.view",
    handler: async (ctx) => reports.metricDictionary(),
  });
}
