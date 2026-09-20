import { BlockchainAdapterRegistry } from './blockchain-adapter.registry.js';
import { BitcoinAdapter } from './bitcoin/bitcoin.adapter.js';
import { BitcoinRpcClient } from './bitcoin/rpc.client.js';
import { EvmAdapter } from './evm/evm.adapter.js';
import { SolanaAdapter } from './solana/solana.adapter.js';
import { getSolanaConnection } from './solana/connection.js';
import { SignerService } from '../services/signer.service.js';
import { SolanaSignerService } from '../services/solana-signer.service.js';
import { WalletRepository } from '../repositories/wallet.repository.js';

export const blockchainAdapterRegistry = new BlockchainAdapterRegistry([
    new EvmAdapter(new SignerService(new WalletRepository())),
    new BitcoinAdapter(new BitcoinRpcClient()),
    new SolanaAdapter(getSolanaConnection, new SolanaSignerService(new WalletRepository())),
]);
