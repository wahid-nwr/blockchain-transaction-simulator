# Postman: Blockchain Reconciliation Smoke Test

Manual end-to-end walkthrough of the balance reconciliation flow against the
local docker-compose stack (`docker compose up`).

Import `blockchain-reconciliation.postman_collection.json` into Postman and run
the folders **in order**. One step is manual because role changes are
deliberately not exposed through the API.

| Step | What it does |
| --- | --- |
| 01 Create Tenant, Register User | New tenant and user per run |
| 01 **MANUAL: promote to ADMIN** | Run the SQL printed in the Postman Console, **before** Login (the role is read from the JWT) |
| 02 Login | Saves `accessToken` |
| 03 Deploy MiniUSDT | Deploys a fresh contract on Anvil; saves `tokenContractAddress` |
| 03 Create Custodial Sender / Receiver Wallet | `POST /wallets/custodial`: the platform generates and encrypts the keys |
| 03 Fund Wallets With Gas | Anvil only (`anvil_setBalance`); generated wallets start with 0 ETH |
| 03 Create Token | Registers the deployed contract (ADMIN) |
| 04 Mint, Transfer | Mint to the sender, then transfer to the receiver |
| 05 Latest Block, Reconcile | Compares the indexed balance with the chain |

## Notes

- Local only. Never point it at a real network without replacing the Anvil funding step.
- Defaults assume Anvil on `localhost:8545` (`rpcUrl`) and the API on `localhost:3000` (`baseUrl`).
- `miniUsdtBytecode` is a snapshot of `contracts/MiniUSDT.sol` compiled with solc 0.8.24 (optimizer, 200 runs). Re-sync it if the contract changes.
- Anvil starts empty on every restart, so always run Deploy MiniUSDT first.
- On a public testnet, fund the generated addresses from a faucet or a treasury key instead of `anvil_setBalance`.
