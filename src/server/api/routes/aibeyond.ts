import { optStr, optNum, optInt, optBool, optArr, optStrArr, optObj } from "@/server/api/body";
import { route } from "@/server/api/router";
import * as risk from "@/server/services/risk";
import * as boardreport from "@/server/services/boardreport";
import * as sermon from "@/server/services/sermon";
import * as rota from "@/server/services/rota";
import { featuresFor, FEATURE_KEYS } from "@/server/services/features";
import { badRequest, forbidden } from "@/server/http";
import { can } from "@/server/permissions";

// ── body narrowers — the typed boundary for the unknown-body contract ─────────

/** Risk rules from the body; signalType is forwarded as a string — the service
 *  re-checks membership (`Unknown signal type "…"` 400) before any use. */
function rulesFrom(
  v: unknown,
): { signalType: risk.SignalType; enabled: boolean; thresholds: Record<string, number> }[] {
  return (optArr(v) ?? []).flatMap((entry) => {
    const o = optObj(entry);
    if (!o) return [];
    const signalType = optStr(o.signalType);
    const enabled = optBool(o.enabled);
    const thresholdsRaw = optObj(o.thresholds);
    if (signalType === undefined || enabled === undefined || !thresholdsRaw) return [];
    // Keep only finite-number values: known fields stay intact, malformed ones
    // read as absent so the service's own per-field 400 checks still fire.
    const thresholds: Record<string, number> = {};
    for (const [key, val] of Object.entries(thresholdsRaw)) {
      const n = optNum(val);
      if (n !== undefined) thresholds[key] = n;
    }
    return [{ signalType: signalType as risk.SignalType, enabled, thresholds }];
  });
}

const isBoardReportType = (v: string): v is boardreport.BoardReportType =>
  (boardreport.BOARD_REPORT_TYPES as readonly string[]).includes(v);
const isBoardSection = (v: string): v is boardreport.BoardSection => v in boardreport.BOARD_SECTIONS;
const DRAFT_SECTIONS = ["outline", "crossRefs", "illustrations", "songs"];
const isDraftSection = (v: string): v is sermon.DraftSection => DRAFT_SECTIONS.includes(v);
const ILLUSTRATION_TYPES = ["personal_story_prompt", "historical", "cultural", "parable", "scripture_scene"];
const isIllustrationType = (v: string): v is sermon.IllustrationItem["type"] => ILLUSTRATION_TYPES.includes(v);

function outlineFrom(v: unknown): sermon.SermonOutline | undefined {
  const o = optObj(v);
  if (!o) return undefined;
  const intro = optStr(o.intro);
  const closing = optStr(o.closing);
  const pointsRaw = optArr(o.points);
  if (intro === undefined || closing === undefined || !pointsRaw) return undefined;
  const points = pointsRaw.flatMap((p) => {
    const po = optObj(p);
    if (!po) return [];
    const title = optStr(po.title);
    const subpoints = optStrArr(po.subpoints);
    if (title === undefined || !subpoints) return [];
    return [{ title, scripture: optStr(po.scripture), subpoints, application: optStr(po.application) }];
  });
  return { intro, points, closing, bigIdea: optStr(o.bigIdea) };
}

function crossRefsFrom(v: unknown): sermon.CrossRefItem[] | undefined {
  const raw = optArr(v);
  if (!raw) return undefined;
  return raw.flatMap((entry) => {
    const o = optObj(entry);
    if (!o) return [];
    const reference = optStr(o.reference);
    const relevance = optStr(o.relevance);
    return reference !== undefined && relevance !== undefined ? [{ reference, relevance }] : [];
  });
}

function illustrationsFrom(v: unknown): sermon.IllustrationItem[] | undefined {
  const raw = optArr(v);
  if (!raw) return undefined;
  return raw.flatMap((entry) => {
    const o = optObj(entry);
    if (!o) return [];
    const type = optStr(o.type);
    const title = optStr(o.title);
    const text = optStr(o.text);
    if (type === undefined || !isIllustrationType(type) || title === undefined || text === undefined) return [];
    return [{ type, title, text }];
  });
}

function songsFrom(v: unknown): { songId: string; matchReason?: string; orderIndex?: number }[] | undefined {
  const raw = optArr(v);
  if (!raw) return undefined;
  return raw.flatMap((entry) => {
    const o = optObj(entry);
    if (!o) return [];
    const songId = optStr(o.songId);
    if (songId === undefined) return [];
    return [{ songId, matchReason: optStr(o.matchReason), orderIndex: optInt(o.orderIndex) }];
  });
}

function assignmentsFrom(v: unknown): { eventId: string; roleId: string; personId: string }[] {
  return (optArr(v) ?? []).flatMap((entry) => {
    const o = optObj(entry);
    if (!o) return [];
    const eventId = optStr(o.eventId);
    const roleId = optStr(o.roleId);
    const personId = optStr(o.personId);
    return eventId !== undefined && roleId !== undefined && personId !== undefined ? [{ eventId, roleId, personId }] : [];
  });
}

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
    handler: async (ctx) => risk.previewRules(ctx.user!, rulesFrom(ctx.body?.rules)),
  });
  route({
    method: "POST", pattern: "risk/rules", permission: "care.risk.manage",
    handler: async (ctx) => risk.updateRules(ctx.user!, rulesFrom(ctx.body?.rules), { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  // ═══ BOARD REPORTS ═══
  route({
    method: "GET", pattern: "reports/board/templates", permission: "reports.board.view",
    handler: async (ctx) => boardreport.listTemplates(ctx.user!),
  });
  route({
    method: "POST", pattern: "reports/board/templates", permission: "reports.templates.manage",
    handler: async (ctx) => {
      const type = optStr(ctx.body?.type);
      return boardreport.upsertTemplate(
        ctx.user!,
        {
          id: optStr(ctx.body?.id),
          name: optStr(ctx.body?.name),
          type: type !== undefined && isBoardReportType(type) ? type : undefined,
          sections: optStrArr(ctx.body?.sections)?.filter(isBoardSection),
        },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      );
    },
  });
  route({
    method: "POST", pattern: "reports/board/generate", permission: "reports.board.generate",
    handler: async (ctx) => {
      const templateType = optStr(ctx.body?.templateType);
      return boardreport.generateBoardReport(
        ctx.user!,
        {
          templateType: templateType !== undefined && isBoardReportType(templateType) ? templateType : undefined,
          templateId: optStr(ctx.body?.templateId),
          periodStart: String(ctx.body?.periodStart ?? ""),
          periodEnd: String(ctx.body?.periodEnd ?? ""),
          sections: optStrArr(ctx.body?.sections)?.filter(isBoardSection),
          source: "screen",
        },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      );
    },
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
        { id: optStr(ctx.body?.id), title: optStr(ctx.body?.title) ?? "", description: optStr(ctx.body?.description), themeTags: optStrArr(ctx.body?.themeTags), startDate: optStr(ctx.body?.startDate), endDate: optStr(ctx.body?.endDate) },
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
        { id: optStr(ctx.body?.id), title: optStr(ctx.body?.title) ?? "", primaryScriptureRef: optStr(ctx.body?.primaryScriptureRef), theme: optStr(ctx.body?.theme), targetDate: optStr(ctx.body?.targetDate), status: optStr(ctx.body?.status), seriesId: optStr(ctx.body?.seriesId) },
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
          theme: optStr(ctx.body?.theme),
          scriptureRef: optStr(ctx.body?.scriptureRef),
          seriesContext: optStr(ctx.body?.seriesContext),
          lengthMinutes: optNum(ctx.body?.lengthMinutes),
          audienceNotes: optStr(ctx.body?.audienceNotes),
          sections: optStrArr(ctx.body?.sections)?.filter(isDraftSection) ?? [],
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
        { outline: outlineFrom(ctx.body?.outline), crossRefs: crossRefsFrom(ctx.body?.crossRefs), illustrations: illustrationsFrom(ctx.body?.illustrations), songs: songsFrom(ctx.body?.songs) },
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
        { id: optStr(ctx.body?.id), title: optStr(ctx.body?.title) ?? "", artist: optStr(ctx.body?.artist), ccliNumber: optStr(ctx.body?.ccliNumber), themeTags: optStrArr(ctx.body?.themeTags), moodTags: optStrArr(ctx.body?.moodTags), scriptureRefs: optStrArr(ctx.body?.scriptureRefs), key: optStr(ctx.body?.key), tempo: optStr(ctx.body?.tempo), lyricsExcerpt: optStr(ctx.body?.lyricsExcerpt) },
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
        { personId: optStr(ctx.body?.personId) ?? "", roleIds: optStrArr(ctx.body?.roleIds), maxTimesPerMonth: optNum(ctx.body?.maxTimesPerMonth), minDaysBetweenServes: optNum(ctx.body?.minDaysBetweenServes), status: optStr(ctx.body?.status), note: optStr(ctx.body?.note) },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
  route({
    method: "POST", pattern: "serving/rota/preview", permission: "schedule.assign",
    handler: async (ctx) =>
      rota.previewRota(ctx.user!, { from: optStr(ctx.body?.from), to: optStr(ctx.body?.to), team: optStr(ctx.body?.team) }),
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
      rota.commitRota(ctx.user!, { assignments: assignmentsFrom(ctx.body?.assignments) }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
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
        { roleIds: optStrArr(ctx.body?.roleIds), maxTimesPerMonth: optNum(ctx.body?.maxTimesPerMonth), minDaysBetweenServes: optNum(ctx.body?.minDaysBetweenServes), note: optStr(ctx.body?.note) },
        { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined },
      ),
  });
  route({
    method: "POST", pattern: "serving/my-blockouts", permission: "serving.view.own",
    handler: async (ctx) =>
      rota.addMyBlockout(ctx.user!, { startsOn: String(ctx.body?.startsOn ?? ""), endsOn: String(ctx.body?.endsOn ?? ""), reason: optStr(ctx.body?.reason) }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
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
