import hre from 'hardhat';
import { getAddress } from 'viem';
import { writeFileSync } from 'node:fs';

export async function deployMiniUSDT() {
    const { ethers } = await hre.network.connect('localhost');

    const MiniUSDT = await ethers.getContractFactory('MiniUSDT');

    const token = await MiniUSDT.deploy();

    await token.waitForDeployment();

    const address = await token.getAddress();
    try {
        writeFileSync('/e2e/MiniUSDT.address', address, 'utf8');
    } catch {
        // Local/non-E2E execution may not have /e2e mounted.
    }
    const provider = ethers.provider;

    console.log(await provider.getNetwork());
    console.log(await provider.getBlockNumber());

    const code = await provider.getCode(address);
    console.log('ETHERS CODE LENGTH', code.length);

    return getAddress(address);
}
