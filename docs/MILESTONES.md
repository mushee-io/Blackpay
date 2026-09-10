# Blackpay build status

Status definitions:

- **CODED**: implementation is present in `main`.
- **VERIFY**: code exists but must still pass Compact/app build or live Preview validation.
- **LIVE**: verified against the configured Midnight environment. Nothing is marked LIVE without observed evidence.

## Milestone 1 — Foundation + Midnight environment

**Status: CODED / VERIFY**

Implemented:
- Next.js + strict TypeScript application
- MidnightJS 4.1.1 dependency family
- DApp connector API 4.0.1 target
- Compact runtime 0.16.0 and ledger-v8 8.1.0 pins
- Preview/Preprod environment validation
- injected Midnight wallet discovery + connection
- wallet network mismatch rejection
- proof server 8.1.0 Docker service on localhost:6300
- public-safe health endpoint
- privacy scanner
- fail-closed contract gateway

Remaining verification:
- observe CI app build
- compile Compact with toolchain 0.31.1
- connect a real Preview wallet
- configure live Preview node/indexer endpoints

## Milestone 2 — Employer payroll workspace

**Status: CODED / VERIFY**

Implemented:
- admin identity derived from a private secret witness
- one-time workspace creation circuit
- workspace ID and currency label hashed before submission
- public frequency configuration
- employer workspace UI action

Remaining verification:
- generated binding adapter
- Preview transaction

## Milestone 3 — Private employee registry

**Status: CODED / VERIFY**

Implemented:
- salary held in private witness record
- payout destination represented by a commitment in the Compact witness
- 32-byte private salt
- public employee commitment only
- active/inactive lifecycle
- revision counter
- volatile in-memory witness handling in the current browser session
- add/update/remove contract circuits

Remaining verification:
- generated binding adapter
- Midnight private-state-provider migration
- Preview proof/transaction
- employee witness handoff/recovery design

## Milestone 4 — Confidential payroll contract

**Status: CODED / VERIFY**

Implemented:
- private total payroll witness
- private payments root witness
- pay-run commitment
- draft -> approved -> executed lifecycle
- duplicate pay-run prevention
- employee-count invariant
- transaction commitment field
- create/approve/finalize UI workflow

Remaining verification:
- compile and circuit tests
- Preview deployment and state transitions

## Milestone 5 — Private salary payments

**Status: CODED / VERIFY**

Implemented:
- connected-wallet `makeTransfer` flow
- shielded output per employee
- positive amount/recipient validation
- wallet transaction submission
- transaction ID commitment for pay-run finalization
- no fake transaction fallback

Important integrity boundary:
- the Compact contract does not yet cryptographically prove that the submitted wallet transaction exactly matches the private pay-run commitment. See `SECURITY.md`.

Remaining verification:
- real supported token type on Preview
- funded employer wallet
- multi-recipient shielded transfer test
- stronger settlement-to-pay-run binding

## Milestone 6 — Proof of salary / income

**Status: CODED / VERIFY**

Implemented:
- `proveIncomeAtLeast` Compact circuit
- private salary retrieved from witness
- private record recomputed and checked against the registered employee commitment
- threshold comparison inside the circuit
- exact salary never written to proof ledger state
- public proof ID, disclosed threshold, employee commitment and satisfied result
- proof generation UI action

Remaining verification:
- generated binding adapter
- positive threshold proof on Preview
- negative threshold rejection test
- independent verifier flow

## Definition of Milestones 1–6 complete

Milestones 1–6 move from **CODED / VERIFY** to **LIVE** only when all of the following are observed:

```text
App build                 PASS
Compact 0.31.1 compile    PASS
Proof server 8.1.0        PASS
Preview wallet            PASS
Preview node/indexer      PASS
Contract deployment       PASS
Workspace transaction     PASS
Employee private commit   PASS
Pay-run lifecycle         PASS
Shielded payroll transfer PASS
Income >= threshold proof PASS
Public salary leakage     NONE
Fake fallback             NONE
```
