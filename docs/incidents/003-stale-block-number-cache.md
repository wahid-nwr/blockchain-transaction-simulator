# Incident: stale cached block number caused BlockOutOfRangeError

## Status

Resolved.

## Summary

`src/workers/event.listener.ts` and `src/blockchain/client.ts` each create a
`viem` `publicClient` once, at module load, and reuse it for the lifetime of
the process. `publicClient.getBlockNumber()` caches its result for
`cacheTime` ms — which defaults to the client's `pollingInterval` (4000ms)
when not set explicitly.

Under normal chain operation this is harmless: block height only increases,
so a briefly stale "current block" is at worst a few seconds behind, never
wrong in a way that breaks a request. The bug is that this assumption
("block height never goes backwards") doesn't hold whenever the underlying
node's state can be reset or rolled back — which is exactly what
`anvil_reset` does in the integration test suite, and what a testnet
reset, local dev node restart, or RPC-provider failover could do outside
tests.

Sequence that reproduced it in
`test/integration/blockchain.lifecycle.test.ts`:

1. An earlier test (or an earlier point in the same run) advances the
   shared Anvil chain to some height, and the singleton client's
   `getBlockNumber()` cache picks up that value.
2. `beforeEach` calls `resetAnvil()` (`anvil_reset`), which resets the chain
   back to genesis and re-mines a small number of blocks. Chain height is
   now lower than it was before the reset.
3. All of this happens well within the client's 4-second cache window, so
   `client.getBlockNumber()` inside `processTokenEvents` returns the
   **stale, higher** cached value instead of the node's real, lower
   current height.
4. That stale value is used as `toBlock` in the `eth_getLogs` call, and
   Anvil correctly rejects it: `BlockOutOfRangeError: block height is 2 but
   requested was 3`.

## How it surfaced

`should not duplicate transfer events when listener runs twice`
(`blockchain.lifecycle.test.ts`) failed intermittently with an
`InvalidParamsRpcError` wrapping a `BlockOutOfRangeError`, with no code
path in the assertion itself (duplicate-event counting) that could produce
it. The error surfaced from inside `client.getLogs()`, before any
duplicate-detection logic ran, which pointed at block-range computation
rather than the listener's idempotency logic. Tracing `fromBlock`/`toBlock`
back to `client.getBlockNumber()`, and from there to viem's default
`cacheTime` behavior on a module-level singleton client, explained both the
specific numbers in the error and why it was intermittent rather than
deterministic (timing-dependent on whether the stale cache window had
elapsed).

## Fix

Both singleton clients now set `cacheTime: 0`, so `getBlockNumber()` (and
any other cache-eligible read) always hits the RPC endpoint fresh rather
than trusting a time-based cache that has no way to know the underlying
chain state was reset:

- `src/workers/event.listener.ts`
- `src/blockchain/client.ts`

This trades a small amount of extra RPC traffic for correctness. Given
both clients talk to a single local/managed RPC endpoint rather than a
public multi-tenant one, the extra calls are not a meaningful cost.

## Follow-up

- Any future module-level/singleton `createPublicClient` should set
  `cacheTime: 0` (or otherwise deliberately opt into caching with a clear
  comment as to why staleness is acceptable there) rather than inheriting
  viem's default silently.
- This class of bug — long-lived client, hidden time-based cache, external
  state that can move backwards — isn't unique to Anvil resets. It would
  reproduce against any RPC endpoint that can roll back or restart
  (testnet resets, local dev node restarts, RPC-provider failover to a
  node that hasn't caught up yet). Worth keeping in mind if the event
  listener is ever pointed at something other than a stable mainnet-style
  RPC endpoint.
