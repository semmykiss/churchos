/**
 * Constants shared by the API client (frontend) and the API router (backend).
 * Kept dependency-free so both sides can import it safely.
 */

/**
 * Custom CSRF marker required on every non-GET partner/* request.
 *
 * Browsers cannot attach a custom header to a cross-site form POST or a
 * "simple" fetch — such requests trigger a CORS preflight that the attacker's
 * site cannot pass. Requiring this header therefore blocks forged partner
 * mutations (defense-in-depth alongside the Origin allow-list in the router).
 * The bundled client sends it automatically; non-browser API clients (curl,
 * scripts) must send `X-Requested-By: churchos-api` themselves.
 */
export const PARTNER_CSRF_HEADER = "churchos-api";
