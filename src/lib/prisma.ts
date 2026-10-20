import { PrismaClient, type Prisma } from '@prisma/client';

/** Eén PrismaClient per proces (Next.js dev-server herlaadt modules). */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Client binnen of buiten een transactie. */
export type Db = PrismaClient | Prisma.TransactionClient;
