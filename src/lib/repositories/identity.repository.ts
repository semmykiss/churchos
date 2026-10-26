// ChurchOS — Identity & Access Repository
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const IdentityRepo = {
  // ---- Users ----
  async listUsers(orgId: string, opts: { q?: string; role?: string } = {}) {
    const { q, role } = opts
    const where: Prisma.UserWhereInput = { organizationId: orgId }
    if (role) where.role = role
    if (q) where.OR = [{ name: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }]
    return db.user.findMany({ where, orderBy: [{ name: 'asc' }], include: { department: { select: { id: true, name: true, color: true } } } })
  },
  async getUserByEmail(email: string) {
    return db.user.findUnique({ where: { email: email.toLowerCase().trim() }, include: { organization: true, department: true } })
  },
  async getUserById(id: string) {
    return db.user.findUnique({ where: { id }, include: { organization: true, department: true } })
  },
  async createUser(data: Prisma.UserCreateInput) {
    return db.user.create({ data })
  },
  async updateUser(id: string, data: Prisma.UserUpdateInput) {
    return db.user.update({ where: { id }, data })
  },
  async countActiveSuperAdmins(orgId: string) {
    return db.user.count({ where: { organizationId: orgId, role: 'super_admin', active: true } })
  },

  // ---- Roles ----
  async listRoles(orgId: string) {
    return db.role.findMany({ where: { organizationId: orgId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { _count: { select: { permissions: true, assignments: true } } } })
  },
  async getRole(orgId: string, id: string) {
    return db.role.findFirst({ where: { id, organizationId: orgId }, include: { permissions: true, fieldPermissions: true } })
  },
  async createRole(orgId: string, data: Prisma.RoleUncheckedCreateInput) {
    return db.role.create({ data: { ...data, organizationId: orgId } })
  },
  async updateRole(id: string, data: Prisma.RoleUpdateInput) {
    return db.role.update({ where: { id }, data })
  },
  async deleteRole(id: string) {
    return db.role.delete({ where: { id } })
  },
  async setPermissions(roleId: string, permissions: { module: string; action: string }[]) {
    await db.rolePermission.deleteMany({ where: { roleId } })
    if (permissions.length) await db.rolePermission.createMany({ data: permissions.map(p => ({ ...p, roleId })) })
  },

  // ---- Role Assignments (multi-role + scope) ----
  async listAssignments(orgId: string, userId?: string) {
    const where: Prisma.UserRoleAssignmentWhereInput = { organizationId: orgId }
    if (userId) where.userId = userId
    return db.userRoleAssignment.findMany({ where, include: { role: true, user: { select: { id: true, name: true, email: true } } } })
  },
  async createAssignment(orgId: string, data: Prisma.UserRoleAssignmentUncheckedCreateInput) {
    return db.userRoleAssignment.create({ data: { ...data, organizationId: orgId } })
  },
  async deleteAssignment(id: string) {
    return db.userRoleAssignment.delete({ where: { id } })
  },

  // ---- Notifications ----
  async listNotifications(userId: string, opts: { onlyUnread?: boolean; pageSize?: number } = {}) {
    const { onlyUnread, pageSize = 30 } = opts
    const where: Prisma.NotificationWhereInput = { userId }
    if (onlyUnread) where.read = false
    const [items, unread] = await Promise.all([
      db.notification.findMany({ where, orderBy: [{ read: 'asc' }, { createdAt: 'desc' }], take: pageSize }),
      db.notification.count({ where: { userId, read: false } }),
    ])
    return { items, unread }
  },
  async createNotification(data: Prisma.NotificationCreateInput) {
    return db.notification.create({ data })
  },
  async createNotifications(data: Prisma.NotificationCreateManyInput[]) {
    return db.notification.createMany({ data })
  },
  async markRead(userId: string, id?: string, all?: boolean) {
    if (all) {
      const r = await db.notification.updateMany({ where: { userId, read: false }, data: { read: true } })
      return { updated: r.count }
    }
    if (id) {
      await db.notification.update({ where: { id }, data: { read: true } })
      return { updated: 1 }
    }
    return { updated: 0 }
  },
}
