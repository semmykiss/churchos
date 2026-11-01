import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, conflict, forbidden, notFound } from "@/server/http";
import {
  PERMISSIONS, MODULE_CATALOGUE, can, type SessionUser,
  validateAccessMatrix, serializeAccessMatrix, parseAccessMatrix,
  permissionsForMatrix, deriveMatrixFromPermissions, type AccessMatrix,
} from "@/server/permissions";
import { hashPassword } from "@/server/auth";
import { permissionCatalogue } from "@/server/services/admin";

/**
 * Access-control service (backend only): enterprise role & membership management.
 *
 * Business rules honored:
 *  • roles + permission bundles live in the DB (Role / RolePermission) — fully
 *    customizable at runtime, not hardcoded
 *  • the Owner role is full-access by design and can never be edited or deleted
 *  • you cannot make a change that removes your own access to Administration
 *    (self-lockout protection)
 *  • the last active Owner assignment can never be revoked or disabled
 *  • system roles cannot be deleted; custom roles must be unassigned first
 *  • every mutation is written to the append-only audit log
 */

type Meta = { ip?: string; userAgent?: string };

// ── helpers ──────────────────────────────────────────────────────────────────

function requireManage(user: SessionUser) {
  if (!can(user, "admin.manage")) {
    throw forbidden('Requires "admin.manage" permission (Manage roles & access).');
  }
}

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_");
  return base || "role";
}

/** Validate a permission bundle: every key must exist; "*" is reserved for Owner. */
function validatePermissions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) throw badRequest("permissions must be an array.");
  const valid = new Set<string>(PERMISSIONS);
  const out: string[] = [];
  for (const p of permissions) {
    const key = String(p);
    if (key === "*") throw badRequest('The "*" wildcard is reserved for the Owner role. Grant explicit permissions instead.');
    if (!valid.has(key)) throw badRequest(`Unknown permission "${key}".`);
    if (!out.includes(key)) out.push(key);
  }
  return out.sort();
}

async function getOrgRole(orgId: string, roleId: string) {
  const role = await db.role.findFirst({
    where: { id: roleId, orgId },
    include: { permissions: true, _count: { select: { assignments: true } } },
  });
  if (!role) throw notFound("Role not found.");
  return role;
}

function isOwnerRole(role: { key: string; permissions: { permission: string }[] }): boolean {
  return role.key === "owner" || role.permissions.some((p) => p.permission === "*");
}

async function orgRoleCounts(orgId: string) {
  const [memberCount, userCount] = await Promise.all([
    db.membership.count({ where: { orgId } }),
    db.user.count({ where: { memberships: { some: { orgId } } } }),
  ]);
  return { memberCount, userCount };
}

// ── overview ─────────────────────────────────────────────────────────────────

export async function accessOverview(user: SessionUser) {
  const roles = await db.role.findMany({
    where: { orgId: user.orgId },
    include: { permissions: true, _count: { select: { assignments: true } } },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
  const mine = await db.roleAssignment.findMany({
    where: { membershipId: user.membershipId },
    select: { roleId: true },
  });
  const myRoleIds = new Set(mine.map((m) => m.roleId));
  const counts = await orgRoleCounts(user.orgId);

  return {
    roles: roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions.map((p) => p.permission),
      accessMatrix: (parseAccessMatrix(r.accessMatrix) ?? {}) as Record<string, number>,
      memberCount: r._count.assignments,
      heldByYou: myRoleIds.has(r.id),
    })),
    permissions: permissionCatalogue(),
    // module access ladder catalogue for the matrix editor
    modules: MODULE_CATALOGUE,
    // "who can see giving?" — computed live from the DB, not hardcoded
    whoSeesGiving: roles
      .filter((r) => r.permissions.some((p) => p.permission === "giving.view.all" || p.permission === "giving.view.own" || p.permission === "*")
        || (parseAccessMatrix(r.accessMatrix)?.giving ?? 0) >= 1)
      .map((r) => r.key),
    canManage: can(user, "admin.manage"),
    counts,
    you: { membershipId: user.membershipId },
  };
}

// ── roles ────────────────────────────────────────────────────────────────────

export async function createRole(user: SessionUser, input: any, meta: Meta) {
  requireManage(user);
  const name = String(input?.name ?? "").trim();
  if (name.length < 2 || name.length > 60) throw badRequest("Role name must be 2–60 characters.");
  const description = String(input?.description ?? "").trim() || null;
  const permissions = validatePermissions(input?.permissions ?? []);
  const matrix = validateAccessMatrix(input?.accessMatrix);

  let key = slugify(name);
  for (let i = 2; ; i++) {
    const clash = await db.role.findFirst({ where: { orgId: user.orgId, key } });
    if (!clash) break;
    key = `${slugify(name)}_${i}`;
  }

  const role = await db.role.create({
    data: {
      orgId: user.orgId, key, name, description, isSystem: false,
      accessMatrix: serializeAccessMatrix(matrix),
      permissions: { create: permissions.map((p) => ({ permission: p })) },
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "role.create", entityType: "role", entityId: role.id,
    after: { key, name, description, permissions, accessMatrix: matrix },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: role.id, key, name };
}

export async function updateRole(user: SessionUser, roleId: string, input: any, meta: Meta) {
  requireManage(user);
  const role = await getOrgRole(user.orgId, roleId);
  if (isOwnerRole(role)) throw forbidden("The Owner role cannot be renamed.");

  const name = input?.name !== undefined ? String(input.name).trim() : role.name;
  if (name.length < 2 || name.length > 60) throw badRequest("Role name must be 2–60 characters.");
  const description = input?.description !== undefined ? (String(input.description).trim() || null) : role.description;

  const updated = await db.role.update({ where: { id: role.id }, data: { name, description } });
  await audit({
    orgId: user.orgId, actor: user, action: "role.update", entityType: "role", entityId: role.id,
    before: { name: role.name, description: role.description },
    after: { name: updated.name, description: updated.description },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: updated.id, name: updated.name };
}

export async function setRolePermissions(user: SessionUser, roleId: string, input: any, meta: Meta) {
  requireManage(user);
  const role = await getOrgRole(user.orgId, roleId);
  if (isOwnerRole(role)) throw forbidden("The Owner role always has full access and cannot be edited.");
  const next = validatePermissions(input?.permissions ?? []);

  // self-lockout protection: the actor cannot strip their own admin access
  const holdsRole = await db.roleAssignment.findFirst({
    where: { roleId: role.id, membershipId: user.membershipId },
  });
  if (holdsRole && !can({ permissions: next }, "admin.view")) {
    throw forbidden("This change would remove your own access to Administration (admin.view). Ask another admin to make it.");
  }

  const before = role.permissions.map((p) => p.permission).sort();
  await db.$transaction([
    db.rolePermission.deleteMany({ where: { roleId: role.id } }),
    ...next.map((p) => db.rolePermission.create({ data: { roleId: role.id, permission: p } })),
  ]);
  await audit({
    orgId: user.orgId, actor: user, action: "role.permissions", entityType: "role", entityId: role.id,
    before: { permissions: before }, after: { permissions: next },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: role.id, permissions: next };
}

/**
 * Set a role's per-module access matrix (OFF/READ/EDIT/CREATE/DELETE per
 * module, Shepherd AI included). The matrix is expanded into flat permission
 * keys at session-build time, so this single write re-scopes every gate.
 */
export async function setRoleAccessMatrix(user: SessionUser, roleId: string, input: any, meta: Meta) {
  requireManage(user);
  const role = await getOrgRole(user.orgId, roleId);
  if (isOwnerRole(role)) throw forbidden("The Owner role always has full access and cannot be edited.");

  let matrix: AccessMatrix;
  try {
    matrix = validateAccessMatrix(input?.accessMatrix ?? input?.matrix);
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Invalid access matrix.");
  }

  // self-lockout protection: the actor cannot strip their own admin access
  const holdsRole = await db.roleAssignment.findFirst({
    where: { roleId: role.id, membershipId: user.membershipId },
  });
  if (holdsRole && !permissionsForMatrix(matrix).includes("admin.view")) {
    throw forbidden("This change would remove your own access to Administration. Ask another admin to make it.");
  }

  const before = parseAccessMatrix(role.accessMatrix) ?? {};
  await db.role.update({ where: { id: role.id }, data: { accessMatrix: serializeAccessMatrix(matrix) } });
  await audit({
    orgId: user.orgId, actor: user, action: "role.access_matrix", entityType: "role", entityId: role.id,
    before: { accessMatrix: before }, after: { accessMatrix: matrix },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: role.id, accessMatrix: matrix };
}

export async function duplicateRole(user: SessionUser, roleId: string, input: any, meta: Meta) {
  requireManage(user);
  const role = await getOrgRole(user.orgId, roleId);
  const name = String(input?.name ?? "").trim() || `${role.name} (copy)`;
  if (name.length < 2 || name.length > 60) throw badRequest("Role name must be 2–60 characters.");
  // duplicating the Owner expands the wildcard into an explicit full bundle
  const isWildcard = role.permissions.some((p) => p.permission === "*");
  const permissions = validatePermissions(
    isWildcard ? [...PERMISSIONS] : role.permissions.map((p) => p.permission)
  );
  // copy the module matrix too — an Owner copy gets the full matrix, not "*"
  const matrix: AccessMatrix = isWildcard
    ? Object.fromEntries([...MODULE_CATALOGUE].map((mod) => [mod.key, 4]))
    : (parseAccessMatrix(role.accessMatrix) ?? deriveMatrixFromPermissions(role.permissions.map((p) => p.permission)));

  let key = slugify(name);
  for (let i = 2; ; i++) {
    const clash = await db.role.findFirst({ where: { orgId: user.orgId, key } });
    if (!clash) break;
    key = `${slugify(name)}_${i}`;
  }

  const copy = await db.role.create({
    data: {
      orgId: user.orgId, key, name,
      description: role.description ? `${role.description} (copied from ${role.name})` : `Copied from ${role.name}.`,
      isSystem: false,
      accessMatrix: serializeAccessMatrix(matrix),
      permissions: { create: permissions.map((p) => ({ permission: p })) },
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "role.duplicate", entityType: "role", entityId: copy.id,
    after: { source: role.key, key: copy.key, name: copy.name, permissions, accessMatrix: matrix },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: copy.id, key: copy.key, name: copy.name };
}

export async function deleteRole(user: SessionUser, roleId: string, meta: Meta) {
  requireManage(user);
  const role = await getOrgRole(user.orgId, roleId);
  if (role.isSystem) throw forbidden("System roles cannot be deleted. Duplicate it first if you want a customized copy.");
  const assigned = await db.roleAssignment.count({ where: { roleId: role.id } });
  if (assigned > 0) {
    throw conflict(`This role is still assigned to ${assigned} member(s). Revoke it from them first.`);
  }
  await db.$transaction([
    db.rolePermission.deleteMany({ where: { roleId: role.id } }),
    db.role.delete({ where: { id: role.id } }),
  ]);
  await audit({
    orgId: user.orgId, actor: user, action: "role.delete", entityType: "role", entityId: role.id,
    before: { key: role.key, name: role.name, permissions: role.permissions.map((p) => p.permission) },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ── members (users & role assignment) ────────────────────────────────────────

export async function listMembers(user: SessionUser, q: { search?: string }) {
  const search = q.search?.trim();
  const where: any = { orgId: user.orgId };
  if (search) {
    // person names live on the Person table (no relation from Membership) — resolve ids first
    const matchingPersons = await db.person.findMany({
      where: { orgId: user.orgId, OR: [{ firstName: { contains: search } }, { lastName: { contains: search } }] },
      select: { id: true },
    });
    where.OR = [
      { user: { is: { OR: [{ name: { contains: search } }, { email: { contains: search } }] } } },
      ...(matchingPersons.length ? [{ personId: { in: matchingPersons.map((p) => p.id) } }] : []),
    ];
  }
  const memberships = await db.membership.findMany({
    where,
    include: {
      user: { select: { email: true, name: true, status: true, lastLoginAt: true } },
      roleAssignments: {
        include: { role: { select: { id: true, key: true, name: true } } },
        orderBy: { grantedAt: "asc" },
      },
    },
    orderBy: { joinedAt: "asc" },
  });
  // Membership.personId is a plain field (no relation) — resolve person names in one query
  const personIds = memberships.map((m) => m.personId).filter((v): v is string => !!v);
  const persons = personIds.length
    ? await db.person.findMany({ where: { id: { in: personIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const personById = new Map(persons.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()] as const));
  return {
    items: memberships.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      name: m.user.name ?? m.user.email,
      email: m.user.email,
      status: m.status,
      lastLoginAt: m.user.lastLoginAt,
      personId: m.personId,
      personName: m.personId ? personById.get(m.personId) ?? null : null,
      roles: m.roleAssignments.map((ra) => ({ id: ra.role.id, key: ra.role.key, name: ra.role.name })),
    })),
  };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function createMember(user: SessionUser, input: any, meta: Meta) {
  requireManage(user);
  const email = String(input?.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw badRequest("Enter a valid email address.");
  const password = String(input?.password ?? "");
  if (password.length < 8) throw badRequest("Temporary password must be at least 8 characters.");

  const roleIds: string[] = [...new Set(((Array.isArray(input?.roleIds) ? input.roleIds : []) as unknown[]).map((x) => String(x)))];
  const roles = await db.role.findMany({ where: { orgId: user.orgId, id: { in: roleIds } } });
  if (roles.length !== roleIds.length) throw badRequest("One or more selected roles do not exist in this organization.");

  // resolve the person record: link an existing one, or create a new person
  let personId: string;
  let personName: string;
  if (input?.personId) {
    const person = await db.person.findFirst({ where: { id: String(input.personId), orgId: user.orgId, deletedAt: null } });
    if (!person) throw badRequest("Selected person not found in this church.");
    personId = person.id;
    personName = `${person.firstName} ${person.lastName}`.trim();
  } else {
    const firstName = String(input?.firstName ?? "").trim();
    const lastName = String(input?.lastName ?? "").trim();
    if (!firstName) throw badRequest("First name is required (or link an existing person).");
    const person = await db.person.create({
      data: { orgId: user.orgId, firstName, lastName, email, status: "active", lifecycleStage: "guest" },
    });
    personId = person.id;
    personName = `${firstName} ${lastName}`.trim();
  }

  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) throw conflict("A user account with this email already exists.");

  const u = await db.user.create({
    data: { email, name: personName || email, passwordHash: hashPassword(password) },
  });
  const membership = await db.membership.create({
    data: { orgId: user.orgId, userId: u.id, personId, status: "active", defaultCampusId: user.campusId },
  });
  for (const roleId of roleIds) {
    await db.roleAssignment.create({
      data: { orgId: user.orgId, membershipId: membership.id, roleId, scopeType: "all", grantedBy: user.membershipId },
    });
  }
  await audit({
    orgId: user.orgId, actor: user, action: "member.create", entityType: "membership", entityId: membership.id,
    after: { email, personId, roles: roles.map((r) => r.key) },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { membershipId: membership.id, userId: u.id };
}

export async function assignRole(user: SessionUser, membershipId: string, input: any, meta: Meta) {
  requireManage(user);
  const roleId = String(input?.roleId ?? "");
  const membership = await db.membership.findFirst({ where: { id: membershipId, orgId: user.orgId } });
  if (!membership) throw notFound("Member not found.");
  const role = await getOrgRole(user.orgId, roleId);
  const existing = await db.roleAssignment.findFirst({ where: { membershipId, roleId } });
  if (existing) throw conflict(`${role.name} is already assigned to this member.`);
  const assignment = await db.roleAssignment.create({
    data: { orgId: user.orgId, membershipId, roleId, scopeType: "all", grantedBy: user.membershipId },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "role.assign", entityType: "role_assignment", entityId: assignment.id,
    after: { membershipId, role: role.key, roleName: role.name },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

export async function revokeRole(user: SessionUser, membershipId: string, roleId: string, meta: Meta) {
  requireManage(user);
  const membership = await db.membership.findFirst({
    where: { id: membershipId, orgId: user.orgId },
    include: { roleAssignments: { include: { role: { include: { permissions: true } } } } },
  });
  if (!membership) throw notFound("Member not found.");
  const assignment = membership.roleAssignments.find((ra) => ra.roleId === roleId);
  if (!assignment) throw notFound("This role is not assigned to that member.");
  const role = assignment.role;

  // last-owner protection
  if (role.key === "owner") {
    const activeOwners = await db.membership.count({
      where: {
        orgId: user.orgId, status: "active",
        roleAssignments: { some: { role: { key: "owner" } } },
      },
    });
    if (activeOwners <= 1) throw forbidden("At least one active Owner must remain in the organization.");
  }

  // self-lockout protection: would the actor lose their own admin access?
  if (membershipId === user.membershipId) {
    const remaining = membership.roleAssignments
      .filter((ra) => ra.roleId !== roleId)
      .flatMap((ra) => ra.role.permissions.map((p) => p.permission));
    if (!can({ permissions: remaining }, "admin.view")) {
      throw forbidden("Revoking this role would remove your own access to Administration.");
    }
  }

  await db.roleAssignment.delete({ where: { id: assignment.id } });
  await audit({
    orgId: user.orgId, actor: user, action: "role.revoke", entityType: "role_assignment", entityId: assignment.id,
    before: { membershipId, role: role.key, roleName: role.name },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

export async function setMemberStatus(user: SessionUser, membershipId: string, input: any, meta: Meta) {
  requireManage(user);
  const status = String(input?.status ?? "");
  if (!["active", "disabled"].includes(status)) throw badRequest('Status must be "active" or "disabled".');
  const membership = await db.membership.findFirst({
    where: { id: membershipId, orgId: user.orgId },
    include: { roleAssignments: { include: { role: true } } },
  });
  if (!membership) throw notFound("Member not found.");
  if (membership.id === user.membershipId) throw forbidden("You cannot change your own access status.");

  if (status === "disabled" && membership.roleAssignments.some((ra) => ra.role.key === "owner")) {
    const activeOwners = await db.membership.count({
      where: {
        orgId: user.orgId, status: "active", id: { not: membership.id },
        roleAssignments: { some: { role: { key: "owner" } } },
      },
    });
    if (activeOwners === 0) throw forbidden("At least one active Owner must remain in the organization.");
  }

  const updated = await db.membership.update({ where: { id: membership.id }, data: { status } });
  await audit({
    orgId: user.orgId, actor: user, action: "member.status", entityType: "membership", entityId: membership.id,
    before: { status: membership.status }, after: { status: updated.status },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, status: updated.status };
}
