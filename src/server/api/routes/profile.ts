import { route } from "@/server/api/router";
import { db } from "@/server/db";
import { badRequest, jsonOk } from "@/server/http";
import { j } from "@/server/audit";

/**
 * Current-user UI preferences (theme persistence for the multi-theme system).
 * The preferences blob is a JSON string column on User — additive keys merge
 * so future preferences (density, language…) can piggyback on the same field.
 */
const ALLOWED_THEMES = new Set(["sanctuary-light", "midnight", "harvest", "contrast", "system"]);

export function registerProfileRoutes() {
  route({
    method: "POST",
    pattern: "users/me/preferences",
    permission: "",
    handler: async (ctx) => {
      if (!ctx.user) throw badRequest("Sign-in required.");
      const theme = ctx.body?.theme;
      if (typeof theme !== "string" || !ALLOWED_THEMES.has(theme)) {
        throw badRequest("Invalid theme value.");
      }
      const current = j<Record<string, unknown>>(ctx.user.preferences, {});
      const next = { ...current, theme };
      await db.user.update({
        where: { id: ctx.user.userId },
        data: { preferences: JSON.stringify(next) },
      });
      return jsonOk({ ok: true, preferences: next });
    },
  });

  route({
    method: "GET",
    pattern: "users/me/preferences",
    permission: "",
    handler: async (ctx) => {
      if (!ctx.user) throw badRequest("Sign-in required.");
      return jsonOk({ preferences: j<Record<string, unknown>>(ctx.user.preferences, {}) });
    },
  });
}
