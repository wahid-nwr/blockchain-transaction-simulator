import { getBitcoinConfig } from './config.js';

type BitcoinRpcResponse<T> = {
    result: T;
    error: {
        code: number;
        message: string;
    } | null;
    id: number;
};

export class BitcoinRpcClient {
    private readonly config = getBitcoinConfig();

    async call<T>(method: string, params: unknown[] = []): Promise<T> {
        const auth = Buffer.from(
            `${this.config.BITCOIN_RPC_USER}:${this.config.BITCOIN_RPC_PASSWORD}`,
        ).toString('base64');

        const response = await fetch(this.config.BITCOIN_RPC_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Basic ${auth}`,
            },
            body: JSON.stringify({
                jsonrpc: '1.0',
                id: Date.now(),
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
}
