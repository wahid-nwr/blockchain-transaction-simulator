import { prisma } from '../../database/prisma.js';
import { publicClient } from '../../blockchain/client.js';
import { getEvmChainId } from '../../blockchain/evm/chain.js';
import { getLogger } from '../../observability/logger.js';

export async function checkReadiness() {
    const checks: Record<string, string> = {};

    checks.redis = 'ok'; // TODO implement this
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

        // Reachable is not enough: an RPC URL pointing at the wrong network
        // would read the wrong balances and sign for the wrong chain.
        const expectedChainId = getEvmChainId();
        const actualChainId = await publicClient.getChainId();

        if (actualChainId === expectedChainId) {
            checks.rpc = 'ok';
        } else {
            checks.rpc = 'chain_mismatch';
            getLogger().error(
                { expectedChainId, actualChainId },
                'readiness.rpc.chain_mismatch: RPC_URL serves a different chain than EVM_CHAIN_ID',
            );
        }
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
