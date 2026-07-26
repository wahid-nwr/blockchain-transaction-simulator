import pino from 'pino';
import { getContext } from './context.js';

const baseLogger = pino({
    level: process.env.LOG_LEVEL ?? 'info',

    base: {
        service: 'blockchain-transaction-simulator',

        environment: process.env.NODE_ENV ?? 'development',
    },

    timestamp: pino.stdTimeFunctions.isoTime,
});

export function getLogger() {
    return baseLogger.child(getContext());
}

export { baseLogger };
