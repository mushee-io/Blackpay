# Blackpay Security Model

Blackpay handles payroll information. Treat every salary, payout destination, salt, witness value, wallet seed, mnemonic, private key, and private payslip as sensitive.

## Privacy invariants

- Plaintext salary must never be written to public Compact ledger state.
- Shielded payout destinations must never be written to public ledger state.
- Employee and pay-run salts must never be logged or placed in `NEXT_PUBLIC_*` variables.
- Private witness records and payslips must not be persisted to localStorage/sessionStorage by the current application.
- No transaction, proof, wallet connection, disclosure, deployment, or integration may fall back to a mocked success path.
- Income proofs must verify the private employee witness against the employee commitment before evaluating the threshold.
- Selective disclosures must be scoped to a verifier identifier and carry explicit expiry metadata.
- Audit bundles must contain only public proof/disclosure references and transaction commitments.

## Current private-state behavior

The current browser build uses a volatile in-memory store for private employee witnesses, private pay-run witnesses, and payslips while the generated Compact bindings/private-state provider are integrated. Refreshing or closing the tab intentionally destroys this session state.

Production must migrate private state to the supported Midnight private-state provider with an explicit employee recovery strategy. Do not replace this with plaintext browser storage.

## Selective disclosure boundary

`createIncomeDisclosure` proves a private salary is at least a requested threshold, binds the resulting disclosure to a verifier identifier, and records only a hash of the threshold in disclosure state. `createEmploymentDisclosure` binds an active-employment fact to a verifier without disclosing salary.

Disclosure records contain expiry metadata and may be revoked. The current contract does not yet expose a standalone verifier circuit that checks authoritative ledger time against `expiresAt`. Any verifier adapter must reject expired disclosures before treating them as valid. This is a release blocker for production selective disclosure.

## Payslip boundary

Payslips are private employee-facing records. In the current build they are stored only in volatile session memory. The public ledger and the public status API must never expose gross pay, net pay, or private settlement-recipient data.

The current payslip UI requires a real settlement transaction reference but automatic issuance from the M5 shielded payment flow is still pending. Until that binding is implemented, a payslip is an application-layer private record rather than an independently verified on-chain receipt.

## Payment integrity boundary

The current payment adapter requests real `shielded` outputs from the connected Midnight wallet and submits the returned transaction. The Compact contract then records a commitment to the returned transaction identifier.

**Important:** at this stage, `finalizePayRun` does not cryptographically prove inside Compact that the submitted shielded transaction contains exactly the recipients and values committed by the private pay-run witness. A malicious payroll administrator could call finalization with an unrelated transaction commitment.

Until that binding is implemented and tested, Blackpay must not be described as production-grade trustless payroll settlement. The UI is fail-closed for missing infrastructure, but employer/payment correctness still relies on this explicit integrity boundary.

## Public integration boundary

`GET /api/v1/status` returns deployment-readiness metadata only. The TypeScript SDK is a façade over the real contract gateway and must not create simulated responses when bindings/providers are unavailable.

The redacted audit-bundle type intentionally contains no salary, payout-destination, salt, or witness fields. New integration endpoints must follow the same rule unless they run inside an explicitly private authenticated channel with an approved threat model.

## Compatibility target

- Compact toolchain: `0.31.1`
- Compact language: `0.23`
- Compact runtime: `0.16.0`
- MidnightJS: `4.1.1`
- DApp connector API: `4.0.1`
- Ledger: `8.1.0`
- Proof server: `midnightntwrk/proof-server:8.1.0`

Do not upgrade to a ledger-9 Compact toolchain until the target Midnight environment and the rest of the dependency graph are upgraded together.

## Release rule

Passing `npm run live:verify` proves only that required artifacts/configuration are present and the configured public services are reachable. It does not prove wallet signing, contract deployment provenance, payroll settlement correctness, selective-disclosure correctness, or independent verification. Those require an observed Preview run.

## Reporting

Do not post real payroll records, wallet secrets, private payslips, or witness data in a public GitHub issue. Use a private security channel for sensitive reports.
