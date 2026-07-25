import { EventListenerWorker } from './event-listener.worker.js';

const worker = new EventListenerWorker();

worker.start();

process.on('SIGTERM', () => worker.stop());

process.on('SIGINT', () => worker.stop());
