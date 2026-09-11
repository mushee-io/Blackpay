#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

if ! command -v compact >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -LsSf \
    https://github.com/midnightntwrk/compact/releases/download/compact-v0.5.2/compact-installer.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

compact update 0.31
rm -rf contract/build
compact compile contract/payroll.compact contract/build

test -f contract/build/contract/index.js
for circuit in \
  createWorkspace addEmployee updateEmployee removeEmployee \
  createPayRun registerPayRunPayment approvePayRun fundPayRunPayment claimPayRunPayment \
  proveIncomeAtLeast createIncomeDisclosure createEmploymentDisclosure revokeDisclosure
do
  test -f "contract/build/keys/${circuit}.prover"
  test -f "contract/build/keys/${circuit}.verifier"
  test -f "contract/build/zkir/${circuit}.bzkir"
done

echo "Blackpay protocol v2 Compact 0.31.x build assets verified."
