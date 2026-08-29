import { Gauge } from 'prom-client';
import { registerMetric } from './metrics.js';

/**
 * Current application deployment metadata.
 *
 * Example:
 *
 * deployment_info{
 *   version="v1.0.2",
 *   commit="a82fd91",
 *   deployment_id="20260806-220119"
 * } 1
 */
export const deploymentInfo = registerMetric(
    new Gauge({
        name: 'deployment_info',
        help: 'Current application deployment information',
        labelNames: ['version', 'commit', 'deployment_id', 'deployment_created_at'],
        registers: [],
    }),
);
