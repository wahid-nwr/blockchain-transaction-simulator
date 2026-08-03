import { Hex } from 'viem';

import { Errors } from '../common/errors/errors.js';

const SIGNERS: Record<string, Hex> = {
    '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266':
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',

    '0x70997970c51812dc3a010c7d01b50e0d17dc79c8':
        '0x59c6995e998f97a5a0044966f094538e5d9d3154b79b6c8b8b6d5a8f8f8f8f8f',

    '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc':
        '0x5de4111afa1a4b94908d9f33669435e7ef1be14f58b8a7c44d2e4d0d7b5f9f31',
};

export class SignerService {
    async getPrivateKey(walletAddress: string): Promise<Hex> {
        const key = SIGNERS[walletAddress.toLowerCase()];

        if (!key) {
            throw Errors.walletNotFound();
        }

        return key;
    }
}
