# Postman: Blockchain Reconciliation Smoke Test

Manual end-to-end walkthrough of the balance reconciliation flow against the
local docker-compose stack (`docker compose up`).

Import `blockchain-reconciliation.postman_collection.json` into Postman and run
the folders **in order**. Two steps are manual because the API deliberately does
not expose them (role changes, wallet custody).

| Step | What it does |
| --- | --- |
| 01 Create Tenant, Register User | New tenant and user per run |
| 01 **MANUAL: promote to ADMIN** | Run the SQL printed in the Postman Console, **before** Login (the role is read from the JWT) |
| 02 Login | Saves `accessToken` |
| 03 Deploy MiniUSDT | Deploys a fresh contract on Anvil; saves `tokenContractAddress` |
| 03 Create Sender/Receiver Wallet, Create Token | Wallets use Anvil accounts #1 and #2 |
| 03 **MANUAL: make wallets CUSTODIAL** | Run the two `docker exec ... scripts/attach-custody-key.mjs` commands printed in the Console, from the repo root |
| 04 Mint, Transfer | Mint to the sender, then transfer to the receiver |
| 05 Latest Block, Reconcile | Compares the indexed balance with the chain |

## Notes

- Local only. The collection contains Anvil's public dev keys; never point it at a real network.
- Defaults assume the compose names: `blockchain-api`, `blockchain-postgres`, Anvil on `localhost:8545`. Change the collection variables if yours differ.
- `miniUsdtBytecode` is a snapshot of `contracts/MiniUSDT.sol` compiled with solc 0.8.24 (optimizer, 200 runs). Re-sync it if the contract changes.
- Anvil starts empty on every restart, so a contract address from a previous session is gone. Always run Deploy MiniUSDT first.
- The Transfer request's route and body must match your real transfer endpoint.
