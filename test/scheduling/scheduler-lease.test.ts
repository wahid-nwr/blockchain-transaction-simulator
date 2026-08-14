import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/database/prisma.js';
import { PostgresSchedulerLease } from '../../src/scheduling/postgres-scheduler-lease.js';
import { cleanupDatabase } from '../helpers/cleanup.js';

describe('PostgresSchedulerLease', () => {
    beforeEach(async () => {
        await cleanupDatabase();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('allows one owner to acquire a lease', async () => {
        const lease = new PostgresSchedulerLease();

        await expect(lease.acquire('test-scheduler', 60_000)).resolves.toBe(true);
        await expect(lease.release('test-scheduler')).resolves.toBeUndefined();
    });

    it('prevents another owner from acquiring an active lease', async () => {
        const first = new PostgresSchedulerLease();
        const second = new PostgresSchedulerLease();

        await expect(first.acquire('test-scheduler', 60_000)).resolves.toBe(true);
        await expect(second.acquire('test-scheduler', 60_000)).resolves.toBe(false);

        await first.release('test-scheduler');
    });

    it('allows another owner to acquire an expired lease', async () => {
        const first = new PostgresSchedulerLease();
        const second = new PostgresSchedulerLease();

        await expect(first.acquire('test-scheduler', 1)).resolves.toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 10));

        await expect(second.acquire('test-scheduler', 60_000)).resolves.toBe(true);
        await second.release('test-scheduler');
    });

    it('renews only a lease owned by the current instance', async () => {
        const first = new PostgresSchedulerLease();
        const second = new PostgresSchedulerLease();

        await expect(first.acquire('test-scheduler', 60_000)).resolves.toBe(true);
        await expect(second.renew('test-scheduler', 60_000)).resolves.toBe(false);
        await expect(first.renew('test-scheduler', 60_000)).resolves.toBe(true);

        await first.release('test-scheduler');
    });

    it('does not allow a previous owner to release a lease after ownership changes', async () => {
        const first = new PostgresSchedulerLease();
        const second = new PostgresSchedulerLease();

        await first.acquire('test-scheduler', 1);
        await new Promise((resolve) => setTimeout(resolve, 10));
        await second.acquire('test-scheduler', 60_000);

        await first.release('test-scheduler');

        await expect(second.renew('test-scheduler', 60_000)).resolves.toBe(true);
        await second.release('test-scheduler');
    });

    it('rejects invalid TTL values', async () => {
        const lease = new PostgresSchedulerLease();

        await expect(lease.acquire('test-scheduler', 0)).rejects.toThrow(
            'Scheduler lease TTL must be greater than zero',
        );
    });

    it('allows only one of two concurrent worker instances to acquire a lease', async () => {
        const first = new PostgresSchedulerLease();
        const second = new PostgresSchedulerLease();

        const [firstAcquired, secondAcquired] = await Promise.all([
            first.acquire('multi-worker-scheduler', 60_000),
            second.acquire('multi-worker-scheduler', 60_000),
        ]);

        expect([firstAcquired, secondAcquired].filter(Boolean)).toHaveLength(1);

        await first.release('multi-worker-scheduler');
        await second.release('multi-worker-scheduler');
    });
});
