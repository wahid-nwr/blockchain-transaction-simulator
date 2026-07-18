import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
    log: ['error', 'warn'],
});

process.on('beforeExit', async () => {
    await prisma.$disconnect();
});
