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
