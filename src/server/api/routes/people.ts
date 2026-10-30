import { route, type ApiContext } from "@/server/api/router";
import * as people from "@/server/services/people";
import { badRequest } from "@/server/http";
import { j } from "@/server/audit";

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

  // NOTE: static segments must register before "people/:id" — the router is
  // first-match-wins, so "people/export.csv" would otherwise be captured as an :id.
  route({
    method: "GET", pattern: "people/export.csv", permission: "people.view",
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
