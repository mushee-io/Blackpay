# Blackpay build status

Status definitions:

- **CODED** — implementation is present in `main`.
- **VERIFY** — implementation/build checks pass but still requires a real Midnight Preview transaction path.
- **LIVE** — observed end-to-end against the target Midnight environment. Nothing is called LIVE from code or CI alone.

## Protocol-v2 release target

Blackpay protocol v2 replaces the old arbitrary transaction-hash finalization model with contract-bound `REGISTER -> APPROVE -> FUND -> CLAIM` settlement.

The release build targets:

- Compact toolchain `0.31.1`
- Compact language `0.23`
- Compact runtime `0.16.0`
- MidnightJS `4.1.1`
- DApp connector API `4.0.1`
- ledger-v8 `8.1.0`
- Node.js `22.x`
- Midnight `preview`

CI has three required jobs on the same commit: `app`, `compact`, and `live-assets`.

## Milestone 1 — Foundation + Midnight environment

**Status: CODED / VERIFY**

Implemented:
- Next.js + strict TypeScript
- injected Lace/Midnight wallet discovery and connection
- wallet network/identity mismatch rejection
- Lace-provided node/indexer/websocket configuration
- wallet-delegated proving provider
- fail-closed gateway and private-state initialization
- browser WebAssembly build path for generated Compact bindings
- privacy scanner and release checks

Live requirement:
- connect Lace Preview from the deployed HTTPS application.

## Milestone 2 — Employer payroll workspace

**Status: CODED / VERIFY**

Implemented:
- private admin authority
- one-time workspace creation
- hashed workspace/currency identifiers
- payroll frequency
- live employer action through generated Compact bindings

Live requirement:
- execute workspace creation against the newly deployed v2 Preview contract.

## Milestone 3 — Private employee registry

**Status: CODED / VERIFY**

Implemented:
- private salary, payout commitment, shielded payout coin key, and salt
- public employee commitment only
- active/inactive lifecycle and revision counter
- encrypted Midnight Level private-state persistence
- add/update/remove circuits
- wallet-bound employee access validation

Live requirement:
- register a real employee and confirm the public commitment without salary/payout leakage.

## Milestone 4 — Confidential pay-run commitments

**Status: CODED / VERIFY**

Implemented:
- private payroll total and payment-root witness
- token color included in v2 pay-run commitment
- deterministic ordered payment-claim root
- per-employee payment claim registration
- approval blocked until all expected claims exist and the registered root equals the private committed root
- duplicate claim/pay-run prevention
- Draft -> Approved -> Executed lifecycle

Live requirement:
- create and approve a real v2 pay run on Preview.

## Milestone 5 — Contract-bound private salary settlement

**Status: CODED / VERIFY**

Implemented:
- **legacy `finalizePayRun(transactionCommitment)` removed**
- per-employee `PaymentClaimStatus`: Registered / Funded / Settled
- exact amount + token + fixed payout-key commitment
- employer funding accepted into shielded contract custody with `receiveShielded`
- commitment-tree position capture from the wallet-selected indexer
- encrypted funded-coin capability
- employee claim with `sendShielded` to the precommitted payout key
- one-time settlement enforcement
- pay run becomes Executed only after every employee claim settles
- idempotent employer funding retry display

Live requirement:
- fund a real claim from Lace and have the bound employee Lace wallet claim it once; verify a second claim attempt is rejected.

## Milestone 6 — Proof of salary / income

**Status: CODED / VERIFY**

Implemented:
- `proveIncomeAtLeast`
- private employee witness recomputed against live commitment
- threshold comparison inside Compact
- exact salary excluded from public proof state

Live requirement:
- positive proof and negative-threshold rejection on Preview.

## Milestone 7 — Selective disclosure

**Status: CODED / VERIFY**

Implemented:
- verifier-scoped income/employment disclosure
- expiry metadata
- nonce-derived disclosure IDs
- revocation
- disclosure UI and SDK methods

Remaining protocol hardening:
- standalone verifier logic must enforce authoritative ledger time against `expiresAt`; until then integrators must reject expired disclosures themselves.

## Milestone 8 — Employer dashboard

**Status: CODED / VERIFY**

Implemented:
- workspace/employee/pay-run/proof controls
- Lace shielded-balance token selection
- v2 claim registration, approval, and funding controls
- explicit v2 runtime status and fail-closed lockout
- no demo settlement path

Live requirement:
- exercise the full employer path after v2 deployment.

## Milestone 9 — Employee portal + private payslips

**Status: CODED / VERIFY**

Implemented:
- encrypted private payslip persistence
- v3 AES-GCM employee access packages
- payout-address + payout-coin-key wallet binding
- package expiry/authenticated metadata
- live employee/claim commitment verification on import
- exact per-claim lifecycle status
- `CLAIM SHIELDED SALARY` action for funded claims
- monotonic Pending -> Approved -> Funded -> Paid state

Live requirement:
- export a fresh v3 package after funding, import it with the bound employee Lace wallet, and execute the real claim.

## Milestone 10 — Security + release gate

**Status: CODED / VERIFY**

Implemented:
- fail-closed protocol-version gate (`protocolVersion == 2`)
- encrypted private-state backup/recovery
- wallet session integrity checks
- production WebAssembly/Compact build pipeline
- exact circuit proving-asset validation
- no public node/indexer/prover configuration duplication
- GitHub `app`, `compact`, and `live-assets` release jobs

Live requirement:
- deploy a **new** v2 contract. A v1 deployment cannot be upgraded in place.

## Milestone 11 — Compliance + audit controls

**Status: CODED / VERIFY**

Implemented:
- redacted public audit bundle
- proof/disclosure/commitment validation
- salary, payout, salt, witness, and funded-coin capability fields excluded

Further product work:
- independent public verifier/read flow and signed auditor-facing export are optional follow-on features, not settlement blockers.

## Milestone 12 — API + SDK integrations

**Status: CODED / VERIFY**

Implemented:
- typed protocol-v2 `BlackpaySdk`
- create/approve/fund/claim settlement methods
- public-safe `GET /api/v1/status`
- API status explicitly reports `protocolVersion: 2`
- Lace-managed infrastructure status
- no simulated SDK gateway

Further product work:
- package publishing and external partner integration testing after Preview validation.

## Definition of LIVE

Blackpay protocol v2 may be called LIVE only after all of the following are observed:

```text
Same-commit app CI                 PASS
Same-commit Compact 0.31.1 CI      PASS
Same-commit live-assets/Next build PASS
Lace Preview connection            PASS
New protocol-v2 deployment         PASS
protocolVersion == 2               PASS
Workspace transaction              PASS
Employee private commitment        PASS
Pay-run claim registration         PASS
Pay-run root-bound approval        PASS
Contract claim funding             PASS
Fresh v3 employee package          PASS
Bound employee wallet import       PASS
One-time shielded salary claim     PASS
Duplicate claim rejection          PASS
Income threshold proof             PASS
Public salary leakage              NONE
Fake fallback                      NONE
```

Selective-disclosure expiry should be treated separately: expiry metadata exists today, but fully trustless authoritative-time verification remains additional hardening before advertising that verifier subsystem as fully trustless.
