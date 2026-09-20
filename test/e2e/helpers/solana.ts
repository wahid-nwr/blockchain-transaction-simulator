import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

const SOLANA_RPC_URL =
    process.env.E2E_SOLANA_RPC_URL ?? process.env.SOLANA_RPC_URL ?? 'http://localhost:8899';

// Uses @solana/web3.js directly rather than hand-rolling JSON-RPC the way
// helpers/bitcoin.ts does — that mirrors production's BitcoinRpcClient
// being hand-rolled too, whereas production's SolanaAdapter already uses
// this same SDK, so the test helper does too rather than adding a second,
// redundant way of talking to the same RPC.
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

export async function waitForSolana(timeoutMs = 60_000, intervalMs = 1_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    console.log(`Waiting for Solana test validator at ${SOLANA_RPC_URL}...`);

    while (Date.now() < deadline) {
        try {
            const version = await connection.getVersion();

            console.log(`Solana test validator is ready. Version: ${version['solana-core']}`);
            return;
        } catch {
            // Not ready yet.
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(
        `Solana test validator did not become ready within ${timeoutMs}ms: ${SOLANA_RPC_URL}`,
    );
}

export function generateSolanaKeypair(): Keypair {
    return Keypair.generate();
}

export function getSolanaConnection(): Connection {
    return connection;
}

export async function getSolanaSignatureStatus(signature: string) {
    const { value } = await connection.getSignatureStatuses([signature]);

    return value[0];
}

// Airdrops are localnet/devnet-only (no real value, unlimited supply) —
// this is Solana's equivalent of Anvil's setBalance cheat code / Bitcoin
// regtest's generatetoaddress-to-self funding pattern. confirmTransaction
// is awaited so the funded balance is actually usable by the very next
// call, not just broadcast.
export async function airdropSol(publicKey: PublicKey, sol = 10): Promise<void> {
    const signature = await connection.requestAirdrop(publicKey, sol * LAMPORTS_PER_SOL);
    const latestBlockhash = await connection.getLatestBlockhash();

    await connection.confirmTransaction({ signature, ...latestBlockhash }, 'confirmed');
}

export async function getSolanaBalanceLamports(publicKey: PublicKey): Promise<number> {
    return connection.getBalance(publicKey);
}
