import { getSessionUser, getKioskContext } from "@/server/auth";
import { getPartnerSessionUser, type PartnerPrincipal } from "@/server/partner-auth";
import { can, type SessionUser } from "@/server/permissions";
import { ApiError, unauthorized, forbidden, notFound, jsonOk } from "@/server/http";

/**
 * API router (backend only).
 * The Next.js route at /api/v1/[...path] is a THIN adapter that delegates here.
 * Route handlers never touch cookies directly — the router resolves the session
 * and enforces declared permissions before a handler runs.
 */
export interface ApiContext {
  req: Request;
  user: SessionUser | null; // resolved church-tenant session (null unless authenticated)
  partner: PartnerPrincipal | null; // resolved vendor/partner session (for partner/* routes)
  kiosk: Awaited<ReturnType<typeof getKioskContext>>; // set for /kiosk/* routes
  params: Record<string, string>; // path params
  query: URLSearchParams;
  body: any; // parsed JSON body (undefined for GET)
  ip: string | null;
  userAgent: string | null;
}

export type ApiHandler = (ctx: ApiContext) => Promise<unknown> | unknown;

export interface RouteDef {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: string; // e.g. "people/:id/timeline"
  permission?: string; // required permission ("" = any authenticated user)
  isPublic?: boolean; // no session needed (login, kiosk by token)
  handler: ApiHandler;
}

const routes: RouteDef[] = [];
export function route(def: RouteDef) {
  routes.push(def);
  return def;
}

export function getRoutes(): readonly RouteDef[] {
  return routes;
}

function matchPattern(pattern: string, segments: string[]): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  if (pp.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) {
      params[pp[i].slice(1)] = decodeURIComponent(segments[i]);
    } else if (pp[i] !== segments[i]) {
      return null;
    }
  }
  return params;
}

export async function dispatch(req: Request, segments: string[]): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  // load module routes once
  await registerModules();

  let matched: { def: RouteDef; params: Record<string, string> } | null = null;
  let pathExists = false;
  for (const def of routes) {
    const params = matchPattern(def.pattern, segments);
    if (params) {
      pathExists = true;
      if (def.method === method) {
        matched = { def, params };
        break;
      }
    }
  }
  if (!matched) {
    return jsonOk({ error: "not_found", message: pathExists ? `Method ${method} not allowed.` : "Unknown API path." }, { status: 404 });
  }

  try {
    // resolve session
    const cookieHeader = req.headers.get("cookie") ?? "";
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const idx = c.indexOf("=");
        return [c.slice(0, idx).trim(), c.slice(idx + 1).trim()];
      }).filter(([, v]) => v !== undefined)
    );
    const user = await getSessionUser(cookies["chms_session"]);

    // partner (vendor) principal — only resolved for partner/* routes
    const isPartnerRoute = segments[0] === "partner";
    const partner = isPartnerRoute
      ? await getPartnerSessionUser(cookies["chms_partner_session"])
      : null;

    // kiosk principal (device token) for /kiosk/* routes
    let kiosk: Awaited<ReturnType<typeof getKioskContext>> = null;
    if (segments[0] === "kiosk") {
      kiosk = await getKioskContext(url.searchParams.get("token") ?? "");
      if (!kiosk) throw unauthorized("Kiosk session invalid or expired.");
    }

    const def = matched.def;
    if (def.pattern.startsWith("partner/")) {
      // partner console: guarded by the partner session, never by church roles
      if (!def.isPublic && !partner) throw unauthorized("Partner sign-in required.");
    } else {
      if (!def.isPublic && !user) throw unauthorized();
      if (def.permission && !can(user, def.permission)) {
        throw forbidden(`Requires "${def.permission}" permission.`);
      }
    }

    let body: any = undefined;
    if (method !== "GET" && method !== "DELETE") {
      try {
        const text = await req.text();
        body = text ? JSON.parse(text) : {};
      } catch {
        throw new ApiError(400, "bad_request", "Invalid JSON body.");
      }
    }

    const forwarded = req.headers.get("x-forwarded-for");
    const ctx: ApiContext = {
      req,
      user,
      partner,
      kiosk,
      params: matched.params,
      query: url.searchParams,
      body,
      ip: forwarded ? forwarded.split(",")[0].trim() : null,
      userAgent: req.headers.get("user-agent"),
    };

    const result = await def.handler(ctx);
    if (result instanceof Response) return result;
    return jsonOk(result ?? { ok: true });
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonOk({ error: err.code, message: err.message, details: err.details }, { status: err.status });
    }
    console.error("[api] unhandled error:", err);
    return jsonOk({ error: "internal", message: "Something went wrong on the server." }, { status: 500 });
  }
}

let registered = false;
async function registerModules() {
  if (registered) return;
  registered = true;
  // Import each module's route definitions (backend layer).
  const { registerAuthRoutes } = await import("@/server/api/routes/auth");
  const { registerProfileRoutes } = await import("@/server/api/routes/profile");
  const { registerPeopleRoutes } = await import("@/server/api/routes/people");
  const { registerGroupRoutes } = await import("@/server/api/routes/groups");
  const { registerCheckinRoutes } = await import("@/server/api/routes/checkin");
  const { registerEventRoutes } = await import("@/server/api/routes/events");
  const { registerGivingRoutes } = await import("@/server/api/routes/giving");
  const { registerAccountingRoutes } = await import("@/server/api/routes/accounting");
  const { registerCommsRoutes } = await import("@/server/api/routes/comms");
  const { registerChatRoutes } = await import("@/server/api/routes/chat");
  const { registerVolunteerRoutes } = await import("@/server/api/routes/volunteers");
  const { registerCareRoutes } = await import("@/server/api/routes/care");
  const { registerWorkflowRoutes } = await import("@/server/api/routes/workflows");
  const { registerReportRoutes } = await import("@/server/api/routes/reports");
  const { registerAdminRoutes } = await import("@/server/api/routes/admin");
  const { registerAccessRoutes } = await import("@/server/api/routes/access");
  const { registerPortalRoutes } = await import("@/server/api/routes/portal");
  const { registerPartnerRoutes } = await import("@/server/api/routes/partner");
  const { registerNotificationRoutes } = await import("@/server/api/routes/notifications");
  const { registerAiRoutes } = await import("@/server/api/routes/ai");
  const { registerTenantRoutes } = await import("@/server/api/routes/tenant");
  const { registerWhatsAppRoutes } = await import("@/server/api/routes/whatsapp");
  const { registerPipelineRoutes } = await import("@/server/api/routes/pipeline");
  const { registerAiBeyondRoutes } = await import("@/server/api/routes/aibeyond");
  const { registerPublicFormRoutes } = await import("@/server/api/routes/public-forms");
  registerAuthRoutes();
  registerProfileRoutes();
  registerPeopleRoutes();
  registerGroupRoutes();
  registerCheckinRoutes();
  registerEventRoutes();
  registerGivingRoutes();
  registerAccountingRoutes();
  registerCommsRoutes();
  registerChatRoutes();
  registerVolunteerRoutes();
  registerCareRoutes();
  registerWorkflowRoutes();
  registerReportRoutes();
  registerAdminRoutes();
  registerAccessRoutes();
  registerPortalRoutes();
  registerPartnerRoutes();
  registerNotificationRoutes();
  registerAiRoutes();
  registerTenantRoutes();
  registerWhatsAppRoutes();
  registerPipelineRoutes();
  registerAiBeyondRoutes();
  registerPublicFormRoutes();
}
