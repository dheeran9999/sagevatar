import { PrismaClient } from '@prisma/client';

// Single shared client for the process.
export const prisma = new PrismaClient();
