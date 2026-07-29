# ADR 002: Ledger Service Abstraction

## Status

Accepted

## Date

2026-07-29

---

# Context

Blockchain transaction systems require interaction with:

* Blockchain networks
* Transaction storage
* Application workflows

Direct blockchain interaction from business services creates tight coupling.

Example:

```text
Transaction Service

        |
        v

Blockchain Client

        |
        v

RPC Provider
```

This makes testing and future changes difficult.

---

# Decision

Introduce a Ledger Service abstraction responsible for transaction lifecycle persistence.

The ledger layer acts as a boundary between:

* Business workflows
* Blockchain infrastructure
* Database persistence

Architecture:

```text
Application Services

        |

        v

Ledger Service

        |

        +-------------+
        |             |

        v             v

 Database       Blockchain State
```

---

# Responsibilities

The ledger layer manages:

* Transaction creation
* Transaction hash attachment
* Status updates
* Confirmation metadata
* Failure recording

---

# Consequences

## Positive

### Better Separation

Business services do not need database implementation details.

---

### Easier Testing

Ledger behavior can be tested independently.

---

### Future Flexibility

Possible future changes:

* Different persistence model
* External ledger service
* Multi-chain support

---

## Negative

### Additional Layer

Adds another abstraction that developers must understand.

---

### Requires Discipline

Services should not bypass the ledger abstraction.

---

# Alternatives Considered

## Direct Repository Usage Everywhere

Rejected because:

* Business logic becomes coupled to persistence
* Lifecycle rules become scattered

---

## Blockchain Client as Source of Truth

Rejected because:

* Blockchain does not store application metadata
* Additional business context is required

---

# Future Improvements

Possible extensions:

* Ledger event publishing
* Transaction history service
* Multi-network transaction tracking
