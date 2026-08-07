import { prisma } from '../../database/prisma.js';
import { publicClient } from '../../blockchain/client.js';
import { getLogger } from '../../observability/logger.js';

export async function checkReadiness() {
    const checks: Record<string, string> = {};

    try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = 'ok';
    } catch {
        checks.database = 'failed';
    }

    try {
        getLogger().warn(
            {
                'rpc-url': process.env.RPC_URL,
            },
            'Trying blockchain RPC block number',
        );
        await publicClient.getBlockNumber();
        checks.rpc = 'ok';
    } catch (error) {
        checks.rpc = 'failed';
        getLogger().error(
            {
                error,
            },
            'readiness.rpc.failed',
        );
    }

    const healthy = Object.values(checks).every((value) => value === 'ok');

    return {
        healthy,
        status: healthy ? 'ready' : 'not_ready',
        checks,
        timestamp: new Date().toISOString(),
    };
}
