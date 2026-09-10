# Blackpay Security Model

Blackpay handles payroll information. Treat every salary, payout destination, salt, witness value, wallet seed, mnemonic, and private key as sensitive.

## Privacy invariants

- Plaintext salary must never be written to public Compact ledger state.
- Shielded payout destinations must never be written to public ledger state.
- Employee and pay-run salts must never be logged or placed in `NEXT_PUBLIC_*` variables.
- Private witness records must not be persisted to localStorage/sessionStorage by the current application.
- No transaction, proof, wallet connection, or deployment may fall back to a mocked success path.
- Income proofs must verify the private employee witness against the employee commitment before evaluating the threshold.

## Current private-state behavior

Milestones 1–6 use a volatile in-memory witness store while the generated Compact bindings/private-state provider are integrated. Refreshing or closing the tab intentionally destroys this session state.

Production must migrate witness storage to the supported Midnight private-state provider with an explicit recovery strategy. Do not replace this with plaintext browser storage.

## Payment integrity boundary

The current payment adapter requests real `shielded` outputs from the connected Midnight wallet and submits the returned transaction. The Compact contract then records a commitment to the returned transaction identifier.

**Important:** at this stage, `finalizePayRun` does not cryptographically prove inside Compact that the submitted shielded transaction contains exactly the recipients and values committed by the private pay-run witness. A malicious payroll administrator could call finalization with an unrelated transaction commitment.

Until that binding is implemented and tested, Blackpay must not be described as production-grade trustless payroll settlement. The UI is fail-closed for missing infrastructure, but employer/payment correctness still relies on this explicit integrity boundary.

## Compatibility target

- Compact toolchain: `0.31.1`
- Compact language: `0.23`
- Compact runtime: `0.16.0`
- MidnightJS: `4.1.1`
- DApp connector API: `4.0.1`
- Ledger: `8.1.0`
- Proof server: `midnightntwrk/proof-server:8.1.0`

Do not upgrade to a ledger-9 Compact toolchain until the target Midnight environment and the rest of the dependency graph are upgraded together.

## Reporting

Do not post real payroll records, wallet secrets, or witness data in a public GitHub issue. Use a private security channel for sensitive reports.
