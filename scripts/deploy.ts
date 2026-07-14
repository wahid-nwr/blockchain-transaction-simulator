import hre from "hardhat";

async function main() {
    const { ethers } = await hre.network.connect();
    const MiniUSDT = await ethers.getContractFactory(
        "MiniUSDT"
    );
    const token = await MiniUSDT.deploy();
    await token.waitForDeployment();
    const address = await token.getAddress();
    console.log(
        "MiniUSDT deployed:",
        address
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});