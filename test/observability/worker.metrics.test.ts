import { describe, it, expect } from 'vitest';

import {
    workerCyclesTotal,
    workerFailuresTotal,
    workerDurationSeconds,
} from '../../src/observability/worker.metrics.js';

describe('worker metrics', () => {
    it('should expose worker cycle metric', async () => {
        workerCyclesTotal.inc({
            worker_name: 'confirmation-worker',
        });

        const metrics = await workerCyclesTotal.get();

        expect(metrics.values[0].value).toBeGreaterThan(0);
    });

    it('should expose worker failure metric', async () => {
        workerFailuresTotal.inc({
            worker_name: 'event-listener-worker',
        });

        const metrics = await workerFailuresTotal.get();

        expect(metrics.values[0].value).toBeGreaterThan(0);
    });

    it('should observe worker duration metric', async () => {
        workerDurationSeconds.observe(
            {
                worker_name: 'confirmation-worker',
            },
            1.5,
        );

        const metrics = await workerDurationSeconds.get();

        expect(metrics.values.length).toBeGreaterThan(0);
    });
});
