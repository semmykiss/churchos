import { PrismaClient } from "@prisma/client";

/**
 * BACKEND ONLY — never import from client components.
 * Single Prisma client for the whole server layer.
 */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
