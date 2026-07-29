import { Registry, collectDefaultMetrics, Metric, Counter, Histogram } from 'prom-client';
import { getLogger } from './logger.js';

export const registry = new Registry();

collectDefaultMetrics({
    register: registry,
});

export function incrementMetric(metric: Counter<string>, labels?: Record<string, string>) {
    try {
        if (labels) {
            metric.inc(labels);
        } else {
            metric.inc();
        }
    } catch (error) {
        getLogger().warn({ error }, 'metric.increment.failed');
    }
}

export function safeObserve(
    metric: Histogram<string>,
    value: number,
    labels?: Record<string, string>,
) {
    try {
        metric.observe(labels ?? {}, value);
    } catch (error) {
        getLogger().warn({ error }, 'metric.observe.failed');
    }
}

export async function metricsText() {
    return registry.metrics();
}

/*export function registerMetric<T extends Metric>(metric: T): T {
    try {
        registry.registerMetric(metric);
    } catch (error) {
        const message =
            error instanceof Error ? error.message : '';

        if (!message.includes('already been registered')) {
            throw error;
        }
    }

    return metric;
}*/
export function registerMetric<T extends Metric>(metric: T): T {
    console.log(
        "REGISTERING METRIC",
        metric
    );

    registry.registerMetric(metric);

    return metric;
}

export function observeMetric(
    metric: Histogram<string>,
    value: number,
    labels?: Record<string, string>,
) {
    try {
        if (labels) {
            metric.observe(labels, value);
        } else {
            metric.observe(value);
        }
    } catch (error) {
        getLogger().warn({ error }, 'metric.observe.failed');
    }
}
