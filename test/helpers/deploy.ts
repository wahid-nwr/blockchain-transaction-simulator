import hre from 'hardhat';
import { getAddress } from 'viem';

export async function deployMiniUSDT() {
    const { ethers } = await hre.network.connect('localhost');

    const MiniUSDT = await ethers.getContractFactory('MiniUSDT');

    const token = await MiniUSDT.deploy();

    await token.waitForDeployment();

    const address = await token.getAddress();
    const provider = ethers.provider;

    console.log(await provider.getNetwork());
    console.log(await provider.getBlockNumber());

    const code = await provider.getCode(address);
    console.log('ETHERS CODE LENGTH', code.length);

    return getAddress(address);
}
