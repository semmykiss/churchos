// ChurchOS — Prisma client with serverless (Vercel) support.
//
// Local: DATABASE_URL points at db/custom.db (persistent SQLite).
// Vercel: the repo's pre-seeded db/custom.db is bundled into each lambda via
// outputFileTracingIncludes (next.config.ts). The lambda filesystem is
// read-only, so we copy it to /tmp (writable) on cold start and point
// DATABASE_URL there. Reads are consistent across lambdas; writes are
// per-invocation ephemeral. For persistent writes migrate to Turso —
// see DEPLOYMENT.md.
import path from 'path'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'

function prepareDatabaseUrl(): string | undefined {
  if (!process.env.VERCEL) return process.env.DATABASE_URL

  const candidates = [
    path.join(process.cwd(), 'db', 'custom.db'),
    '/var/task/db/custom.db',
    path.resolve(process.cwd(), '..', 'db', 'custom.db'),
    path.resolve(process.cwd(), 'src', '..', 'db', 'custom.db'),
  ]
  const source = candidates.find((p) => fs.existsSync(p))
  if (!source) {
    console.error(
      '[db] Vercel: bundled db/custom.db not found. Tried:',
      candidates.join(', ')
    )
    return process.env.DATABASE_URL
  }

  const dest = '/tmp/churchos.db'
  try {
    if (!fs.existsSync(dest)) {
      const tmp = `${dest}.${process.pid}.tmp`
      fs.copyFileSync(source, tmp)
      fs.renameSync(tmp, dest) // atomic — safe under concurrent cold starts
    }
    return `file:${dest}`
  } catch (err) {
    console.error('[db] Vercel: failed to copy bundled db to /tmp:', err)
    return process.env.DATABASE_URL
  }
}

const resolvedDatabaseUrl = prepareDatabaseUrl()
if (resolvedDatabaseUrl) process.env.DATABASE_URL = resolvedDatabaseUrl

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
