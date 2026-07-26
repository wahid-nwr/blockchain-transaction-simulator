import { Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({
    register: registry,
});

export async function metricsText() {
    return registry.metrics();
}
