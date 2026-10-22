// ChurchOS — Repository Index
// Enterprise-grade data access layer. Each module has its own repository
// that encapsulates ALL database operations for that domain.
//
// Usage in API routes:
//   import { MembersRepo } from '@/lib/repositories'
//   const members = await MembersRepo.list(orgId, { q, status, page })
//
// This gives clean separation of concerns:
// - API routes handle HTTP (request parsing, response formatting, auth)
// - Repositories handle data access (queries, filters, relations)
// - The Prisma client (single connection) is shared across all repositories
//
// Architecture:
//   API Route → requirePermission() → Repository → Prisma → SQLite
//
// Tenant isolation is enforced at the repository level:
// every method requires organizationId as the first parameter.

export { MembersRepo } from './members.repository'
export { FinanceRepo } from './finance.repository'
export { AttendanceRepo } from './attendance.repository'
export { EventsRepo } from './events.repository'
export { TasksRepo } from './tasks.repository'
export { ChatRepo } from './chat.repository'
export { PastoralRepo } from './pastoral.repository'
export { IdentityRepo } from './identity.repository'
