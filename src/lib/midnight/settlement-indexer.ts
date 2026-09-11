const QUERY = `
  query TxPosition($offset: TransactionOffset!) {
    transactions(offset: $offset) {
      id
      hash
      block { height hash }
      ... on RegularTransaction {
        startIndex
        endIndex
        transactionResult { status }
      }
    }
  }
`.trim();

type TxPosition = {
  startIndex: number;
  endIndex: number;
  status: string;
};

function assertIndexerUri(uri: string): string {
  const parsed = new URL(uri);
  const localhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(localhost && parsed.protocol === "http:")) {
    throw new Error("Midnight settlement indexer must use HTTPS outside localhost");
  }
  if (parsed.username || parsed.password) throw new Error("Midnight settlement indexer URL must not contain embedded credentials");
  return parsed.toString();
}

async function queryPosition(indexerUri: string, txId: string): Promise<TxPosition | null> {
  const response = await fetch(assertIndexerUri(indexerUri), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: QUERY,
      variables: { offset: { identifier: txId.replace(/^0x/i, "") } },
    }),
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(`Midnight indexer returned HTTP ${response.status}`);
  const body = await response.json() as {
    errors?: Array<{ message?: string }>;
    data?: { transactions?: Array<{ startIndex?: number; endIndex?: number; transactionResult?: { status?: string } }> };
  };
  if (body.errors?.length) throw new Error(`Midnight indexer GraphQL error: ${body.errors.map((error) => error.message ?? "unknown").join("; ")}`);
  const tx = body.data?.transactions?.[0];
  if (!tx) return null;
  const startIndex = Number(tx.startIndex);
  const endIndex = Number(tx.endIndex);
  if (!Number.isSafeInteger(startIndex) || !Number.isSafeInteger(endIndex) || startIndex < 0 || endIndex <= startIndex) {
    throw new Error("Midnight indexer returned invalid commitment-tree bounds");
  }
  return { startIndex, endIndex, status: String(tx.transactionResult?.status ?? "") };
}

export async function captureCommitmentCandidates(indexerUri: string, txId: string): Promise<bigint[]> {
  if (!/^[0-9a-f]{64}$/i.test(txId.replace(/^0x/i, ""))) throw new Error("Settlement transaction identifier is invalid");
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const position = await queryPosition(indexerUri, txId);
      if (position) {
        if (position.status && position.status.toUpperCase() !== "SUCCESS") {
          throw new Error(`Settlement funding transaction status is ${position.status}`);
        }
        const count = position.endIndex - position.startIndex;
        if (count > 32) throw new Error(`Settlement funding transaction produced ${count} commitment candidates; refusing unsafe inference`);
        return Array.from({ length: count }, (_, offset) => BigInt(position.startIndex + offset));
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw lastError ?? new Error("Midnight indexer did not expose the settlement funding transaction in time");
}
