import {
  parseBase64RpcAccount,
  type Address,
  type EncodedAccount,
  type GetMultipleAccountsApi,
  type Rpc,
  type Slot,
} from "@solana/kit";

const MAX_RETRIES = 3;

async function fetchAccountsInBatches(
  rpc: Rpc<GetMultipleAccountsApi>,
  addresses: Address[],
  batchChunkSize: number,
  maxAccountsChunkSize: number
): Promise<{ slot: Slot; accounts: (EncodedAccount | null)[] }> {
  let slot = 0n;
  const accounts: (EncodedAccount | null)[] = [];

  for (const batch of chunkArray(addresses, batchChunkSize)) {
    const chunks = chunkArray(batch, maxAccountsChunkSize);

    for (let attempt = 1; ; attempt++) {
      try {
        const responses = await Promise.all(
          chunks.map((chunk) =>
            rpc.getMultipleAccounts(chunk, { commitment: "confirmed", encoding: "base64" }).send()
          )
        );
        responses.forEach((response, chunkIndex) => {
          slot = response.context.slot > slot ? response.context.slot : slot;
          response.value.forEach((rpcAccount, index) => {
            const account = parseBase64RpcAccount(chunks[chunkIndex][index], rpcAccount);
            accounts.push(account.exists ? account : null);
          });
        });
        break;
      } catch {
        if (attempt === MAX_RETRIES) {
          throw new Error(`Failed to fetch account infos after ${MAX_RETRIES} retries`);
        }
      }
    }
  }

  return { slot, accounts };
}

export async function chunkedGetRawMultipleAccountInfos(
  rpc: Rpc<GetMultipleAccountsApi>,
  addresses: Address[],
  batchChunkSize: number = 1000,
  maxAccountsChunkSize: number = 100
): Promise<[Slot, Map<Address, EncodedAccount>]> {
  const { slot, accounts } = await fetchAccountsInBatches(
    rpc,
    addresses,
    batchChunkSize,
    maxAccountsChunkSize
  );
  const accountInfoMap = new Map<Address, EncodedAccount>();

  for (const account of accounts) {
    if (account) {
      accountInfoMap.set(account.address, account);
    }
  }

  return [slot, accountInfoMap];
}

export async function chunkedGetRawMultipleAccountInfoOrderedWithNulls(
  rpc: Rpc<GetMultipleAccountsApi>,
  addresses: Address[],
  batchChunkSize: number = 1000,
  maxAccountsChunkSize: number = 100
): Promise<(EncodedAccount | null)[]> {
  const { accounts } = await fetchAccountsInBatches(
    rpc,
    addresses,
    batchChunkSize,
    maxAccountsChunkSize
  );
  return accounts;
}

export async function chunkedGetRawMultipleAccountInfoOrdered(
  rpc: Rpc<GetMultipleAccountsApi>,
  addresses: Address[],
  batchChunkSize: number = 1000,
  maxAccountsChunkSize: number = 100
): Promise<EncodedAccount[]> {
  const { accounts } = await fetchAccountsInBatches(
    rpc,
    addresses,
    batchChunkSize,
    maxAccountsChunkSize
  );
  return accounts.filter((account) => account !== null);
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
