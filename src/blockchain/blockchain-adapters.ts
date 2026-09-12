import { BlockchainAdapterRegistry } from './blockchain-adapter.registry.js';
import { EvmAdapter } from './evm/evm.adapter.js';
import { SignerService } from '../services/signer.service.js';
import { WalletRepository } from '../repositories/wallet.repository.js';

export const blockchainAdapterRegistry = new BlockchainAdapterRegistry([
    new EvmAdapter(new SignerService(new WalletRepository())),
]);
