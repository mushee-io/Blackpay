# Blackpay build status

Status definitions:

- **CODED**: implementation is present in `main`.
- **VERIFY**: code compiles/builds but still requires live Midnight Preview validation.
- **LIVE**: verified against the configured Midnight environment. Nothing is marked LIVE without observed evidence.

## Current CI evidence

Observed on GitHub Actions after the M7–M12 build:

```text
Node dependency install       PASS
TypeScript                    PASS
Privacy scanner               PASS
Next.js production build      PASS
Compact toolchain selection   PASS (0.31.1)
Compact payroll compile       PASS
```

The repository is therefore **build-clean**, but it is not yet marked LIVE because wallet signing, deployment, shielded settlement, and proof/disclosure transactions still require an observed Midnight Preview run.

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

Verified:
- app typecheck/build PASS
- privacy scan PASS
- Compact 0.31.1 selection PASS
- Compact compile PASS

Remaining live verification:
- real Preview wallet connection
- live Preview node/indexer/proof-server configuration

## Milestone 2 — Employer payroll workspace

**Status: CODED / VERIFY**

Implemented:
- admin identity derived from a private secret witness
- one-time workspace creation circuit
- workspace ID and currency label hashed before submission
- public frequency configuration
- employer workspace UI action

Remaining live verification:
- generated binding adapter
- Preview workspace transaction

## Milestone 3 — Private employee registry

**Status: CODED / VERIFY**

Implemented:
- salary held in private witness record
- payout destination represented by a commitment
- 32-byte private salt
- public employee commitment only
- active/inactive lifecycle
- revision counter
- volatile in-memory witness handling
- add/update/remove circuits

Remaining live verification:
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

Verified:
- Compact 0.31.1 compile PASS

Remaining live verification:
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

Remaining live verification:
- supported payroll token on Preview
- funded employer wallet
- multi-recipient shielded transfer
- stronger settlement-to-pay-run binding

## Milestone 6 — Proof of salary / income

**Status: CODED / VERIFY**

Implemented:
- `proveIncomeAtLeast` circuit
- private record recomputed against employee commitment
- threshold comparison inside the circuit
- exact salary excluded from proof ledger state
- proof generation UI

Verified:
- circuit compiles with Compact 0.31.1

Remaining live verification:
- positive threshold proof
- negative threshold rejection
- independent verifier flow

## Milestone 7 — Selective disclosure

**Status: CODED / VERIFY**

Implemented:
- `DisclosureKind` model
- verifier-scoped income-threshold disclosure
- verifier-scoped active-employment disclosure
- expiry metadata
- nonce-derived disclosure IDs
- revocation circuit
- TypeScript gateway methods
- disclosure creation/revocation UI
- exact salary excluded from disclosure state

Verified:
- selective-disclosure circuits compile with Compact 0.31.1
- TypeScript/app build PASS

Remaining live verification:
- generated binding adapter methods
- positive/negative Preview disclosure tests
- authoritative expiry enforcement in verifier flow
- revoked-disclosure verification test

## Milestone 8 — Employer dashboard

**Status: CODED / VERIFY**

Implemented:
- employer product navigation
- workspace/people/pay-run/proof controls
- selective-disclosure controls
- deployment-readiness state
- fail-closed contract configuration display

Verified:
- Next.js production build PASS

Remaining live verification:
- hydrate counts/state from Midnight public data provider
- Preview indexer refresh/reconnect tests
- large-dataset pagination

## Milestone 9 — Employee portal + private payslips

**Status: CODED / VERIFY**

Implemented:
- private payslip domain model
- volatile in-memory payslip store
- duplicate protection per pay-run/transaction pair
- employee-reference scoped lookup
- gross/net/currency/period/status display
- real settlement transaction reference requirement
- no localStorage/sessionStorage persistence

Verified:
- TypeScript/app build PASS
- privacy scanner PASS

Remaining live verification:
- automatic payslip issuance from successful M5 settlement
- encrypted Midnight private-state persistence
- employee-owned recovery/access model
- finalized status binding to on-chain pay-run lifecycle

## Milestone 10 — Security + live release gate

**Status: CODED / VERIFY**

Implemented:
- `npm run release:check`
- `npm run live:verify`
- deployment-env validation
- Compact artifact validation
- proof-server/indexer/node reachability preflight
- explicit separation between infrastructure readiness and live payroll verification
- privacy scanner and fail-closed gateway retained

Verified:
- app CI PASS
- Compact CI PASS

Remaining live verification:
- Preview wallet signing
- contract deployment provenance
- full private payroll test

## Milestone 11 — Compliance + audit controls

**Status: CODED / VERIFY**

Implemented:
- redacted public audit bundle schema
- strict 32-byte proof/disclosure/transaction reference validation
- duplicate-reference removal
- embedded privacy statement
- salary, recipient, salt and witness fields excluded by type design
- audit bundle UI

Verified:
- TypeScript/app build PASS
- privacy scanner PASS

Remaining live verification:
- independent indexer verifier lookup
- signed/exportable audit envelope
- auditor authorization policy

## Milestone 12 — API + SDK integrations

**Status: CODED / VERIFY**

Implemented:
- typed `BlackpaySdk` façade over the real contract gateway
- SDK calls for workspace, employee, pay-run, proof and selective disclosure
- `GET /api/v1/status` public-safe readiness endpoint
- no simulated SDK gateway
- integration/privacy documentation

Verified:
- TypeScript/app build PASS

Remaining live verification:
- generated Compact adapter registration
- public verifier/read SDK
- versioned package publishing
- partner integration test on Preview

## Definition of LIVE

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
