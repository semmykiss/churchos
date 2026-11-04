import { route } from "@/server/api/router";
import { badRequest } from "@/server/http";
import * as pipeline from "@/server/services/pipeline";
import { optArr, optBool, optNum, optObj, optStr } from "@/server/api/body";

/**
 * Pipeline routes (thin controllers — all logic in services).
 * Task-scope privacy (own vs all) is enforced inside listTasks/completeTask.
 */
export function registerPipelineRoutes() {
  route({
    method: "GET", pattern: "pipeline/stages", permission: "pipeline.view",
    handler: async (ctx) => pipeline.listStages(ctx.user!),
  });
  route({
    method: "POST", pattern: "pipeline/stages", permission: "pipeline.view", // manage re-checked in service
    handler: async (ctx) =>
      pipeline.saveStage(
        ctx.user!,
        {
          id: optStr(ctx.body?.id),
          name: optStr(ctx.body?.name) ?? "", // service 400s on empty
          sortOrder: optNum(ctx.body?.sortOrder),
          mapsToLifecycleStage: optStr(ctx.body?.mapsToLifecycleStage),
          color: optStr(ctx.body?.color),
          stallThresholdDays: optNum(ctx.body?.stallThresholdDays),
          isActive: optBool(ctx.body?.isActive),
        },
        { ip: ctx.ip, userAgent: ctx.userAgent },
      ),
  });
  route({
    method: "DELETE", pattern: "pipeline/stages/:id",
    handler: async (ctx) => pipeline.deleteStage(ctx.user!, ctx.params.id),
  });

  route({
    method: "GET", pattern: "pipeline/board", permission: "pipeline.view",
    handler: async (ctx) => pipeline.board(ctx.user!),
  });
  route({
    method: "POST", pattern: "pipeline/move", permission: "pipeline.view",
    handler: async (ctx) => {
      const personId = String(ctx.body?.personId ?? "");
      const toStageId = String(ctx.body?.toStageId ?? "");
      if (!personId || !toStageId) throw badRequest("personId and toStageId are required.");
      return pipeline.movePersonApi(ctx.user!, personId, toStageId, optStr(ctx.body?.note));
    },
  });
  route({
    method: "POST", pattern: "pipeline/move-next", permission: "pipeline.view",
    handler: async (ctx) => pipeline.movePersonNext(ctx.user!, String(ctx.body?.personId ?? "")),
  });

  route({
    method: "GET", pattern: "pipeline/sequences", permission: "pipeline.view",
    handler: async (ctx) => pipeline.listSequences(ctx.user!),
  });
  route({
    method: "POST", pattern: "pipeline/sequences", permission: "pipeline.view", // manage re-checked in service
    handler: async (ctx) => {
      const steps = optArr(ctx.body?.steps);
      if (!steps) throw badRequest("Steps are required."); // same 400 the service throws for a non-array
      return pipeline.saveSequence(
        ctx.user!,
        {
          id: optStr(ctx.body?.id),
          name: optStr(ctx.body?.name) ?? "", // service 400s on empty
          description: optStr(ctx.body?.description),
          triggerStageId: optStr(ctx.body?.triggerStageId),
          isActive: optBool(ctx.body?.isActive),
          steps: steps.map((raw) => {
            const s = optObj(raw) ?? {}; // non-object entries fall through to the service's action validation
            return {
              dayOffset: optNum(s.dayOffset) ?? Number.NaN, // NaN → service 400 "Day offset must be 0–365."
              actionType: optStr(s.actionType) ?? "", // unknown action → service 400
              channel: optStr(s.channel) ?? null,
              messageTemplate: optStr(s.messageTemplate) ?? null,
              assignToRole: optStr(s.assignToRole) ?? null,
              moveTargetStageId: optStr(s.moveTargetStageId) ?? null,
            };
          }),
        },
        { ip: ctx.ip, userAgent: ctx.userAgent },
      );
    },
  });
  route({
    method: "DELETE", pattern: "pipeline/sequences/:id",
    handler: async (ctx) => pipeline.deleteSequence(ctx.user!, ctx.params.id),
  });

  route({
    method: "GET", pattern: "pipeline/tasks", permission: "pipeline.view", // scope privacy enforced in service
    handler: async (ctx) => pipeline.listTasks(ctx.user!, ctx.query.get("scope") ?? undefined),
  });
  route({
    method: "POST", pattern: "pipeline/tasks/:id/complete",
    handler: async (ctx) => pipeline.completeTask(ctx.user!, ctx.params.id, optStr(ctx.body?.outcomeNote), false),
  });
  route({
    method: "POST", pattern: "pipeline/tasks/:id/skip",
    handler: async (ctx) => pipeline.completeTask(ctx.user!, ctx.params.id, optStr(ctx.body?.outcomeNote), true),
  });

  route({
    method: "GET", pattern: "pipeline/journey/:personId", permission: "pipeline.view",
    handler: async (ctx) => pipeline.listJourney(ctx.user!, ctx.params.personId),
  });
  route({
    method: "POST", pattern: "pipeline/notes", permission: "pipeline.view",
    handler: async (ctx) => {
      const personId = optStr(ctx.body?.personId);
      if (!personId) throw badRequest("personId is required.");
      return pipeline.logConnectionNote(ctx.user!, { personId, method: optStr(ctx.body?.method), note: optStr(ctx.body?.note) ?? "" }); // service 400s on empty note
    },
  });

  route({
    method: "GET", pattern: "pipeline/needs-attention", permission: "pipeline.view",
    handler: async (ctx) => pipeline.needsAttention(ctx.user!),
  });
  route({
    method: "POST", pattern: "pipeline/tick", permission: "pipeline.view",
    handler: async (ctx) => pipeline.tickApi(ctx.user!, optStr(ctx.body?.now)),
  });
}
