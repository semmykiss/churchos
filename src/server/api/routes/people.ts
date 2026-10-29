import { route } from "@/server/api/router";
import * as people from "@/server/services/people";
import { badRequest } from "@/server/http";
import { j } from "@/server/audit";

/**
 * People & households routes (thin controllers — all logic in services).
 */
export function registerPeopleRoutes() {
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

  route({
    method: "POST", pattern: "people", permission: "people.create",
    handler: async (ctx) => people.createPerson(ctx.user!, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "GET", pattern: "people/:id", permission: "people.view",
    handler: async (ctx) => people.getPersonDetail(ctx.user!, ctx.params.id),
  });

  route({
    method: "PUT", pattern: "people/:id", permission: "people.edit",
    handler: async (ctx) => people.updatePerson(ctx.user!, ctx.params.id, ctx.body, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "people/:id/stage", permission: "people.edit",
    handler: async (ctx) => {
      const stage = ctx.body?.stage;
      if (!stage) throw badRequest("stage is required.");
      return people.changeStage(ctx.user!, ctx.params.id, stage, ctx.body?.note, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "POST", pattern: "people/:id/archive", permission: "people.archive",
    handler: async (ctx) => people.archivePerson(ctx.user!, ctx.params.id, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined }),
  });

  route({
    method: "POST", pattern: "people/merge", permission: "people.merge",
    handler: async (ctx) => {
      const { survivorId, mergedId, survivors } = ctx.body ?? {};
      if (!survivorId || !mergedId) throw badRequest("survivorId and mergedId are required.");
      return people.mergePeople(ctx.user!, { survivorId, mergedId, survivors: survivors ?? {} }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "GET", pattern: "households", permission: "people.view",
    handler: async (ctx) => people.listHouseholds(ctx.user!, ctx.query.get("search") ?? undefined),
  });

  route({
    method: "GET", pattern: "people/export.csv", permission: "people.view",
    handler: async (ctx) => {
      const csv = await people.exportPeopleCsv(ctx.user!, {
        search: ctx.query.get("search") ?? undefined,
        stage: ctx.query.get("stage") ?? undefined,
      }, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="people-export.csv"`,
        },
      });
    },
  });
}
