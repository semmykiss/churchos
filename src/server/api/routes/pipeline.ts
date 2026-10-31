import { route } from "@/server/api/router";
import { badRequest } from "@/server/http";
import * as pipeline from "@/server/services/pipeline";

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
    handler: async (ctx) => pipeline.saveStage(ctx.user!, ctx.body, { ip: ctx.ip, userAgent: ctx.userAgent }),
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
      return pipeline.movePersonApi(ctx.user!, personId, toStageId, ctx.body?.note);
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
    handler: async (ctx) => pipeline.saveSequence(ctx.user!, ctx.body, { ip: ctx.ip, userAgent: ctx.userAgent }),
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
    handler: async (ctx) => pipeline.completeTask(ctx.user!, ctx.params.id, ctx.body?.outcomeNote, false),
  });
  route({
    method: "POST", pattern: "pipeline/tasks/:id/skip",
    handler: async (ctx) => pipeline.completeTask(ctx.user!, ctx.params.id, ctx.body?.outcomeNote, true),
  });

  route({
    method: "GET", pattern: "pipeline/journey/:personId", permission: "pipeline.view",
    handler: async (ctx) => pipeline.listJourney(ctx.user!, ctx.params.personId),
  });
  route({
    method: "POST", pattern: "pipeline/notes", permission: "pipeline.view",
    handler: async (ctx) => pipeline.logConnectionNote(ctx.user!, ctx.body),
  });

  route({
    method: "GET", pattern: "pipeline/needs-attention", permission: "pipeline.view",
    handler: async (ctx) => pipeline.needsAttention(ctx.user!),
  });
  route({
    method: "POST", pattern: "pipeline/tick", permission: "pipeline.view",
    handler: async (ctx) => pipeline.tickApi(ctx.user!, ctx.body?.now),
  });
}
