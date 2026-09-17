const BITCOIN_RPC_URL = process.env.E2E_BITCOIN_RPC_URL ?? 'http://localhost:18443';

const BITCOIN_RPC_USER = process.env.BITCOIN_RPC_USER ?? 'e2e';
const BITCOIN_RPC_PASSWORD = process.env.BITCOIN_RPC_PASSWORD ?? 'e2e-password';

const BITCOIN_RPC_WALLET = process.env.BITCOIN_RPC_WALLET ?? 'e2e';

type BitcoinRpcResponse<T> = {
    result: T;
    error: {
        code: number;
        message: string;
    } | null;
    id: number;
};

let requestId = 0;

async function bitcoinRpc<T>(method: string, params: unknown[] = [], wallet = false): Promise<T> {
    const auth = Buffer.from(`${BITCOIN_RPC_USER}:${BITCOIN_RPC_PASSWORD}`).toString('base64');

    const baseUrl = BITCOIN_RPC_URL.replace(/\/$/, '');

    const url = wallet ? `${baseUrl}/wallet/${encodeURIComponent(BITCOIN_RPC_WALLET)}` : baseUrl;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
            jsonrpc: '1.0',
            id: ++requestId,
            method,
            params,
        }),
    });

    if (!response.ok) {
        throw new Error(`Bitcoin RPC HTTP ${response.status}: ${await response.text()}`);
    }

    const body = (await response.json()) as BitcoinRpcResponse<T>;

    if (body.error) {
        throw new Error(`Bitcoin RPC ${body.error.code}: ${body.error.message}`);
    }

    return body.result;
}

export async function waitForBitcoin(timeoutMs = 60_000, intervalMs = 1_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    console.log(`Waiting for Bitcoin Core at ${BITCOIN_RPC_URL}...`);

    while (Date.now() < deadline) {
        try {
            const info = await bitcoinRpc<{
                chain: string;
                blocks: number;
            }>('getblockchaininfo');

            if (info.chain === 'regtest') {
                console.log(`Bitcoin Core is ready. Current block: ${info.blocks}`);
                return;
            }
        } catch {
            // Bitcoin Core is not ready yet.
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Bitcoin Core did not become ready within ${timeoutMs}ms: ${BITCOIN_RPC_URL}`);
}

export async function ensureBitcoinWallet(walletName = BITCOIN_RPC_WALLET): Promise<void> {
    const wallets = await bitcoinRpc<string[]>('listwallets');

    if (wallets.includes(walletName)) {
        return;
    }

    const walletDir = await bitcoinRpc<{
        wallets: Array<{ name: string }>;
    }>('listwalletdir');

    const exists = walletDir.wallets.some((wallet) => wallet.name === walletName);

    if (exists) {
        await bitcoinRpc('loadwallet', [walletName]);
        return;
    }

    await bitcoinRpc('createwallet', [walletName]);
}

export async function getBitcoinNewAddress(): Promise<string> {
    return bitcoinRpc<string>('getnewaddress', [], true);
}

export async function getBitcoinBalance(): Promise<number> {
    return bitcoinRpc<number>('getbalance', [], true);
}

export async function generateBitcoinBlocks(blocks: number, address: string): Promise<string[]> {
    return bitcoinRpc<string[]>('generatetoaddress', [blocks, address]);
}

export async function sendBitcoin(address: string, amountBtc: number): Promise<string> {
    return bitcoinRpc<string>('sendtoaddress', [address, amountBtc], true);
}

export async function getBitcoinTransaction(txHash: string): Promise<{
    confirmations?: number;
    blockhash?: string;
    blockheight?: number;
}> {
    return bitcoinRpc('getrawtransaction', [txHash, true]);
}
