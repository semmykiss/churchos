// ChurchOS — Chat Repository (Townhall)
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const ChatRepo = {
  async listRooms(orgId: string, userId: string, role: string) {
    const [openRooms, directRooms] = await Promise.all([
      db.chatRoom.findMany({ where: { organizationId: orgId, type: { in: ['townhall', 'group'] } }, orderBy: { createdAt: 'asc' } }),
      db.chatRoom.findMany({ where: { organizationId: orgId, type: 'direct' } }),
    ])
    const myDirect = directRooms.filter(r => r.refId?.includes(userId))
    return [...openRooms, ...myDirect]
  },
  async getRoom(orgId: string, roomId: string) {
    return db.chatRoom.findFirst({ where: { id: roomId, organizationId: orgId } })
  },
  async createRoom(orgId: string, data: Prisma.ChatRoomCreateInput) {
    return db.chatRoom.create({ data: { ...data, organizationId: orgId } })
  },
  async deleteRoom(roomId: string) {
    return db.chatRoom.delete({ where: { id: roomId } })
  },
  async listMessages(roomId: string) {
    return db.chatMessage.findMany({ where: { roomId }, orderBy: { createdAt: 'asc' }, include: { replies: true } })
  },
  async sendMessage(orgId: string, data: { roomId: string; senderId: string; senderName: string; body: string; parentId?: string }) {
    return db.chatMessage.create({ data: { ...data, organizationId: orgId } })
  },
}
