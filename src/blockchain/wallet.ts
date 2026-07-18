import { privateKeyToAccount } from 'viem/accounts';

export function createAccount(privateKey: string) {
    return privateKeyToAccount(privateKey as `0x${string}`);
}
