import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '../database/prisma.js';
import type { SchedulerLease } from './scheduler-lease.js';

export class PostgresSchedulerLease implements SchedulerLease {
    private readonly ownerId = randomUUID();

    async acquire(name: string, ttlMs: number): Promise<boolean> {
        this.assertTtl(ttlMs);

        const rows = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
            INSERT INTO "SchedulerLease" ("name", "ownerId", "expiresAt", "updatedAt")
            VALUES (
                ${name},
                ${this.ownerId},
                NOW() + (${ttlMs} * INTERVAL '1 millisecond'),
                NOW()
            )
            ON CONFLICT ("name") DO UPDATE
            SET
                "ownerId" = EXCLUDED."ownerId",
                "expiresAt" = EXCLUDED."expiresAt",
                "updatedAt" = NOW()
            WHERE
                "SchedulerLease"."expiresAt" <= NOW()
                OR "SchedulerLease"."ownerId" = EXCLUDED."ownerId"
            RETURNING "name"
        `);

        return rows.length === 1;
    }

    async renew(name: string, ttlMs: number): Promise<boolean> {
        this.assertTtl(ttlMs);

        const rows = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
            UPDATE "SchedulerLease"
            SET
                "expiresAt" = NOW() + (${ttlMs} * INTERVAL '1 millisecond'),
                "updatedAt" = NOW()
            WHERE
                "name" = ${name}
                AND "ownerId" = ${this.ownerId}
                AND "expiresAt" > NOW()
            RETURNING "name"
        `);

        return rows.length === 1;
    }

    async release(name: string): Promise<void> {
        await prisma.$executeRaw(Prisma.sql`
            DELETE FROM "SchedulerLease"
            WHERE "name" = ${name}
              AND "ownerId" = ${this.ownerId}
        `);
    }

    private assertTtl(ttlMs: number): void {
        if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
            throw new Error('Scheduler lease TTL must be greater than zero');
        }
    }
}
