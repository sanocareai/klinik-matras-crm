import { PrismaClient } from "@prisma/client";

// Satu instance Prisma dipakai di seluruh aplikasi (best practice)
export const prisma = new PrismaClient();
