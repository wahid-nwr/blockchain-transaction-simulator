export function requireContractAddress(contractAddress: string | null): string {
    if (!contractAddress) {
        throw new Error('Token contract address is required for EVM token operations');
    }

    return contractAddress;
}
