# BLACKOUT INVOICE — Milestones 1–5

## Scope

This slice establishes the first live confidential-invoice path inside Blackpay without weakening the existing Payroll protocol.

### Milestone 1 — Foundation

- Dedicated invoice domain types and visibility classification.
- Deterministic invoice state machine.
- Separate Compact build/runtime asset namespace.
- Existing Blackpay LIVE fail-closed wallet and network assumptions are preserved.

### Milestone 2 — Private invoice model

Private witness fields:

- amount
- tax
- payer commitment
- supplier shielded payout key
- due date
- invoice salt

Payer authorization is deliberately separate from the invoice payload. The payer keeps a private 32-byte authority secret. Compact derives its payer commitment, and the invoice commits only to that derived value. The authority secret is never required by the supplier to create the invoice.

Ledger-visible invoice data is restricted to:

- invoice identifier
- invoice commitment
- token color
- lifecycle status
- action nullifiers

The private witness and any payer authority held by the current participant are stored through the existing encrypted browser private-state architecture, under a separate invoice state ID and storage namespace.

### Milestone 3 — Compact contract

`contract/invoice.compact` implements:

- `createInvoice`
- `acceptInvoice`
- `fundInvoice`
- `payInvoice`
- private payer-authority verification
- invoice commitments
- acceptance nullifiers
- payment nullifiers
- strict CREATED → ACCEPTED → FUNDED → PAID progression
- duplicate identifier and replay protection

Changing any protected witness field changes the Compact commitment. `acceptInvoice` additionally proves that the private payer authority derives to the committed payer identity; knowing the invoice witness alone is insufficient to accept it.

### Milestone 4 — Lace + Midnight

Invoice has a dedicated live runtime built from the same audited primitives already used by Blackpay Payroll:

- Lace DApp Connector
- delegated proving
- Midnight public indexer provider
- wallet balancing
- real transaction submission
- encrypted private state
- generated Compact bindings
- deploy and join flows

Invoice proving assets are hosted under `/invoice/*` so they cannot collide with Payroll circuits.

### Milestone 5 — Shielded settlement

The payment path is two-stage:

1. `fundInvoice` binds a real shielded coin with the private invoice amount and invoice token color to the contract.
2. `payInvoice` spends the confirmed contract-held shielded coin to the committed supplier payout key.

The runtime records commitment-tree candidates returned by the real indexer and retries only those candidates when generating the settlement proof. It never reports PAID until the Midnight ledger confirms the `Paid` state and expected payment nullifier.

## Fail-closed rules

- No mock wallet fallback.
- No fake transaction IDs.
- No frontend-only PAID state.
- No database flag is treated as settlement proof.
- Wrong network fails connection.
- Missing private witness fails the action.
- Missing or incorrect payer authority fails acceptance.
- Missing funded-coin proof data fails settlement.
- Replayed acceptance/payment actions fail on-chain.

## Toolchain

The existing repository pins Node 22, MidnightJS 4.1.1, Compact runtime 0.16.0, ledger-v8 8.1.0, and the Compact 0.31.x compiler line. Invoice intentionally reuses that toolchain rather than introducing a second version matrix.

## Current privacy boundary

The invoice payload itself is not written to the ledger. The contract stores its commitment and minimal lifecycle metadata. Settlement still follows the Midnight shielded-coin interfaces used by the current ledger-8 toolchain; claims about network-level anonymity must not exceed what those primitives actually provide.
