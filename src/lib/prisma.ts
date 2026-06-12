import { PrismaClient } from '@prisma/client';

// Single shared client — Prisma manages its own connection pool.
const prisma = new PrismaClient();

export default prisma;
