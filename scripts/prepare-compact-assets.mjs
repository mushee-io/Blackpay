import { cp, mkdir, rm, stat } from "node:fs/promises";

const buildRoot = "contract/build";
const publicRoot = "public";
const generatedRoot = "src/generated/blackpay";
const circuits = [
  "createWorkspace",
  "addEmployee",
  "updateEmployee",
  "removeEmployee",
  "createPayRun",
  "approvePayRun",
  "finalizePayRun",
  "proveIncomeAtLeast",
  "createIncomeDisclosure",
  "createEmploymentDisclosure",
  "revokeDisclosure",
];

async function requireFile(path) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size === 0) throw new Error(`Missing required Compact asset: ${path}`);
}

await requireFile(`${buildRoot}/contract/index.js`);
await requireFile(`${buildRoot}/contract/index.d.ts`);
await requireFile(`${buildRoot}/compiler/contract-info.json`);
for (const circuit of circuits) {
  await requireFile(`${buildRoot}/keys/${circuit}.prover`);
  await requireFile(`${buildRoot}/keys/${circuit}.verifier`);
  await requireFile(`${buildRoot}/zkir/${circuit}.bzkir`);
}

await rm(`${publicRoot}/keys`, { recursive: true, force: true });
await rm(`${publicRoot}/zkir`, { recursive: true, force: true });
await rm(`${publicRoot}/compact`, { recursive: true, force: true });
await rm(generatedRoot, { recursive: true, force: true });

await mkdir(`${publicRoot}/keys`, { recursive: true });
await mkdir(`${publicRoot}/zkir`, { recursive: true });
await mkdir(`${publicRoot}/compact`, { recursive: true });
await mkdir(generatedRoot, { recursive: true });

// Proving and verification material is served as static HTTPS assets because
// FetchZkConfigProvider resolves /keys and /zkir from the application origin.
await cp(`${buildRoot}/keys`, `${publicRoot}/keys`, { recursive: true });
await cp(`${buildRoot}/zkir`, `${publicRoot}/zkir`, { recursive: true });
await cp(`${buildRoot}/compiler/contract-info.json`, `${publicRoot}/compact/contract-info.json`);

// Do not pre-bundle generated Compact bindings with esbuild. compact-runtime
// imports wasm-bindgen modules whose named WASM exports must be handled by the
// application's Webpack async-WebAssembly pipeline. Copy the compiler output
// intact and let Next.js bundle it once, alongside the rest of MidnightJS.
await cp(`${buildRoot}/contract`, generatedRoot, { recursive: true });

await requireFile(`${generatedRoot}/index.js`);
await requireFile(`${publicRoot}/compact/contract-info.json`);
console.log(`Prepared Blackpay Next.js Compact runtime and browser proving assets for ${circuits.length} circuits.`);
