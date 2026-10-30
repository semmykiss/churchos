import { route } from "@/server/api/router";
import { login, revokeSession, SESSION_COOKIE } from "@/server/auth";
import { badRequest, jsonOk } from "@/server/http";
import { audit } from "@/server/audit";

/**
 * Auth routes: login / logout / me. Login + logout are public endpoints.
 */
export function registerAuthRoutes() {
  route({
    method: "POST",
    pattern: "auth/login",
    isPublic: true,
    handler: async (ctx) => {
      const { email, password } = ctx.body ?? {};
      if (!email || !password) throw badRequest("Email and password are required.");
      const result = await login(email, password, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
      if (!result.ok || !result.sessionId) {
        return jsonOk({ error: "invalid_credentials", message: result.error }, { status: 401 });
      }
      const cookie = `${SESSION_COOKIE}=${result.sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`;
      return new Response(JSON.stringify({ user: result.user }), {
        headers: { "content-type": "application/json", "set-cookie": cookie },
      });
    },
  });

  route({
    method: "POST",
    pattern: "auth/logout",
    permission: "",
    handler: async (ctx) => {
      if (ctx.user) {
        await revokeSession(ctx.user.sessionId);
        await audit({
          orgId: ctx.user.orgId,
          actor: ctx.user,
          action: "auth.logout",
          entityType: "user",
          entityId: ctx.user.userId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
      const cookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", "set-cookie": cookie },
      });
    },
  });

  route({
    method: "GET",
    pattern: "auth/me",
    permission: "",
    handler: async (ctx) => {
      return { user: ctx.user };
    },
  });
}
