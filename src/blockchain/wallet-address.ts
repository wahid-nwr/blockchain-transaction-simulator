import { isAddress as isEvmAddress } from 'viem';

export const ANVIL_CHAIN_ID = 31337;
export const BITCOIN_REGTEST_CHAIN_ID = 18444;

export function isValidWalletAddress(chainId: number, address: string): boolean {
    switch (chainId) {
        case ANVIL_CHAIN_ID:
            return isEvmAddress(address);

        case BITCOIN_REGTEST_CHAIN_ID:
            return isBitcoinRegtestAddress(address);

        default:
            return false;
    }
}

function isBitcoinRegtestAddress(address: string): boolean {
    if (!address) {
        return false;
    }

    return (
        /^bcrt1[ac-hj-np-z02-9]{8,87}$/i.test(address) ||
        /^[mn2][1-9A-HJ-NP-Za-km-z]{25,39}$/.test(address)
    );
}
