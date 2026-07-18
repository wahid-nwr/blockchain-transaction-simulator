import dotenv from 'dotenv';
import { beforeEach, afterAll } from 'vitest';
import { cleanupDatabase } from './helpers/cleanup.js';
import { prisma } from '../src/database/prisma.js';

dotenv.config({
    path: ".env.test"
});

beforeEach(async () => {
    await cleanupDatabase();
});

afterAll(async () => {
    await prisma.$disconnect();
});
