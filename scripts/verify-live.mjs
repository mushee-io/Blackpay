import { existsSync } from "node:fs";

const required = [
  "NEXT_PUBLIC_MIDNIGHT_INDEXER_URL",
  "NEXT_PUBLIC_MIDNIGHT_NODE_URL",
  "NEXT_PUBLIC_BLACKPAY_CONTRACT_ADDRESS",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  throw new Error(`LIVE verification blocked. Missing: ${missing.join(", ")}`);
}

if (!existsSync("contract/build")) {
  throw new Error("LIVE verification blocked. contract/build is missing; compile Compact 0.31.1 first.");
}

function httpVariant(value) {
  const url = new URL(value);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  return url.toString();
}

async function reachable(label, value) {
  const target = httpVariant(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(target, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
    });
    return { label, ok: true, status: response.status };
  } catch (error) {
    return {
      label,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

const proofServer = process.env.NEXT_PUBLIC_MIDNIGHT_PROOF_SERVER_URL ?? "http://127.0.0.1:6300";
const checks = await Promise.all([
  reachable("proof-server", proofServer),
  reachable("indexer", process.env.NEXT_PUBLIC_MIDNIGHT_INDEXER_URL),
  reachable("node", process.env.NEXT_PUBLIC_MIDNIGHT_NODE_URL),
]);

for (const check of checks) {
  process.stdout.write(`${check.label}: ${check.ok ? "REACHABLE" : "FAIL"}${check.status ? ` (${check.status})` : ""}\n`);
}

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  throw new Error(`LIVE verification failed: ${failed.map((check) => check.label).join(", ")}`);
}

process.stdout.write("contract artifacts: PRESENT\n");
process.stdout.write("contract address: CONFIGURED\n");
process.stdout.write("LIVE infrastructure preflight: PASS\n");
process.stdout.write("Wallet signing, deployment provenance, payroll settlement, and proof verification still require an interactive Preview run.\n");
