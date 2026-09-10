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
- observe green CI app build
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

## Milestone 7 — Selective disclosure

**Status: CODED / VERIFY**

Implemented:
- `DisclosureKind` protocol model
- verifier-scoped income-threshold disclosure circuit
- verifier-scoped active-employment disclosure circuit
- disclosure expiry metadata
- nonce-derived disclosure IDs
- revocation circuit
- disclosure gateway methods
- disclosure creation/revocation UI
- exact salary excluded from disclosure ledger state

Remaining verification:
- Compact 0.31.1 compile
- generated binding adapter methods
- positive/negative Preview proof tests
- verifier-side expiry enforcement using authoritative network time
- revoked-disclosure verification test

## Milestone 8 — Employer dashboard

**Status: CODED / VERIFY**

Implemented:
- product navigation covering overview, people, pay runs, proofs, employee, audit and API
- workspace/payroll controls from Milestones 2–6
- disclosure controls from Milestone 7
- deployment-readiness state
- fail-closed contract configuration display

Remaining verification:
- hydrate dashboard counts/state from the public data provider
- Preview indexer refresh/reconnect tests
- pagination for larger employee/pay-run sets

## Milestone 9 — Employee portal + private payslips

**Status: CODED / VERIFY**

Implemented:
- private payslip domain model
- volatile in-memory payslip store
- duplicate protection per pay-run/transaction pair
- employee-reference scoped payslip lookup
- gross/net/currency/period/status display
- settlement transaction reference requirement
- no localStorage/sessionStorage persistence

Remaining verification:
- automatic payslip issuance from the successful M5 payment path
- encrypted Midnight private-state persistence
- employee-owned recovery/access model
- finalized status binding to the on-chain pay-run lifecycle

## Milestone 10 — Security + live release gate

**Status: CODED / VERIFY**

Implemented:
- `npm run release:check`
- `npm run live:verify`
- required deployment-env validation
- required Compact artifact validation
- proof server/indexer/node reachability preflight
- explicit statement that infrastructure preflight does not equal live payroll verification
- existing privacy scanner and fail-closed gateway retained

Remaining verification:
- green app CI
- green Compact 0.31.1 compiler job
- Preview wallet signing
- contract deployment provenance
- full end-to-end private payroll test

## Milestone 11 — Compliance + audit controls

**Status: CODED / VERIFY**

Implemented:
- redacted public audit bundle schema
- strict 32-byte proof/disclosure/transaction reference validation
- duplicate-reference removal
- privacy statement embedded in every bundle
- salary, recipient, salt and witness fields excluded by type design
- audit bundle UI

Remaining verification:
- independent verifier lookup against the Midnight indexer
- signed/exportable audit bundle envelope
- organization-level auditor authorization policy

## Milestone 12 — API + SDK integrations

**Status: CODED / VERIFY**

Implemented:
- typed `BlackpaySdk` façade over the real contract gateway
- SDK methods for workspace, employee, pay-run, income proof and selective disclosure flows
- `GET /api/v1/status` public-safe readiness endpoint
- no simulated SDK gateway
- integration/privacy documentation

Remaining verification:
- generated Compact adapter registration
- public verifier/read SDK
- versioned package publishing
- partner integration test on Midnight Preview

## Definition of Milestones 1–12 complete

Milestones move from **CODED / VERIFY** to **LIVE** only when all relevant checks are observed:

```text
App typecheck/build             PASS
Privacy scan                    PASS
Compact 0.31.1 compile          PASS
Proof server 8.1.0              PASS
Preview wallet                  PASS
Preview node/indexer            PASS
Contract deployment             PASS
Workspace transaction           PASS
Employee private commit         PASS
Pay-run lifecycle               PASS
Shielded payroll transfer       PASS
Income >= threshold proof       PASS
Scoped disclosure               PASS
Disclosure revocation           PASS
Disclosure expiry enforcement   PASS
Employee private payslip        PASS
Audit verifier lookup           PASS
SDK Preview integration         PASS
Public salary leakage           NONE
Fake fallback                   NONE
```
