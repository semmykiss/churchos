import { route, type ApiContext } from "@/server/api/router";
import * as people from "@/server/services/people";
import * as peopleViews from "@/server/services/people-views";
import * as peopleProfile from "@/server/services/people-profile";
import * as peopleCustomFields from "@/server/services/people-custom-fields";
import * as peopleConsents from "@/server/services/people-consents";
import * as peopleImport from "@/server/services/people-import";
import * as peopleExport from "@/server/services/people-export";
import * as publicForms from "@/server/services/public-forms";
import { badRequest } from "@/server/http";
import { j } from "@/server/audit";
import { assertFeature } from "@/server/services/features";

/**
 * People & households routes (thin controllers — all logic in services).
 * Scoped routes (parent self-service) deliberately declare the LEAST
 * privileged flat permission ("people.view") at the route level — the service
 * re-checks the scoped right (people.edit.own_household) per resource.
 */

const meta = (ctx: ApiContext) => ({ ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });

export function registerPeopleRoutes() {
  // ── people (existing) ───────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "people", permission: "people.view",
    handler: async (ctx) =>
      people.listPeople(ctx.user!, {
        search: ctx.query.get("search") ?? undefined,
        stage: ctx.query.get("stage") ?? undefined,
        status: ctx.query.get("status") ?? undefined,
        tagId: ctx.query.get("tagId") ?? undefined,
        groupId: ctx.query.get("groupId") ?? undefined,
        campusId: ctx.query.get("campusId") ?? undefined,
        page: Number(ctx.query.get("page") ?? 1),
        pageSize: Number(ctx.query.get("pageSize") ?? 25),
      }),
  });

  route({
    method: "GET", pattern: "people/duplicates", permission: "people.create",
    handler: async (ctx) =>
      people.checkDuplicates(ctx.user!.orgId, {
        email: ctx.query.get("email") ?? undefined,
        phone: ctx.query.get("phone") ?? undefined,
        firstName: ctx.query.get("firstName") ?? undefined,
        lastName: ctx.query.get("lastName") ?? undefined,
        birthdate: ctx.query.get("birthdate") ?? undefined,
      }),
  });

  // ── People CRM Phase 6 — custom field definitions ──────────────────────────
  // Static 2-segment paths MUST register before "people/:id" (first match wins).
  // The definitions themselves are readable by anyone with people.view (the
  // add/edit form and filter builder render from them); VALUES are filtered
  // per viewer at read time and per-field editability is re-checked at write
  // time. Manage routes gate on people.customfields.manage.
  route({
    method: "GET", pattern: "people/custom-fields", permission: "people.view",
    handler: async (ctx) => {
      if (ctx.query.get("archived") === "1") {
        return peopleCustomFields.listDefinitions(ctx.user!, { includeArchived: true });
      }
      return peopleCustomFields.listDefinitionsForForms(ctx.user!.orgId);
    },
  });

  route({
    method: "POST", pattern: "people/custom-fields", permission: "people.customfields.manage",
    handler: async (ctx) => peopleCustomFields.createDefinition(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });

  // before :id — same 3-segment depth as PATCH/DELETE people/custom-fields/:id
  route({
    method: "POST", pattern: "people/custom-fields/presets", permission: "people.customfields.manage",
    handler: async (ctx) => {
      const preset = ctx.body?.preset;
      if (!preset || typeof preset !== "string") throw badRequest("preset is required.");
      return peopleCustomFields.applyPreset(ctx.user!, preset, meta(ctx));
    },
  });

  route({
    method: "PATCH", pattern: "people/custom-fields/:id", permission: "people.customfields.manage",
    handler: async (ctx) => peopleCustomFields.updateDefinition(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });

  route({
    method: "DELETE", pattern: "people/custom-fields/:id", permission: "people.customfields.manage",
    handler: async (ctx) => peopleCustomFields.archiveDefinition(ctx.user!, ctx.params.id, meta(ctx)),
  });

  // ── People CRM Phase 7 — import wizard ───────────────────────────────────
  // Stage (upload) / re-map + decisions / dry-run preview / chunked commit
  // with progress / 7-day rollback / error report / mapping templates.
  route({
    method: "POST", pattern: "people/import", permission: "people.import",
    handler: async (ctx) => peopleImport.stageImport(ctx.user!, {
      fileName: String(ctx.body?.fileName ?? "upload.csv"),
      source: ctx.body?.source === "xlsx" ? "xlsx" : "csv",
      columns: Array.isArray(ctx.body?.columns) ? ctx.body.columns.map(String) : [],
      rows: Array.isArray(ctx.body?.rows) ? ctx.body.rows : [],
    }, meta(ctx)),
  });

  route({
    method: "PUT", pattern: "people/import/:id/mapping", permission: "people.import",
    handler: async (ctx) =>
      peopleImport.applyMapping(
        ctx.user!,
        ctx.params.id,
        { mapping: ctx.body?.mapping ?? {}, actions: ctx.body?.actions ?? {} },
        undefined,
        meta(ctx)
      ),
  });

  route({
    method: "GET", pattern: "people/import/:id/preview", permission: "people.import",
    handler: async (ctx) => peopleImport.importPreview(ctx.user!, ctx.params.id, Number(ctx.query.get("limit") ?? 100)),
  });

  route({
    method: "POST", pattern: "people/import/:id/actions", permission: "people.import",
    handler: async (ctx) => peopleImport.setRowActions(ctx.user!, ctx.params.id, ctx.body?.actions ?? {}),
  });

  route({
    method: "POST", pattern: "people/import/:id/commit", permission: "people.import",
    handler: async (ctx) => peopleImport.commitImport(ctx.user!, ctx.params.id, meta(ctx)),
  });

  route({
    method: "POST", pattern: "people/import/:id/rollback", permission: "people.import",
    handler: async (ctx) => peopleImport.rollbackImport(ctx.user!, ctx.params.id, meta(ctx)),
  });

  route({
    method: "GET", pattern: "people/import/:id/errors.csv", permission: "people.import",
    handler: async (ctx) => {
      const csv = await peopleImport.importErrorReport(ctx.user!, ctx.params.id);
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="import-report-${ctx.params.id}.csv"`,
        },
      });
    },
  });

  route({
    method: "GET", pattern: "people/import", permission: "people.import",
    handler: async (ctx) => peopleImport.listImportJobs(ctx.user!),
  });

  route({
    method: "GET", pattern: "people/import-mappings", permission: "people.import",
    handler: async (ctx) => peopleImport.listMappingTemplates(ctx.user!),
  });

  route({
    method: "POST", pattern: "people/import-mappings", permission: "people.import",
    handler: async (ctx) =>
      peopleImport.saveMappingTemplate(ctx.user!, {
        name: String(ctx.body?.name ?? ""),
        mapping: ctx.body?.mapping ?? {},
        source: ctx.body?.source === "xlsx" ? "xlsx" : "csv",
      }),
  });

  route({
    method: "DELETE", pattern: "people/import-mappings/:id", permission: "people.import",
    handler: async (ctx) => peopleImport.deleteMappingTemplate(ctx.user!, ctx.params.id),
  });

  // ── People CRM Phase 7 — scoped export (CSV/XLSX) ─────────────────────────
  route({
    method: "POST", pattern: "people/export", permission: "people.export",
    handler: async (ctx) => {
      const res = await peopleExport.exportPeopleV2(ctx.user!, {
        format: ctx.body?.format === "xlsx" ? "xlsx" : "csv",
        columns: Array.isArray(ctx.body?.columns) ? ctx.body.columns : [],
        search: ctx.body?.search ?? undefined,
        filters: ctx.body?.filters ?? null,
        sort: ctx.body?.sort ?? undefined,
        dir: ctx.body?.dir === "desc" ? "desc" : "asc",
      }, meta(ctx));
      return new Response(res.content as BodyInit, {
        headers: {
          "content-type": res.mime,
          "content-disposition": `attachment; filename="${res.filename}"`,
          "x-export-rows": String(res.rowCount),
        },
      });
    },
  });

  route({
    method: "GET", pattern: "people/export-log", permission: "people.export",
    handler: async (ctx) => peopleExport.listExportLog(ctx.user!),
  });

  // ── People CRM Phase 7 — public connect-card admin (builder + queue) ──────
  route({
    method: "GET", pattern: "people/forms", permission: "people.forms.manage",
    handler: async (ctx) => publicForms.listForms(ctx.user!),
  });

  route({
    method: "POST", pattern: "people/forms", permission: "people.forms.manage",
    handler: async (ctx) =>
      publicForms.createForm(ctx.user!, {
        name: String(ctx.body?.name ?? ""),
        slug: ctx.body?.slug ? String(ctx.body.slug) : undefined,
        fields: Array.isArray(ctx.body?.fields) ? ctx.body.fields : undefined,
        thankYouMessage: ctx.body?.thankYouMessage != null ? String(ctx.body.thankYouMessage) : undefined,
        requireApproval: ctx.body?.requireApproval === true,
      }, meta(ctx)),
  });

  route({
    method: "PATCH", pattern: "people/forms/:id", permission: "people.forms.manage",
    handler: async (ctx) =>
      publicForms.updateForm(ctx.user!, ctx.params.id, {
        name: ctx.body?.name != null ? String(ctx.body.name) : undefined,
        enabled: ctx.body?.enabled !== undefined ? ctx.body.enabled === true : undefined,
        fields: Array.isArray(ctx.body?.fields) ? ctx.body.fields : undefined,
        thankYouMessage: ctx.body?.thankYouMessage != null ? String(ctx.body.thankYouMessage) : undefined,
        requireApproval: ctx.body?.requireApproval !== undefined ? ctx.body.requireApproval === true : undefined,
      }, meta(ctx)),
  });

  route({
    method: "DELETE", pattern: "people/forms/:id", permission: "people.forms.manage",
    handler: async (ctx) => publicForms.deleteForm(ctx.user!, ctx.params.id, meta(ctx)),
  });

  route({
    method: "GET", pattern: "people/forms/:id/submissions", permission: "people.forms.manage",
    handler: async (ctx) => publicForms.listSubmissions(ctx.user!, ctx.params.id, ctx.query.get("status") ?? undefined),
  });

  route({
    method: "POST", pattern: "people/forms/submissions/:id/review", permission: "people.forms.manage",
    handler: async (ctx) => {
      const decision = ctx.body?.decision === "reject" ? "reject" : ctx.body?.decision === "approve" ? "approve" : null;
      if (!decision) throw badRequest("decision must be approve or reject.");
      return publicForms.reviewSubmission(ctx.user!, ctx.params.id, decision, meta(ctx));
    },
  });

  // NOTE: static segments must register before "people/:id" — the router is
  // first-match-wins, so "people/export.csv" would otherwise be captured as an :id.
  route({
    method: "GET", pattern: "people/export.csv", permission: "people.edit", // bulk export is a staff action
    handler: async (ctx) => {
      const csv = await people.exportPeopleCsv(ctx.user!, {
        search: ctx.query.get("search") ?? undefined,
        stage: ctx.query.get("stage") ?? undefined,
      }, meta(ctx));
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="people-export.csv"`,
        },
      });
    },
  });

  route({
    method: "POST", pattern: "people", permission: "people.create",
    handler: async (ctx) => people.createPerson(ctx.user!, ctx.body, meta(ctx)),
  });

  route({
    method: "GET", pattern: "people/:id", permission: "people.view",
    handler: async (ctx) => people.getPersonDetail(ctx.user!, ctx.params.id),
  });

  route({
    method: "PUT", pattern: "people/:id", permission: "people.view", // scoped in service
    handler: async (ctx) => people.updatePerson(ctx.user!, ctx.params.id, ctx.body, meta(ctx)),
  });

  route({
    method: "POST", pattern: "people/:id/stage", permission: "people.edit",
    handler: async (ctx) => {
      const stage = ctx.body?.stage;
      if (!stage) throw badRequest("stage is required.");
      return people.changeStage(ctx.user!, ctx.params.id, stage, ctx.body?.note, meta(ctx));
    },
  });

  route({
    method: "POST", pattern: "people/:id/archive", permission: "people.archive",
    handler: async (ctx) => people.archivePerson(ctx.user!, ctx.params.id, meta(ctx)),
  });

  route({
    method: "POST", pattern: "people/merge", permission: "people.merge",
    handler: async (ctx) => {
      const { survivorId, mergedId, survivors } = ctx.body ?? {};
      if (!survivorId || !mergedId) throw badRequest("survivorId and mergedId are required.");
      return people.mergePeople(ctx.user!, { survivorId, mergedId, survivors: survivors ?? {} }, meta(ctx));
    },
  });

  // ── People CRM v2 (flag-gated; same permission scope + serializer) ─────────
  route({
    method: "GET", pattern: "people/v2/insights", permission: "people.view",
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return people.peopleInsights(ctx.user!);
    },
  });

  // Filter JSON + cursor travel in the body — search/filters/sort are ALL
  // enforced server-side in the service (never trust client-side filtering).
  route({
    method: "POST", pattern: "people/v2/list", permission: "people.view",
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      const body = ctx.body ?? {};
      return people.listPeopleV2(ctx.user!, {
        search: typeof body.search === "string" ? body.search : undefined,
        filters: body.filters ?? null,
        sort: typeof body.sort === "string" ? body.sort : undefined,
        dir: body.dir === "desc" ? "desc" : body.dir === "asc" ? "asc" : undefined,
        cursor: typeof body.cursor === "string" ? body.cursor : undefined,
        pageSize: Number(body.pageSize ?? 100),
      });
    },
  });

  // Filter-builder option lists (campuses/groups/tags — no people rows here).
  route({
    method: "GET", pattern: "people/v2/options", permission: "people.view",
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return people.peopleV2Options(ctx.user!);
    },
  });

  // ── People CRM v3 (Phase 3): saved smart views ───────────────────────────
  // System defaults + the viewer's personal views + church-wide shared views.
  // Applying a view re-enters the SAME scoped list endpoint, so visibility is
  // always serializer-decided — a shared view can never widen what you see.
  route({
    method: "GET", pattern: "people/v2/views", permission: "people.view",
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleViews.listSavedViews(ctx.user!);
    },
  });

  route({
    method: "POST", pattern: "people/v2/views", permission: "people.view", // shared scope re-checked in service
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleViews.createSavedView(ctx.user!, ctx.body ?? {}, meta(ctx));
    },
  });

  route({
    method: "PATCH", pattern: "people/v2/views/:id", permission: "people.view", // scoped in service
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleViews.updateSavedView(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx));
    },
  });

  route({
    method: "DELETE", pattern: "people/v2/views/:id", permission: "people.view", // scoped in service
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleViews.deleteSavedView(ctx.user!, ctx.params.id, meta(ctx));
    },
  });

  // ── People CRM v3 (Phase 3): bulk actions ─────────────────────────────────
  // Route gate opens the door (people.bulk); the service STILL re-checks the
  // underlying right per action and per record, and returns a per-record
  // success/fail summary instead of failing the whole run.
  route({
    method: "POST", pattern: "people/bulk", permission: "people.bulk",
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      const body = ctx.body ?? {};
      if (!body.action) throw badRequest("action is required.");
      return people.bulkPeople(ctx.user!, body, meta(ctx));
    },
  });

  // CSV over the SAME scoped where as the v2 list — "export selection" and
  // "export current smart list". Same column contract as the classic export.
  route({
    method: "POST", pattern: "people/v2/export.csv", permission: "people.edit", // bulk export is a staff action
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      const body = ctx.body ?? {};
      const csv = await people.exportPeopleV2Csv(ctx.user!, {
        search: typeof body.search === "string" ? body.search : undefined,
        filters: body.filters ?? null,
        personIds: body.personIds ?? undefined,
      }, meta(ctx));
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="people-export.csv"`,
        },
      });
    },
  });

  // ── People CRM (Phase 4): Profile 360 ──────────────────────────────────
  // ONE scoped read for the profile page + peek drawer. Field visibility is
  // decided by the Phase 1 serializer — fields a viewer cannot see are
  // OMITTED from the response, never merely blanked in the UI.
  route({
    method: "GET", pattern: "people/v2/:id/profile", permission: "people.view",
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleProfile.getPersonProfile(ctx.user!, ctx.params.id);
    },
  });

  // Journey milestones — staff-only writes (service re-checks people.edit).
  route({
    method: "POST", pattern: "people/v2/:id/milestones", permission: "people.edit",
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleProfile.addMilestone(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx));
    },
  });

  route({
    method: "DELETE", pattern: "people/v2/:id/milestones/:milestoneId", permission: "people.edit",
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleProfile.removeMilestone(ctx.user!, ctx.params.id, ctx.params.milestoneId, meta(ctx));
    },
  });

  // ── People CRM (Phase 5): Notes & Care ──────────────────────────────────
  // POST keeps the existing contract (legacy `{ note }` quick note accepted;
  // Phase 5 sends type/pinned/confidentialityTier). The service re-checks
  // people.notes.create / people.notes.confidential per write.
  route({
    method: "GET", pattern: "people/v2/:id/notes", permission: "people.view", // scoped in service
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleProfile.listPersonNotes(ctx.user!, ctx.params.id);
    },
  });
  route({
    method: "POST", pattern: "people/v2/:id/notes", permission: "people.edit",
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleProfile.createPersonNote(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx));
    },
  });
  route({
    method: "PATCH", pattern: "people/v2/:id/notes/:noteId", permission: "people.view", // author-or-admin in service
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleProfile.updatePersonNote(ctx.user!, ctx.params.id, ctx.params.noteId, ctx.body ?? {}, meta(ctx));
    },
  });
  route({
    method: "DELETE", pattern: "people/v2/:id/notes/:noteId", permission: "people.view", // author-or-admin in service
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleProfile.deletePersonNote(ctx.user!, ctx.params.id, ctx.params.noteId, meta(ctx));
    },
  });

  // ── People CRM (Phase 5): Attendance & Engagement ───────────────────────
  // Scoped in service: staff (people.edit), the person themselves, or a
  // linked guardian. Route declares the least-privileged baseline only.
  route({
    method: "GET", pattern: "people/v2/:id/attendance", permission: "people.view",
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleProfile.getPersonAttendance(ctx.user!, ctx.params.id);
    },
  });

  // ── People CRM (Phase 5): Communication history (staff only) ────────────
  route({
    method: "GET", pattern: "people/v2/:id/messages", permission: "people.view",
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleProfile.getPersonMessages(ctx.user!, ctx.params.id);
    },
  });

  // ── People CRM (Phase 5): Activity feed (per-source filtered in service) ─
  route({
    method: "GET", pattern: "people/v2/:id/activity", permission: "people.view",
    handler: async (ctx) => {
      await assertFeature(ctx.user!.orgId, "people.crmV2");
      return peopleProfile.getPersonActivity(ctx.user!, ctx.params.id);
    },
  });

  // ── People CRM (Phase 6): consent history (profile-visibility in service) ─
  route({
    method: "GET", pattern: "people/v2/:id/consents", permission: "people.view",
    handler: async (ctx) => peopleConsents.listPersonConsents(ctx.user!, ctx.params.id),
  });
  route({
    method: "POST", pattern: "people/v2/:id/consents", permission: "people.view", // canEditPerson re-checked in service
    handler: async (ctx) => peopleConsents.recordPersonConsent(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });

  // ── guardian links (scoped: own household + dependents) ─────────────────────
  route({
    method: "POST", pattern: "people/:id/guardians", permission: "people.view",
    handler: async (ctx) => people.linkGuardian(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "PATCH", pattern: "people/:id/guardians/:guardianId", permission: "people.view",
    handler: async (ctx) => people.updateGuardianLink(ctx.user!, ctx.params.id, ctx.params.guardianId, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "DELETE", pattern: "people/:id/guardians/:guardianId", permission: "people.view",
    handler: async (ctx) => people.unlinkGuardian(ctx.user!, ctx.params.id, ctx.params.guardianId, meta(ctx)),
  });

  // ── tags (admin taxonomy) ────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "tags", permission: "people.view",
    handler: async (ctx) => people.listTags(ctx.user!, ctx.query.get("search") ?? undefined),
  });
  route({
    method: "POST", pattern: "tags", permission: "people.tags.manage",
    handler: async (ctx) => people.createTag(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "POST", pattern: "people/:id/tags", permission: "people.tags.manage",
    handler: async (ctx) => people.attachTag(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "DELETE", pattern: "people/:id/tags/:tagId", permission: "people.tags.manage",
    handler: async (ctx) => people.detachTag(ctx.user!, ctx.params.id, ctx.params.tagId, meta(ctx)),
  });

  // ── group roster (people.groups.manage OR the group's own leader) ───────────
  route({
    method: "POST", pattern: "people/:id/groups", permission: "people.view",
    handler: async (ctx) => people.addPersonToGroup(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "DELETE", pattern: "people/:id/groups/:groupId", permission: "people.view",
    handler: async (ctx) => people.removePersonFromGroup(ctx.user!, ctx.params.id, ctx.params.groupId, meta(ctx)),
  });

  // ── photo (scoped: self-service allowed) + local file serving ───────────────
  route({
    method: "PATCH", pattern: "people/:id/photo", permission: "people.view",
    handler: async (ctx) => people.setPersonPhoto(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "GET", pattern: "files/:id", permission: "people.view",
    handler: async (ctx) => people.servePersonPhoto(ctx.user!, ctx.params.id),
  });

  // ── households ──────────────────────────────────────────────────────────────
  route({
    method: "GET", pattern: "households", permission: "people.view",
    handler: async (ctx) => people.listHouseholds(ctx.user!, ctx.query.get("search") ?? undefined),
  });
  route({
    method: "POST", pattern: "households", permission: "people.edit",
    handler: async (ctx) => people.createHousehold(ctx.user!, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "PUT", pattern: "households/:id", permission: "people.view", // scoped in service
    handler: async (ctx) => people.updateHousehold(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "DELETE", pattern: "households/:id", permission: "people.edit",
    handler: async (ctx) => people.archiveHousehold(ctx.user!, ctx.params.id, meta(ctx)),
  });
  route({
    method: "POST", pattern: "households/:id/members", permission: "people.view", // scoped in service
    handler: async (ctx) => people.addHouseholdMember(ctx.user!, ctx.params.id, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "PATCH", pattern: "households/:id/members/:personId", permission: "people.view",
    handler: async (ctx) => people.updateHouseholdMemberRole(ctx.user!, ctx.params.id, ctx.params.personId, ctx.body ?? {}, meta(ctx)),
  });
  route({
    method: "DELETE", pattern: "households/:id/members/:personId", permission: "people.view",
    handler: async (ctx) => people.removeHouseholdMember(ctx.user!, ctx.params.id, ctx.params.personId, meta(ctx)),
  });
}
