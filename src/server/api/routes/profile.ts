import { route } from "@/server/api/router";
import { db } from "@/server/db";
import { badRequest, jsonOk } from "@/server/http";
import { j } from "@/server/audit";

/**
 * Current-user UI preferences (theme persistence for the multi-theme system).
 * The preferences blob is a JSON string column on User — additive keys merge
 * so future preferences (density, language…) can piggyback on the same field.
 *
 * People CRM view prefs (columns/density/classic-toggle) live under the
 * `peopleCrm` key — validated & merged additively, never wiping other keys.
 */
const ALLOWED_THEMES = new Set(["sanctuary-light", "midnight", "harvest", "contrast", "system"]);

const PEOPLE_CRM_VIEWS = new Set(["crm", "classic"]);
const PEOPLE_CRM_DENSITY = new Set(["default", "compact"]);
const PEOPLE_CRM_COLUMNS = new Set([
  "name", "contact", "household", "stage", "groups", "lastSeen", "age", "campus",
]);

function sanitizePeopleCrm(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof src.view === "string" && PEOPLE_CRM_VIEWS.has(src.view)) out.view = src.view;
  if (typeof src.density === "string" && PEOPLE_CRM_DENSITY.has(src.density)) out.density = src.density;
  if (Array.isArray(src.columns)) {
    const cols = src.columns.filter((c): c is string => typeof c === "string" && PEOPLE_CRM_COLUMNS.has(c));
    out.columns = cols;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function registerProfileRoutes() {
  route({
    method: "POST",
    pattern: "users/me/preferences",
    permission: "",
    handler: async (ctx) => {
      if (!ctx.user) throw badRequest("Sign-in required.");
      const theme = ctx.body?.theme;
      const peopleCrm = sanitizePeopleCrm(ctx.body?.peopleCrm);
      // At least one known preference key must be present.
      if ((theme !== undefined && (typeof theme !== "string" || !ALLOWED_THEMES.has(theme))) || (!theme && !peopleCrm)) {
        throw badRequest("Nothing to save — send a valid theme and/or peopleCrm preferences.");
      }
      const current = j<Record<string, unknown>>(ctx.user.preferences, {});
      const next: Record<string, unknown> = { ...current };
      if (typeof theme === "string") next.theme = theme;
      if (peopleCrm) next.peopleCrm = { ...j<Record<string, unknown>>(current.peopleCrm, {}), ...peopleCrm };
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
