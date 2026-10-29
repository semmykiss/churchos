/**
 * Permission catalogue + policy checks (backend only).
 * Mirrors 04-architecture.md §3.8: authorization is resolved server-side
 * per (user, tenant, module, action) before any data is returned.
 * Hiding a button is not a permission.
 */

export const PERMISSIONS = [
  "people.view", "people.create", "people.edit", "people.archive", "people.merge",
  "groups.view", "groups.manage", "groups.attendance",
  "checkin.view", "checkin.manage", "checkin.kiosk",
  "events.view", "events.manage",
  "giving.view", "giving.manage", "batches.manage", "statements.manage",
  "comms.view", "comms.send", "consent.view",
  "schedule.view", "schedule.assign", "schedule.respond",
  "care.view", "care.create", "care.manage",
  "workflows.view", "workflows.manage",
  "reports.view",
  "admin.view", "audit.view",
  "portal.use",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface SessionUser {
  sessionId: string;
  userId: string;
  membershipId: string;
  orgId: string;
  orgName: string;
  campusId: string | null;
  campusName: string | null;
  email: string;
  name: string;
  personId: string | null;
  roleKeys: string[];
  roleNames: string[];
  permissions: string[]; // expanded, wildcard-resolved
  amr: string;
}

/** Resolve wildcard patterns: "*" grants everything; "giving.*" grants "giving.view". */
export function can(user: Pick<SessionUser, "permissions"> | null, required: string): boolean {
  if (!user) return false;
  for (const p of user.permissions) {
    if (p === "*" || p === required) return true;
    if (p.endsWith(".*") && required.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

export function canAny(user: Pick<SessionUser, "permissions"> | null, required: string[]): boolean {
  return required.some((r) => can(user, r));
}

/** Role → default permission bundle (used when seeding / rendering the matrix). */
export const ROLE_TEMPLATES: Record<string, string[]> = {
  owner: ["*"],
  campus_admin: [
    "people.view", "people.create", "people.edit", "people.archive", "people.merge",
    "groups.view", "groups.manage", "groups.attendance", "checkin.view", "checkin.manage", "checkin.kiosk",
    "events.view", "events.manage", "comms.view", "comms.send", "consent.view",
    "schedule.view", "schedule.assign", "care.view", "care.create", "care.manage",
    "workflows.view", "reports.view", "admin.view", "portal.use",
  ],
  finance: [
    "people.view", "giving.view", "giving.manage", "batches.manage", "statements.manage",
    "reports.view", "audit.view", "portal.use",
  ],
  ministry_leader: [
    "people.view", "groups.view", "groups.attendance", "schedule.view", "schedule.respond",
    "care.view", "care.create", "comms.view", "comms.send", "reports.view", "portal.use",
  ],
  volunteer: ["schedule.view", "schedule.respond", "checkin.view", "checkin.kiosk", "portal.use"],
  member: ["portal.use"],
};

/** Which nav modules each role may open (frontend hints; server still enforces). */
export const MODULE_ACCESS: Record<string, string[]> = {
  dashboard: ["owner", "campus_admin", "finance", "ministry_leader"],
  people: ["owner", "campus_admin", "ministry_leader", "finance"],
  groups: ["owner", "campus_admin", "ministry_leader"],
  checkin: ["owner", "campus_admin", "volunteer"],
  events: ["owner", "campus_admin", "ministry_leader"],
  giving: ["owner", "finance"],
  comms: ["owner", "campus_admin", "ministry_leader"],
  volunteers: ["owner", "campus_admin", "volunteer"],
  care: ["owner", "campus_admin", "ministry_leader"],
  workflows: ["owner", "campus_admin"],
  reports: ["owner", "campus_admin", "finance", "ministry_leader"],
  admin: ["owner", "campus_admin", "finance"],
  portal: ["owner", "campus_admin", "finance", "ministry_leader", "volunteer", "member"],
};
