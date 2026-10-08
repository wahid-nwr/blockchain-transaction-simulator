import client from 'prom-client';
import { register } from './registry.js';

export const eventListenerCyclesTotal = new client.Counter({
    name: 'event_listener_cycles_total',
    help: 'Total event listener processing cycles',
    registers: [register],
});

export const eventListenerFailuresTotal = new client.Counter({
    name: 'event_listener_failures_total',
    help: 'Total failed event listener cycles',
    registers: [register],
});

export const eventListenerEventsProcessedTotal = new client.Counter({
    name: 'event_listener_events_processed_total',
    help: 'Total blockchain events processed',
    registers: [register],
});

export const eventListenerEventsSkippedTotal = new client.Counter({
    name: 'event_listener_events_skipped_total',
    help: 'Total duplicate blockchain events skipped',
    registers: [register],
});

export const eventListenerDuration = new client.Histogram({
    name: 'event_listener_processing_duration_seconds',
    help: 'Event listener processing duration',
    registers: [register],
});

// Chain head minus the last block fully indexed, per token. Near zero when
// the indexer keeps up; growing means it is falling behind (slow or
// rate-limited RPC, or still catching up after downtime). The one metric that
// says "is my indexed state current?", which the cycle counters cannot.
export const eventListenerLagBlocks = new client.Gauge({
    name: 'event_listener_lag_blocks',
    help: 'Blocks between the chain head and the last block indexed, per token',
    labelNames: ['token_id'],
    registers: [register],
});
