import './rpc.metrics.js';
import './transaction.metrics.js';
import './worker.metrics.js';
import { deploymentInfo } from './health.metrics.js';

export function initializeDeploymentMetrics() {
    deploymentInfo.set(
        {
            version: process.env.APP_VERSION ?? 'unknown',
            commit: process.env.GIT_SHA ?? 'unknown',
            deployment_id: process.env.DEPLOYMENT_ID ?? 'unknown',
            deployment_created_at: process.env.DEPLOYMENT_CREATED_AT ?? 'unknown',
        },
        1,
    );
}
