/**
 * Deploys MiniUSDT to any EVM network with a local signer: a public testnet,
 * or Anvil. (scripts/deploy-mini-usdt.ts, which CI uses, relies on the node
 * holding unlocked accounts, which only a dev node does.)
 *
 *   RPC_URL=https://... EVM_CHAIN_ID=46630 PRIVATE_KEY=0x... \
 *     npm run deploy:live            # dry run: prints the plan, deploys nothing
 *     npm run deploy:live -- --yes   # actually deploy
 *
 * Needs `npm run compile` first (reads artifacts/contracts/MiniUSDT.sol).
 *
 * The account behind PRIVATE_KEY becomes the token's owner, the only account
 * that can mint, and is the same key the API signs mints with. Use that same
 * key as the API's PRIVATE_KEY secret.
 */
import 'dotenv/config';

import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, encodeDeployData, http, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getEvmChain, getEvmChainId } from '../src/blockchain/evm/chain.js';
import {
    DeploySafetyError,
    assertDeployAllowed,
    describeRpcError,
    isLocalChain,
    parseDeployerKey,
    redactRpcUrl,
} from '../src/blockchain/evm/deploy-safety.js';

const ARTIFACT_PATH = 'artifacts/contracts/MiniUSDT.sol/MiniUSDT.json';
const RECEIPT_TIMEOUT_MS = 120_000;

function flag(name: string): boolean {
    return process.argv.includes(name);
}

function option(name: string): string | undefined {
    const index = process.argv.indexOf(name);

    return index === -1 ? undefined : process.argv[index + 1];
}

async function loadArtifact(): Promise<{ abi: Abi; bytecode: `0x${string}` }> {
    let raw: string;

    try {
        raw = await readFile(ARTIFACT_PATH, 'utf8');
    } catch {
        throw new DeploySafetyError(`${ARTIFACT_PATH} not found. Run \`npm run compile\` first.`);
    }

    const artifact = JSON.parse(raw) as { abi?: Abi; bytecode?: string };

    if (!artifact.abi || !artifact.bytecode || artifact.bytecode === '0x') {
        throw new DeploySafetyError(
            `${ARTIFACT_PATH} has no ABI/bytecode. Re-run \`npm run compile\`.`,
        );
    }

    return { abi: artifact.abi, bytecode: artifact.bytecode as `0x${string}` };
}

async function main() {
    const rpcUrl = process.env.RPC_URL?.trim();

    if (!rpcUrl) {
        throw new DeploySafetyError('RPC_URL is not set');
    }

    const account = privateKeyToAccount(parseDeployerKey(process.env.PRIVATE_KEY));
    const configuredChainId = getEvmChainId();
    const chain = getEvmChain();
    const local = isLocalChain(configuredChainId);

    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

    let rpcChainId: number;

    try {
        rpcChainId = await publicClient.getChainId();
    } catch (error) {
        throw new DeploySafetyError(
            `Cannot reach the RPC at ${redactRpcUrl(rpcUrl)}: ${describeRpcError(error)}`,
        );
    }

    const { abi, bytecode } = await loadArtifact();
    const data = encodeDeployData({ abi, bytecode, args: [] });

    const [balance, gasPrice, gas] = await Promise.all([
        publicClient.getBalance({ address: account.address }),
        publicClient.getGasPrice(),
        publicClient.estimateGas({ account, data }),
    ]);

    // Headroom: price and gas move between estimate and inclusion.
    const estimatedCost = (gas * gasPrice * 12n) / 10n;

    console.log('MiniUSDT deployment plan');
    console.log(`  network:   ${chain.name} (chain id ${rpcChainId})`);
    console.log(`  rpc:       ${redactRpcUrl(rpcUrl)}`);
    console.log(`  deployer:  ${account.address}  (becomes owner: the only account that can mint)`);
    console.log(`  balance:   ${balance} wei`);
    console.log(`  est. cost: ~${estimatedCost} wei (gas ${gas}, incl. 20% headroom)`);

    assertDeployAllowed({
        configuredChainId,
        rpcChainId,
        deployerAddress: account.address,
        balance,
        estimatedCost,
    });

    if (!local && !flag('--yes')) {
        console.log('\nDRY RUN: nothing was deployed. Re-run with --yes to deploy.');
        return;
    }

    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

    const hash = await walletClient.deployContract({ abi, bytecode, args: [] });

    console.log(`\nDeployment tx sent: ${hash}`);
    console.log('Waiting for it to be mined...');

    let receipt;

    try {
        receipt = await publicClient.waitForTransactionReceipt({
            hash,
            timeout: RECEIPT_TIMEOUT_MS,
        });
    } catch {
        // Do not resend: the first transaction may still land.
        throw new DeploySafetyError(
            `No receipt for ${hash} within ${RECEIPT_TIMEOUT_MS / 1000}s. It may still be mined: ` +
                'check the explorer before deploying again.',
        );
    }

    if (receipt.status !== 'success' || !receipt.contractAddress) {
        throw new DeploySafetyError(`Deployment transaction ${hash} did not succeed`);
    }

    const address = receipt.contractAddress;

    // Verify the contract by reading it back, not by trusting the receipt.
    const code = await publicClient.getCode({ address });

    if (!code || code === '0x') {
        throw new DeploySafetyError(`No contract code at ${address} after deployment`);
    }

    const [owner, name, symbol, decimals] = await Promise.all([
        publicClient.readContract({ address, abi, functionName: 'owner' }),
        publicClient.readContract({ address, abi, functionName: 'name' }),
        publicClient.readContract({ address, abi, functionName: 'symbol' }),
        publicClient.readContract({ address, abi, functionName: 'decimals' }),
    ]);

    if ((owner as string).toLowerCase() !== account.address.toLowerCase()) {
        throw new DeploySafetyError(
            `Contract owner ${owner} is not the deployer ${account.address}`,
        );
    }

    const explorer = chain.blockExplorers?.default.url;

    const result = {
        address,
        transactionHash: hash,
        deploymentBlock: receipt.blockNumber.toString(),
        chainId: rpcChainId,
        owner: account.address,
        name: name as string,
        symbol: symbol as string,
        decimals: Number(decimals),
    };

    console.log('\nMiniUSDT deployed');
    console.log(`  address:          ${address}`);
    console.log(`  deployment block: ${result.deploymentBlock}`);
    console.log(`  owner:            ${owner}`);

    if (explorer) {
        console.log(`  explorer:         ${explorer}/address/${address}`);
    }

    console.log('\nNext steps');
    console.log('  1. API and worker environment:');
    console.log(`       EVM_CHAIN_ID=${rpcChainId}`);
    console.log('       RPC_URL=<same RPC>');
    console.log('       PRIVATE_KEY=<the key you just deployed with, from your secret store>');
    console.log('  2. Worker environment (skip the empty history when indexing):');
    console.log(`       EVM_INDEX_START_BLOCK=${result.deploymentBlock}`);
    console.log('  3. Register the token (POST /api/v1/tokens, ADMIN):');
    console.log(
        `       ${JSON.stringify({
            tokenId: '<any new uuid>',
            name: result.name,
            symbol: result.symbol,
            blockchain: 'EVM',
            contractAddress: address,
            decimals: result.decimals,
        })}`,
    );

    const out = option('--out');

    if (out) {
        await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        console.log(`\nWrote ${out}`);
    }
}

main().catch((error: unknown) => {
    if (error instanceof DeploySafetyError) {
        console.error(`\nRefusing to deploy: ${error.message}`);
    } else {
        // Never print the raw error: provider errors embed the full RPC URL,
        // which usually contains the API key, and this output ends up in CI logs.
        console.error(`\nDeployment failed: ${describeRpcError(error)}`);
    }

    process.exit(1);
});
