import { route } from "@/server/api/router";
import * as risk from "@/server/services/risk";
import * as boardreport from "@/server/services/boardreport";
import * as sermon from "@/server/services/sermon";
import * as rota from "@/server/services/rota";
import { featuresFor, FEATURE_KEYS } from "@/server/services/features";
import { badRequest, forbidden } from "@/server/http";
import { can } from "@/server/permissions";

/**
 * "AI Beyond the Chat" routes (thin controllers — logic lives in services).
 * Route-level permissions are the LEAST-privilege flat permission; services
 * re-check scoped rights per (user, target) as everywhere else in ChurchOS.
 */
export function registerAiBeyondRoutes() {
  // ── feature flags (any authenticated user; powers nav/UI gating) ──
  route({
    method: "GET", pattern: "features", permission: "",
    handler: async (ctx) => featuresFor(ctx.user!.orgId),
  });

  // ═══ CARE RADAR ═══
  route({
    method: "POST", pattern: "risk/recalculate", permission: "care.risk.manage", // plain viewers do not trigger scans; managers can force
    handler: async (ctx) => {
      const force = ctx.body?.force === true || ctx.query.get("force") === "1";
      // A forced (non-throttled) recalculation is a manager action; ordinary
      // viewers only trigger the throttled refresh.
      if (force && !can(ctx.user!, "care.risk.manage")) throw forbidden('Force recalculation requires "care.risk.manage".');
      return risk.recalculateRiskFlags(
        { orgId: ctx.user!.orgId, membershipId: ctx.user!.membershipId, name: ctx.user!.name },
        { force },
      );
    },
  });
  route({
    method: "GET", pattern: "risk/flags", permission: "", // scope checked in service (riskScope: view.all or led-groups view)
    handler: async (ctx) =>
      risk.listRiskFlags(ctx.user!, {
        status: ctx.query.get("status") ?? undefined,
        level: ctx.query.get("level") ?? undefined,
      }),
  });
  route({
    method: "GET", pattern: "risk/flags/person", permission: "people.view",
    handler: async (ctx) => {
      const personId = ctx.query.get("personId");
      if (!personId) throw badRequest("personId is required.");
      return risk.listFlagsForPerson(ctx.user!, personId);
    },
  });
  route({
    method: "GET", pattern: "risk/flags/:id", permission: "", // scope checked in service
    handler: async (ctx) => risk.getRiskFlag(ctx.user!, ctx.params.id),
  });
  route({
    method: "POST", pattern: "risk/flags/:id/acknowledge", permission: "care.risk.manage",
    handler: async (ctx) => risk.acknowledgeFlag(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
  route({
    method: "POST", pattern: "risk/flags/:id/progress", permission: "care.risk.manage",
    handler: async (ctx) => risk.startProgressFlag(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
  route({
    method: "POST", pattern: "risk/flags/:id/resolve", permission: "care.risk.manage",
    handler: async (ctx) => risk.resolveFlag(ctx.user!, ctx.params.id, String(ctx.body?.note ?? ""), { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
  route({
    method: "POST", pattern: "risk/flags/:id/dismiss", permission: "care.risk.manage",
    handler: async (ctx) => risk.dismissFlag(ctx.user!, ctx.params.id, String(ctx.body?.reason ?? ""), { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
  route({
    method: "POST", pattern: "risk/flags/:id/assign-task", permission: "care.risk.manage",
    handler: async (ctx) => risk.assignFollowUp(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
  route({
    method: "GET", pattern: "risk/rules", permission: "care.risk.manage",
    handler: async (ctx) => risk.getRules(ctx.user!),
  });
  route({
    method: "POST", pattern: "risk/rules/preview", permission: "care.risk.manage",
    handler: async (ctx) => risk.previewRules(ctx.user!, ctx.body?.rules ?? []),
  });
  route({
    method: "POST", pattern: "risk/rules", permission: "care.risk.manage",
    handler: async (ctx) => risk.updateRules(ctx.user!, ctx.body?.rules ?? [], { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  // ═══ BOARD REPORTS ═══
  route({
    method: "GET", pattern: "reports/board/templates", permission: "reports.board.view",
    handler: async (ctx) => boardreport.listTemplates(ctx.user!),
  });
  route({
    method: "POST", pattern: "reports/board/templates", permission: "reports.templates.manage",
    handler: async (ctx) =>
      boardreport.upsertTemplate(
        ctx.user!,
        { id: ctx.body?.id, name: ctx.body?.name, type: ctx.body?.type, sections: ctx.body?.sections },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
  route({
    method: "POST", pattern: "reports/board/generate", permission: "reports.board.generate",
    handler: async (ctx) =>
      boardreport.generateBoardReport(
        ctx.user!,
        {
          templateType: ctx.body?.templateType,
          templateId: ctx.body?.templateId,
          periodStart: String(ctx.body?.periodStart ?? ""),
          periodEnd: String(ctx.body?.periodEnd ?? ""),
          sections: ctx.body?.sections,
          source: "screen",
        },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
  route({
    method: "GET", pattern: "reports/board", permission: "reports.board.view",
    handler: async (ctx) => boardreport.listBoardReports(ctx.user!),
  });
  route({
    method: "GET", pattern: "reports/board/:id", permission: "reports.board.view",
    handler: async (ctx) => boardreport.getBoardReport(ctx.user!, ctx.params.id),
  });
  route({
    method: "GET", pattern: "reports/board/:id/download", permission: "reports.board.view",
    handler: async (ctx) => {
      const html = await boardreport.downloadBoardReport(ctx.user!, ctx.params.id);
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    },
  });

  // ═══ SERMON STUDIO ═══
  route({
    method: "GET", pattern: "sermons/series", permission: "sermon.view",
    handler: async (ctx) => sermon.listSeries(ctx.user!),
  });
  route({
    method: "POST", pattern: "sermons/series", permission: "sermon.create",
    handler: async (ctx) =>
      sermon.upsertSeries(
        ctx.user!,
        { id: ctx.body?.id, title: ctx.body?.title, description: ctx.body?.description, themeTags: ctx.body?.themeTags, startDate: ctx.body?.startDate, endDate: ctx.body?.endDate },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
  route({
    method: "GET", pattern: "sermons", permission: "sermon.view",
    handler: async (ctx) =>
      sermon.listSermons(ctx.user!, { seriesId: ctx.query.get("seriesId") ?? undefined, status: ctx.query.get("status") ?? undefined }),
  });
  route({
    method: "POST", pattern: "sermons", permission: "sermon.create",
    handler: async (ctx) =>
      sermon.upsertSermon(
        ctx.user!,
        { id: ctx.body?.id, title: ctx.body?.title, primaryScriptureRef: ctx.body?.primaryScriptureRef, theme: ctx.body?.theme, targetDate: ctx.body?.targetDate, status: ctx.body?.status, seriesId: ctx.body?.seriesId },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
  route({
    method: "DELETE", pattern: "sermons/:id", permission: "sermon.manage",
    handler: async (ctx) => sermon.deleteSermon(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
  route({
    method: "GET", pattern: "sermons/:id", permission: "sermon.view",
    handler: async (ctx) => sermon.getSermon(ctx.user!, ctx.params.id),
  });
  route({
    method: "GET", pattern: "sermons/:id/export", permission: "sermon.view",
    handler: async (ctx) => {
      const html = await sermon.exportSermonHtml(ctx.user!, ctx.params.id);
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    },
  });
  route({
    method: "POST", pattern: "sermons/:id/generate", permission: "sermon.edit",
    handler: async (ctx) =>
      sermon.generateDraft(
        ctx.user!,
        ctx.params.id,
        {
          theme: ctx.body?.theme,
          scriptureRef: ctx.body?.scriptureRef,
          seriesContext: ctx.body?.seriesContext,
          lengthMinutes: ctx.body?.lengthMinutes,
          audienceNotes: ctx.body?.audienceNotes,
          sections: ctx.body?.sections ?? [],
        },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
  route({
    method: "POST", pattern: "sermons/:id/drafts", permission: "sermon.edit",
    handler: async (ctx) =>
      sermon.saveDraftEdit(
        ctx.user!,
        ctx.params.id,
        { outline: ctx.body?.outline, crossRefs: ctx.body?.crossRefs, illustrations: ctx.body?.illustrations, songs: ctx.body?.songs },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
  route({
    method: "GET", pattern: "sermons/:id/versions/:versionId", permission: "sermon.view",
    handler: async (ctx) => sermon.getDraftVersion(ctx.user!, ctx.params.id, ctx.params.versionId),
  });
  route({
    method: "POST", pattern: "sermons/:id/versions/:versionId/restore", permission: "sermon.edit",
    handler: async (ctx) => sermon.restoreVersion(ctx.user!, ctx.params.id, ctx.params.versionId, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
  route({
    method: "GET", pattern: "worship-songs", permission: "sermon.view",
    handler: async (ctx) => sermon.listSongs(ctx.user!, { search: ctx.query.get("search") ?? undefined }),
  });
  route({
    method: "POST", pattern: "worship-songs", permission: "sermon.library.manage",
    handler: async (ctx) =>
      sermon.upsertSong(
        ctx.user!,
        { id: ctx.body?.id, title: ctx.body?.title, artist: ctx.body?.artist, ccliNumber: ctx.body?.ccliNumber, themeTags: ctx.body?.themeTags, moodTags: ctx.body?.moodTags, scriptureRefs: ctx.body?.scriptureRefs, key: ctx.body?.key, tempo: ctx.body?.tempo, lyricsExcerpt: ctx.body?.lyricsExcerpt },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
  route({
    method: "DELETE", pattern: "worship-songs/:id", permission: "sermon.library.manage",
    handler: async (ctx) => sermon.deleteSong(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  // ═══ SERVING (rota engine) ═══
  route({
    method: "GET", pattern: "serving/configs", permission: "schedule.view",
    handler: async (ctx) => rota.listServingConfigs(ctx.user!),
  });
  route({
    method: "POST", pattern: "serving/configs", permission: "schedule.assign",
    handler: async (ctx) =>
      rota.upsertServingConfig(
        ctx.user!,
        { personId: ctx.body?.personId, roleIds: ctx.body?.roleIds, maxTimesPerMonth: ctx.body?.maxTimesPerMonth, minDaysBetweenServes: ctx.body?.minDaysBetweenServes, status: ctx.body?.status, note: ctx.body?.note },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
  route({
    method: "POST", pattern: "serving/rota/preview", permission: "schedule.assign",
    handler: async (ctx) =>
      rota.previewRota(ctx.user!, { from: ctx.body?.from, to: ctx.body?.to, team: ctx.body?.team }),
  });
  route({
    method: "GET", pattern: "serving/rota/preview", permission: "schedule.assign",
    handler: async (ctx) =>
      rota.previewRota(ctx.user!, { from: ctx.query.get("from") ?? undefined, to: ctx.query.get("to") ?? undefined, team: ctx.query.get("team") ?? undefined }),
  });
  route({
    method: "GET", pattern: "serving/rota/event/:eventId", permission: "schedule.assign",
    handler: async (ctx) => rota.previewForEvent(ctx.user!, ctx.params.eventId),
  });
  route({
    method: "POST", pattern: "serving/rota/commit", permission: "schedule.assign",
    handler: async (ctx) =>
      rota.commitRota(ctx.user!, { assignments: ctx.body?.assignments ?? [] }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
  route({
    method: "GET", pattern: "serving/who-is-free", permission: "schedule.assign",
    handler: async (ctx) => {
      const date = ctx.query.get("date");
      if (!date) throw badRequest("date is required.");
      return rota.whoIsFree(ctx.user!, date);
    },
  });
  route({
    method: "GET", pattern: "serving/burnout", permission: "schedule.view",
    handler: async (ctx) => rota.burnoutReport(ctx.user!),
  });
  // Self-service (portal)
  route({
    method: "GET", pattern: "serving/my-overview", permission: "serving.view.own",
    handler: async (ctx) => rota.myServingOverview(ctx.user!),
  });
  route({
    method: "POST", pattern: "serving/my-config", permission: "serving.view.own",
    handler: async (ctx) =>
      rota.updateMyServingConfig(
        ctx.user!,
        { roleIds: ctx.body?.roleIds, maxTimesPerMonth: ctx.body?.maxTimesPerMonth, minDaysBetweenServes: ctx.body?.minDaysBetweenServes, note: ctx.body?.note },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
  route({
    method: "POST", pattern: "serving/my-blockouts", permission: "serving.view.own",
    handler: async (ctx) =>
      rota.addMyBlockout(ctx.user!, { startsOn: String(ctx.body?.startsOn ?? ""), endsOn: String(ctx.body?.endsOn ?? ""), reason: ctx.body?.reason }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
  route({
    method: "DELETE", pattern: "serving/my-blockouts/:id", permission: "serving.view.own",
    handler: async (ctx) => rota.removeMyBlockout(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });
  route({
    method: "GET", pattern: "features/keys", permission: "admin.view",
    handler: async () => ({ keys: FEATURE_KEYS }),
  });
}
