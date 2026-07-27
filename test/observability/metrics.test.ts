import { describe, expect, it } from 'vitest';
import { registry, incrementMetric } from '../../src/observability/metrics.js';

import { Counter } from 'prom-client';

describe('Metrics', () => {
    it('should expose prometheus registry', async () => {
        const output = await registry.metrics();

        expect(output).toContain('process_cpu_user_seconds_total');
    });

    it('should increment counter safely', async () => {
        const counter = new Counter({
            name: 'test_metric_counter_total',
            help: 'test counter',
        });

        incrementMetric(counter);

        const metrics = await counter.get();

        expect(metrics.values[0].value).toBe(1);
    });
});
