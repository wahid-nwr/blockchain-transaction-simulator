import { defineConfig } from 'hardhat/config';
import hardhatEthers from '@nomicfoundation/hardhat-ethers';

export default defineConfig({
    plugins: [hardhatEthers],
    solidity: {
        version: '0.8.24',
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    networks: {
        localhost: {
            type: 'http',
            url: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
        },
    },
});
