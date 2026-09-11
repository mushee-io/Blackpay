# Blackpay Security Model

Blackpay handles payroll information. Treat every salary, payout destination, salt, witness value, wallet seed, mnemonic, private key, private-state password, employee access package password, and private payslip as sensitive.

## Privacy invariants

- Plaintext salary must never be written to public Compact ledger state.
- Shielded payout destinations must never be written to public ledger state.
- Employee and pay-run salts must never be logged or placed in `NEXT_PUBLIC_*` variables.
- Private witness records and payslips must never be written to plaintext `localStorage`, `sessionStorage`, cookies, URLs, analytics, or console output.
- No transaction, proof, wallet connection, disclosure, deployment, settlement, recovery, or integration may fall back to a mocked success path.
- Income proofs must verify the private employee witness against the live employee commitment before evaluating the threshold.
- Employee access must be bound to the payout commitment created from the employee's shielded Lace address.
- Selective disclosures must be scoped to a verifier identifier and carry explicit expiry metadata.
- Audit bundles must contain only public proof/disclosure references and transaction commitments.

## Encrypted private state

The live browser build uses Midnight's encrypted Level private-state provider with the WebCrypto backend. Private employee witnesses, private pay-run witnesses, admin authority, and private payslips are stored under the connected shielded wallet account and contract address.

The application never stores private payroll records in plaintext browser storage. Public `localStorage` use is limited to non-secret navigation/runtime metadata such as the deployed contract address.

Private-state passwords are required to be at least 16 characters, use at least three character classes, reject obvious repeated/sequential patterns, and are length bounded. They are not wallet seed phrases and must never be reused as wallet recovery material.

Encrypted recovery exports include Midnight private-state and signing-key exports. Restore now validates network, contract-address shape, encrypted-payload size limits, connected-wallet stability, and the existence of the referenced contract before allowing destructive overwrite.

## Wallet session integrity

Blackpay treats a Lace account change as a security boundary. During a connected session, the application rechecks:

- connection status,
- Midnight network,
- shielded address,
- shielded coin public key,
- shielded encryption public key.

If those wallet identity fields change, the active Blackpay session fails closed and requires reconnection. Wallet-provided indexer/node endpoints must use secure transports outside localhost and may not contain embedded credentials.

## Employee access packages

New employee access exports use `blackpay-employee-access-envelope-v2`.

V2 properties:

- AES-256-GCM encryption.
- PBKDF2-HMAC-SHA256 with 600,000 iterations and a 32-byte random salt.
- 12-byte random AES-GCM IV.
- Random 32-byte package identifier.
- Seven-day package expiry.
- Network ID, contract address, package ID, creation time, and expiry are authenticated as AES-GCM additional authenticated data.
- The same network, contract, and package ID are repeated inside the encrypted payload and must match the authenticated envelope.
- Package contents are schema/bounds checked before installation.
- Duplicate pay-run payslips, malformed amounts, invalid dates, invalid identifiers, oversized payloads, and invalid transaction references are rejected.
- The decrypted employee witness is checked against the live Compact employee commitment.
- The connected Lace shielded wallet's payout commitment must equal the employee commitment embedded in the package.

Legacy v1 packages remain import-compatible so previously exported packages do not strand users. New exports always use v2.

Employee payslip state is monotonic: an imported or stale package cannot downgrade an already `PAID` payslip back to `APPROVED` or `PENDING`, and immutable payslip details for the same employee/pay-run pair cannot be silently overwritten.

## Selective disclosure boundary

`createIncomeDisclosure` proves a private salary is at least a requested threshold, binds the resulting disclosure to a verifier identifier, and records only a hash of the threshold in disclosure state. `createEmploymentDisclosure` binds an active-employment fact to a verifier without disclosing salary.

Disclosure records contain expiry metadata and may be revoked. The current contract does not yet expose a standalone verifier circuit that checks authoritative ledger time against `expiresAt`. Any verifier adapter must reject expired disclosures before treating them as valid. This remains a production release blocker for fully trustless selective disclosure verification.

## Payslip boundary

Payslips are private employee-facing records stored in encrypted private state. The public ledger and public status interfaces must never expose gross pay, net pay, salary, private recipient data, salts, or employee witnesses.

New pay runs generate encrypted employee payslip records automatically. Existing historical pay runs may be backfilled from the admin interface. A payslip's public lifecycle status is refreshed from the live pay-run ledger state.

A historical pay run that is already `Executed` may display `PAID / CONFIRMED ON CHAIN` from the non-zero public settlement commitment even when the original raw settlement transaction ID is unavailable. Blackpay must never invent a transaction ID.

## Payment integrity boundary

The payment adapter requests real `shielded` outputs from the connected Midnight wallet and submits the returned transaction. The Compact contract then records a commitment to the returned transaction identifier.

**Important:** `finalizePayRun` still does not cryptographically prove inside Compact that the submitted shielded transaction contains exactly the recipients and values committed by the private pay-run witness. A malicious payroll administrator could call finalization with an unrelated transaction commitment.

Until that binding is implemented and independently tested, Blackpay must not be described as production-grade trustless payroll settlement. The application is fail-closed for missing infrastructure and runtime state, but employer/payment correctness still relies on this explicit protocol integrity boundary.

## Browser / web hardening

The production Next.js application disables the framework identification header and sends defensive browser headers including:

- HSTS,
- `X-Content-Type-Options: nosniff`,
- `X-Frame-Options: DENY`,
- `Referrer-Policy: no-referrer`,
- a restrictive permissions policy,
- anti-object/embed and anti-framing CSP directives,
- cross-origin opener/resource isolation headers.

The CI privacy scanner rejects console output, raw HTML injection, cookie use for private state, private `NEXT_PUBLIC_*` variables, plaintext private browser-storage keys, mocked proof/transaction fallbacks, and `Math.random()` inside Midnight-sensitive code.

## Public integration boundary

`GET /api/v1/status` returns deployment-readiness metadata only. The TypeScript SDK is a facade over the real contract gateway and must not create simulated responses when bindings/providers are unavailable.

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

Passing CI, `npm run release:check`, or `npm run live:verify` proves only the checks they actually perform. They do not prove wallet signing, deployed-contract provenance, payroll settlement correctness, selective-disclosure correctness, or independent verification. Those require observed Preview runs and, for settlement correctness, the protocol-level binding described above.

## Reporting

Do not post real payroll records, wallet secrets, private payslips, private-state backups, employee access packages, or witness data in a public GitHub issue. Use a private security channel for sensitive reports.
