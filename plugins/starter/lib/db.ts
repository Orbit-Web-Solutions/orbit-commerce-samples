import { PrismaClient } from "@prisma/client";

/**
 * Your plugin's own database.
 *
 * Orbit's data lives in Orbit and you read it through the API; this is for
 * what only you know — credentials, settings, sync state, your own records.
 *
 * The singleton guard is a Next.js development detail: hot reload would
 * otherwise open a new pool on every edit until the database refuses more.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
