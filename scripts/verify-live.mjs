import { existsSync, readdirSync, statSync } from "node:fs";

const contractAddress = process.env.NEXT_PUBLIC_BLACKPAY_CONTRACT_ADDRESS?.trim() ?? "";
if (!contractAddress) {
  throw new Error("LIVE verification blocked. Missing canonical NEXT_PUBLIC_BLACKPAY_CONTRACT_ADDRESS for the deployed protocol-v2 contract.");
}

if (!/^[0-9a-fA-F]{64}$/.test(contractAddress)) {
  throw new Error("LIVE verification blocked. NEXT_PUBLIC_BLACKPAY_CONTRACT_ADDRESS is not a 32-byte Midnight contract address.");
}

const requiredFiles = [
  "contract/build/contract/index.js",
  "contract/build/contract/index.d.ts",
  "contract/build/compiler/contract-info.json",
];
for (const path of requiredFiles) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`LIVE verification blocked. Missing compiled protocol-v2 artifact: ${path}`);
  }
}

const expectedCircuits = [
  "createWorkspace",
  "addEmployee",
  "updateEmployee",
  "removeEmployee",
  "createPayRun",
  "registerPayRunPayment",
  "approvePayRun",
  "fundPayRunPayment",
  "claimPayRunPayment",
  "proveIncomeAtLeast",
  "createIncomeDisclosure",
  "createEmploymentDisclosure",
  "revokeDisclosure",
];

for (const circuit of expectedCircuits) {
  for (const path of [
    `contract/build/keys/${circuit}.prover`,
    `contract/build/keys/${circuit}.verifier`,
    `contract/build/zkir/${circuit}.bzkir`,
    `contract/build/zkir/${circuit}.zkir`,
  ]) {
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new Error(`LIVE verification blocked. Missing protocol-v2 proving asset: ${path}`);
    }
  }
}

const keyCount = readdirSync("contract/build/keys").length;
const zkirCount = readdirSync("contract/build/zkir").length;
if (keyCount !== 26 || zkirCount !== 26) {
  throw new Error(`LIVE verification blocked. Expected 26 key files and 26 ZKIR files; found ${keyCount} and ${zkirCount}.`);
}

process.stdout.write("Blackpay protocol version target: 2\n");
process.stdout.write("Compact 0.31.x protocol-v2 artifacts: PRESENT\n");
process.stdout.write("Protocol-v2 proving assets: 13 CIRCUITS / PASS\n");
process.stdout.write(`Canonical v2 contract address: ${contractAddress}\n`);
process.stdout.write("Midnight infrastructure source: LACE WALLET CONFIGURATION\n");
process.stdout.write("CLI release preflight: PASS\n");
process.stdout.write("Interactive Lace verification is still required for wallet signing, protocolVersion == 2 discovery, claim funding, and the one-time employee salary claim.\n");
