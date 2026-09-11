# Blackpay integrations

Blackpay integrations must preserve the application privacy boundary: salary values, payout destinations, salts, employee witnesses, private pay-run inputs, settlement capabilities, and funded-coin data must not be sent to public APIs, logs, or analytics.

## Public-safe status API

`GET /api/v1/status`

The `/api/v1` path is the HTTP API version, not the legacy payroll protocol version. It returns only public readiness metadata including app version, Blackpay `protocolVersion: 2`, Midnight network, whether a canonical v2 contract default is configured, wallet-managed infrastructure mode, settlement mode, employee-access version, privacy mode, and milestone status.

Indexer, node, websocket, and proving endpoints are not configured through public Blackpay environment variables. The connected Lace wallet supplies its current service configuration and delegated proving provider.

## TypeScript SDK

`src/lib/sdk/blackpay.ts` exposes `BlackpaySdk`, a typed façade over the registered live `PayrollContractGateway`.

The SDK never creates a simulated gateway. If a verified protocol-v2 Compact runtime and real Midnight providers have not registered a gateway, the default path fails closed.

Protocol-v2 calls include:

- create employer workspace
- add/update/remove private employee commitments
- create a committed pay run and register exact employee payment claims
- approve a pay run only after the payment root verifies
- fund an employee payment claim into shielded contract custody
- claim a funded salary to the fixed employee payout key
- prove a private income threshold
- create verifier-scoped income/employment disclosures
- revoke a selective disclosure

The legacy `finalizePayRun(transactionCommitment)` API is removed.

## Employee access

New protocol-v2 employee exports use encrypted `blackpay-employee-access-envelope-v3` packages. They contain only that employee's private record, payslips, and settlement capabilities. After employer funding, the package may include encrypted contract-held coin data required to prove the employee's one-time claim.

Import verifies the connected Lace payout wallet, live employee commitment, and each live payment claim before installing the private capability.

## Selective disclosure

A disclosure is bound to the employee commitment, disclosure kind, verifier identifier, expiry timestamp, and unique nonce-derived disclosure ID. Exact salary remains private.

The contract records expiry metadata but currently has no standalone verifier circuit that evaluates authoritative ledger time against `expiresAt`. Integrators must reject expired disclosures. This remains a separate trustless-verification hardening item and does not weaken the protocol-v2 payroll settlement binding.

## Payslips

Payslips and settlement state are stored in Midnight's encrypted private-state provider, scoped to the wallet and contract. Public integrations must never receive payslip amount fields or funded-coin capabilities.

Employee lifecycle status is derived from the exact v2 payment claim: `Registered`, `Funded`, or `Settled`.

## Audit bundles

`buildPublicAuditBundle()` accepts public proof IDs, disclosure IDs, and commitment references only. Its type intentionally excludes salary, recipient, salt, witness, and private settlement capability fields.

## Live integration requirement

A partner integration is not live merely because TypeScript/Compact builds pass. The release gate is:

```bash
npm run release:check
```

and the same GitHub commit must pass all CI jobs: `app`, `compact`, and `live-assets`.

Afterward, a real Midnight Preview run must demonstrate a new v2 contract deployment, workspace creation, employee registration, pay-run registration/approval, contract funding, fresh v3 employee package export/import, and successful one-time employee claim using Lace.
