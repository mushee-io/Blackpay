# Blackpay Security Model

Blackpay handles payroll information. Treat every salary, payout destination, salt, witness value, funded-coin capability, wallet seed, mnemonic, private key, private-state password, employee access password, and private payslip as sensitive.

## Privacy invariants

- Plaintext salary must never be written to public Compact ledger state.
- Shielded payout destinations and payout capabilities must never be written to public ledger state.
- Employee, pay-run, and payment salts must never be logged or placed in `NEXT_PUBLIC_*` variables.
- Private witnesses, payslips, settlement capabilities, and funded contract-coin data must never be written to plaintext browser storage, cookies, URLs, analytics, or console output.
- No transaction, proof, wallet connection, disclosure, deployment, settlement, recovery, or integration may fall back to a mocked success path.
- Income proofs must verify the private employee witness against the live employee commitment before evaluating a threshold.
- Employee access must be bound to both the payout commitment and shielded coin public key registered for that employee.
- Audit bundles must contain only public proof/disclosure references and commitments.

## Protocol-v2 settlement integrity

Blackpay protocol v2 removes the legacy `finalizePayRun(txHash)` model entirely.

Settlement is now enforced by the Compact contract:

1. `createPayRun` commits to the private payroll total, payment root, token color, and salt.
2. `registerPayRunPayment` verifies each private payment against the registered employee salary and payout coin key, then advances the public rolling commitment root.
3. `approvePayRun` requires every expected claim to be registered and requires the rolling registered root to equal the private committed payment root.
4. `fundPayRunPayment` accepts only an approved, registered claim; verifies its private payment commitment; verifies the shielded funding coin token and exact amount; and takes that coin into contract custody with `receiveShielded`.
5. `claimPayRunPayment` accepts only a funded claim; re-verifies its private payment commitment and funded coin; sends the exact value to the committed employee payout key using `sendShielded`; and marks the claim settled.
6. A settled claim cannot be replayed. The pay run becomes `Executed` only when all employee claims are settled.

The employer therefore cannot finalize a pay run by supplying an unrelated transaction commitment, and the employee cannot redirect a funded claim to a different payout key.

## Contract-held coin capability

A contract-held shielded coin becomes spendable only after it receives a commitment-tree position. Blackpay captures the candidate commitment-tree indices for each funding transaction from the same wallet-configured Midnight indexer used by the runtime.

The private funded-coin capability contains the coin nonce, color, exact value, and bounded candidate tree indices. It is stored only in encrypted Blackpay private state and fresh encrypted employee access packages. During claim, candidates are tried against the ledger proof; an incorrect candidate fails the membership proof and cannot redirect or duplicate the payment.

The public contract stores only payment and employee commitments plus claim lifecycle state, never the private coin capability.

## Encrypted private state

The live browser build uses Midnight's encrypted Level private-state provider with the WebCrypto backend. Private employee witnesses, private pay-run witnesses, settlement records, funded-coin capabilities, admin authority, and private payslips are scoped to the connected shielded wallet and contract address.

Public `localStorage` is limited to non-secret runtime/navigation metadata such as the public contract address.

Private-state passwords must be at least 16 characters, use at least three character classes, reject obvious repeated/sequential patterns, and are length bounded. They are not wallet seed phrases and must never be reused as wallet recovery material.

Encrypted backup export uses Midnight private-state and signing-key exports. Restore must validate network, contract-address shape, encrypted-payload limits, connected-wallet stability, and the existence of the referenced contract before destructive overwrite.

## Wallet session integrity

Blackpay treats a Lace account change as a security boundary. During a connected session the runtime rechecks:

- connection status,
- Midnight network,
- shielded address,
- shielded coin public key,
- shielded encryption public key.

If wallet identity changes, the active Blackpay session fails closed and requires reconnection. Wallet-provided indexer/node endpoints must use secure transports outside localhost and may not contain embedded credentials.

## Employee access packages

Protocol-v2 settlement exports `blackpay-employee-access-envelope-v3` packages.

V3 properties:

- AES-256-GCM encryption.
- PBKDF2-HMAC-SHA256 with 600,000 iterations and a 32-byte random salt.
- 12-byte random AES-GCM IV.
- Random 32-byte package identifier.
- Seven-day package expiry.
- Network ID, contract address, package ID, creation time, expiry, and format are authenticated as AES-GCM additional authenticated data.
- The same authenticated metadata is repeated inside the encrypted payload and must match.
- The employee witness is checked against the live v2 employee commitment.
- The connected Lace shielded address commitment and shielded coin public key must match the employee record.
- Each settlement capability is recomputed and checked against the live payment claim before installation.
- Funded coin color/value and tree-index candidates are schema and bounds checked before installation.
- Duplicate claims, duplicate payslips, malformed identifiers, invalid amounts, invalid dates, oversized payloads, and invalid settlement references are rejected.

Legacy v1/v2 access package parsers exist only for historical compatibility. The protocol-v2 settlement runtime rejects legacy payloads and requires a fresh v3 package for claims.

Payslip lifecycle state is monotonic: stale/imported packages cannot downgrade `PAID` to `FUNDED`, `APPROVED`, or `PENDING`.

## Selective disclosure boundary

`createIncomeDisclosure` proves a private salary is at least a requested threshold, binds the result to a verifier identifier, and records only the intended public proof metadata. `createEmploymentDisclosure` proves active employment without disclosing salary.

Disclosure records contain expiry metadata and may be revoked. The current contract does not yet expose a standalone verifier circuit that checks authoritative ledger time against `expiresAt`. A verifier adapter must reject expired disclosures before treating them as valid. This remains a blocker for describing selective disclosure as fully trustless production verification.

## Payslip boundary

Payslips are employee-facing records in encrypted private state. The public ledger/status interfaces must never expose gross pay, net pay, salary, payout destinations, payment salts, funded coins, or witnesses.

New v2 pay runs create private payslips automatically. Their lifecycle is refreshed from the exact employee payment claim (`Registered`, `Funded`, `Settled`) rather than inferred only from the overall pay-run status.

## Browser / web hardening

The production Next.js application disables framework identification and sends defensive headers including HSTS, nosniff, deny-framing, no-referrer, restrictive permissions policy, CSP anti-object/anti-framing directives, and cross-origin isolation headers.

The CI privacy scanner rejects console output, raw HTML injection, cookie use for private state, private `NEXT_PUBLIC_*` variables, plaintext private browser-storage keys, mocked proof/transaction fallbacks, and `Math.random()` inside Midnight-sensitive code.

## Public integration boundary

`GET /api/v1/status` is an HTTP API route version and returns public deployment-readiness metadata only; it is not a reference to the old payroll protocol.

The TypeScript SDK is a façade over the real v2 gateway and exposes `createPayRun`, `approvePayRun`, `fundPayRunPayment`, and `claimPayRunPayment`. It must not synthesize successful responses when bindings/providers are unavailable.

## Compatibility target

- Compact toolchain: `0.31.1`
- Compact language: `0.23`
- Compact runtime: `0.16.0`
- MidnightJS: `4.1.1`
- DApp connector API: `4.0.1`
- Ledger: `8.1.0`
- Proof server: `midnightntwrk/proof-server:8.1.0`

Do not upgrade to ledger 9 until the target Midnight environment and the complete dependency graph move together.

## Deployment and release rule

A legacy Blackpay v1 contract cannot be upgraded in place. Protocol v2 requires a newly deployed Compact contract, and the runtime refuses to register the payroll gateway unless the decoded ledger reports `protocolVersion == 2`.

Passing CI proves only static/build properties. A release requires all `app`, `compact`, and `live-assets` jobs to pass on the same commit and then a real Preview run with Lace that demonstrates: v2 deployment, workspace creation, employee registration, pay-run registration/approval, contract funding, fresh v3 employee package export/import, and a successful one-time employee claim.

## Reporting

Do not post real payroll records, wallet secrets, private payslips, private-state backups, employee access packages, funded-coin capabilities, or witness data in a public GitHub issue. Use a private security channel for sensitive reports.
