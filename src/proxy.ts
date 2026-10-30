import { NextResponse, type NextRequest } from "next/server";

/**
 * Subdomain middleware scaffold (tenant onboarding spec §3).
 *
 * Extracts the tenant subdomain from the Host header and forwards it to the
 * app via the `x-churchos-subdomain` request header. The API's session layer
 * already threads church_id through every module query (membership.orgId), so
 * module code needs no changes; this header enables:
 *   • tenant-branded login (GET /api/v1/tenants/branding?subdomain=…)
 *   • future strict subdomain↔session binding checks
 *   • the custom-domain upgrade path (Organization.customDomain)
 *
 * DNS: in production, *.churchos.app resolves to this app. In this sandbox
 * every host (localhost, preview URLs) is accepted — an empty/unknown
 * subdomain simply means "no tenant context" and everything behaves as today.
 */

const SYSTEM_HOST_SUFFIXES = ["churchos.app", "localhost", "vercel.app"]; // reserved platform hosts

function extractSubdomain(hostname: string): string | null {
  const host = hostname.toLowerCase().split(":")[0];
  // IP addresses / bare hostnames have no tenant subdomain
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === "localhost") return null;
  const parts = host.split(".");
  // a.b.c.d → "a" is the tenant label only when the remaining suffix is a
  // platform host; other domains (e.g. preview tunnels) still yield their
  // first label so tenant branding can resolve in any environment.
  if (parts.length >= 3) return parts[0];
  return null;
}

export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const hostname = host.split(":")[0];
  let subdomain = extractSubdomain(hostname);

  // never treat a reserved platform label as a tenant
  if (subdomain && SYSTEM_HOST_SUFFIXES.includes(subdomain)) subdomain = null;

  const headers = new Headers(req.headers);
  if (subdomain) headers.set("x-churchos-subdomain", subdomain);
  headers.set("x-churchos-host", hostname);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  // everything except static assets and internal Next files
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
