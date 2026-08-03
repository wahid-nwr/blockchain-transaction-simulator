# ADR 001: Event-Driven Blockchain Indexing

## Status

Accepted

## Date

2026-07-29

---

# Context

Blockchain networks are external systems whose state changes independently from the application database.

A transaction submitted to the blockchain may:

* Confirm later
* Fail
* Emit multiple events
* Require replay after service interruption

A traditional request-response approach where the application immediately updates internal state after submission is insufficient because blockchain confirmation is asynchronous.

Example problem:

```text
Application

     |
     v

Submit Transaction

     |
     v

Blockchain

     |
     v

Confirmation happens later
```

The application cannot assume that submission means completion.

---

# Decision

Adopt an event-driven indexing architecture where blockchain events are treated as the source of truth for state synchronization.

The system uses:

* Blockchain event listeners
* Event persistence
* Cursor tracking
* Idempotent event processing

Flow:

```text
Blockchain Event

        |
        v

Event Listener

        |
        v

Duplicate Check

        |
        v

Database Projection

        |
        v

Application Queries
```

---

# Implementation

The event processing pipeline:

1. Poll blockchain logs
2. Parse contract events
3. Validate event data
4. Check duplicate state
5. Persist token transfer records
6. Synchronize balances

---

# Consequences

## Positive

### Auditability

Every blockchain event can be traced back to the original chain event.

---

### Replay Capability

Events can be reprocessed after:

* Application restart
* Data recovery
* Bug fixes

---

### Reliability

Temporary failures do not permanently lose blockchain state.

---

### Clear Responsibility

Blockchain synchronization is separated from API transaction creation.

---

## Negative

### Eventual Consistency

Database state may temporarily lag behind blockchain state.

---

### Additional Complexity

Requires:

* Event storage
* Cursor management
* Duplicate handling

---

# Alternatives Considered

## Update Database Immediately After Submission

Rejected because:

* Blockchain confirmation is asynchronous
* Transactions may fail
* Internal state may become incorrect

---

## Query Blockchain On Every Request

Rejected because:

* High RPC dependency
* Poor performance
* Increased latency

---

# Future Improvements

Potential enhancements:

* Message queue based event processing
* Multiple blockchain support
* Block reorganization handling
* Event replay tooling
