import { route } from "@/server/api/router";
import * as workflows from "@/server/services/workflows";
import { badRequest } from "@/server/http";
import { optBool, optStr } from "@/server/api/body";

/**
 * Workflow routes (thin controllers — all logic in services).
 */
export function registerWorkflowRoutes() {
  route({
    method: "GET", pattern: "workflows", permission: "workflows.view",
    handler: async (ctx) => workflows.listWorkflows(ctx.user!),
  });

  route({
    method: "POST", pattern: "workflows/:id/toggle", permission: "workflows.manage",
    handler: async (ctx) => {
      const isActive = optBool(ctx.body?.isActive);
      // same 400 the service itself throws for a missing/non-boolean isActive
      if (isActive === undefined) throw badRequest("isActive (boolean) is required.");
      return workflows.toggleWorkflow(ctx.user!, ctx.params.id, isActive, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
    },
  });

  route({
    method: "POST", pattern: "workflows/:id/test", permission: "workflows.manage",
    handler: async (ctx) => {
      const personId = optStr(ctx.body?.personId);
      if (!personId) throw badRequest("personId is required.");
      return workflows.testWorkflow(ctx.user!, ctx.params.id, personId);
    },
  });

  route({
    method: "GET", pattern: "workflow-runs", permission: "workflows.view",
    handler: async (ctx) =>
      workflows.listWorkflowRuns(ctx.user!, {
        workflowId: ctx.query.get("workflowId") ?? undefined,
        limit: Number(ctx.query.get("limit") ?? 50),
      }),
  });
}
