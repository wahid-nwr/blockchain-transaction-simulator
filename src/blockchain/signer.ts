import { privateKeyToAccount } from 'viem/accounts';
import { Hex } from 'viem';

export type Signer = {
    address: string;
    privateKey: Hex;
};

export function getSignerAccount() {
    const privateKey = process.env.PRIVATE_KEY;

    if (!privateKey) {
        throw new Error('PRIVATE_KEY is missing');
    }

    return privateKeyToAccount(privateKey as `0x${string}`);
}
