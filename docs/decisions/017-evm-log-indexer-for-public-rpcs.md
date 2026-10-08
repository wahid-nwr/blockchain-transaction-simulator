# ADR 017: Bounded, Self-Tuning EVM Log Indexing for Public RPCs

# Status

Accepted

# Context

The `Transfer` log indexer (`workers/event.listener.ts`) was written against a local Anvil node, where every request is cheap and the chain is a few hundred blocks long. Against a public RPC three of its assumptions fail:

1. **One unbounded `eth_getLogs`.** Each cycle fetched `[cursor, head]` in a single call. A token with a fresh cursor started at block 0, so the first call spanned the whole chain; providers reject spans (or result counts) above a limit. The cursor never advanced, so the indexer failed identically every cycle and never recovered. The same happens after any downtime long enough to exceed the limit.
2. **No tolerance for throttling.** A failed cycle was retried on the fixed 5 second interval, which deepens rate limiting on a free endpoint.
3. **Indexing right up to `latest`.** A shallow reorg would leave `TokenTransfer` rows and balances from an orphaned block, and there is no rollback.

# Decision

**Windowed scan.** The range is walked in windows of at most `EVM_LOGS_MAX_BLOCK_RANGE` blocks (default 2000). Each window's logs are handled and the cursor is persisted before the next window starts, so a long catch-up keeps its progress if a later window or the process fails. Work per token per cycle is capped at `EVM_INDEX_MAX_WINDOWS_PER_RUN` windows; the remainder continues next cycle.

**Self-tuning window.** If the provider rejects a range (messages such as "block range too large" or "query returned more than 10000 results", found by walking the error's cause chain), the window is halved and retried from the same block. The learned size is remembered for the life of the process so the rejected size is not retried every cycle, and a warning suggests setting `EVM_LOGS_MAX_BLOCK_RANGE`. Rate limiting is detected first and never shrinks the window: some providers report both conditions under JSON-RPC code -32005, so the message decides, not the code.

**Start block.** A token that has never been indexed starts at `EVM_INDEX_START_BLOCK` (default 0, i.e. unchanged locally), not at genesis. Set it to the block the contract was deployed in. Tokens that already have a cursor are unaffected. The indexer warns when it is about to crawl more than 100,000 blocks from genesis, and when the start block is ahead of the head.

**Confirmation depth.** `EVM_INDEX_CONFIRMATIONS` (default 0) indexes only blocks that deep behind the head. This reduces, and does not remove, reorg exposure.

**Worker backoff.** After consecutive failed cycles the delay doubles each time up to 60 seconds, and returns to `EVENT_LISTENER_INTERVAL_MS` after a clean cycle.

**Observability.** `event_listener_lag_blocks{token_id}` is the chain head minus the last indexed block, the one number that says whether indexed state is current. The cursor's existing `failureCount` and `lastFailedSync` columns, previously never written, now record failures.

All settings are parsed strictly and fail at startup on a malformed value. Defaults reproduce the previous behaviour on a local node.

# Consequences

- A fresh database against a live chain indexes from the contract's deployment block in bounded requests instead of failing forever.
- Recovery after downtime is automatic and bounded.
- Per-log detail moved from info to debug level, since a busy chain would otherwise log every event on every cycle.

# Not addressed

- **Reorg rollback.** Confirmation depth is a mitigation. A reorg deeper than that still leaves orphaned rows; handling it needs block-hash tracking and deletion of rows past the fork point.
- **Multiple workers.** The in-process `processingTokens` set does not coordinate across replicas. Double processing is idempotent (events are keyed by transaction hash and log index) but wastes RPC calls; run a single worker per chain.
- **Learned range is per process.** It resets on restart; set `EVM_LOGS_MAX_BLOCK_RANGE` once the right value is known.
- **Provider limits are not known here.** The Robinhood Chain testnet RPC's `eth_getLogs` limits are not documented in anything checked; the defaults are conservative and the self-tuning is the safety net.
- **Chain-specific confirmation semantics.** On an Orbit chain `latest` is the sequencer's view and L1 finality comes later. What depth is "enough" is a judgement, not something the indexer can derive.
- **Transaction confirmation** (the receipt-based worker for submitted transfers) was not changed.
