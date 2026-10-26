// ChurchOS — Tasks Repository
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const TasksRepo = {
  async list(orgId: string, opts: { status?: string; departmentId?: string; assigneeId?: string; page?: number; pageSize?: number } = {}) {
    const { status, departmentId, assigneeId, page = 1, pageSize = 50 } = opts
    const where: Prisma.TaskWhereInput = { organizationId: orgId }
    if (status) where.status = status
    if (departmentId) where.departmentId = departmentId
    if (assigneeId) where.assigneeId = assigneeId
    const [items, total] = await Promise.all([
      db.task.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { department: true, _count: { select: { subtasks: true, comments: true } } } }),
      db.task.count({ where }),
    ])
    return { items, total, page, pageSize }
  },
  async getById(orgId: string, id: string) {
    return db.task.findFirst({ where: { id, organizationId: orgId }, include: { department: true, subtasks: true, comments: { orderBy: { createdAt: 'asc' } } } })
  },
  async create(orgId: string, data: Prisma.TaskUncheckedCreateInput) {
    return db.task.create({ data: { ...data, organizationId: orgId } })
  },
  async update(id: string, data: Prisma.TaskUpdateInput) {
    return db.task.update({ where: { id }, data })
  },
  async delete(id: string) {
    return db.task.delete({ where: { id } })
  },
  async addComment(taskId: string, authorId: string, authorName: string, body: string) {
    return db.taskComment.create({ data: { taskId, authorId, authorName, body } })
  },
  async listComments(taskId: string) {
    return db.taskComment.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } })
  },
  async stats(orgId: string) {
    const byStatus = await db.task.groupBy({ by: ['status'], where: { organizationId: orgId }, _count: true })
    return { byStatus }
  },
}
