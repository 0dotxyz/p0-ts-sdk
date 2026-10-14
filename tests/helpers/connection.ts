import { Connection, PublicKey } from "@solana/web3.js";

export interface StubAccount {
  lamports: number;
  data: Buffer;
  owner?: PublicKey;
}

/**
 * A Connection that serves `accounts` (base58 → account) through the batched getMultipleAccounts
 * path the SDK's chunked fetchers use. Addresses not in the map come back as missing accounts.
 */
export function stubConnection(accounts: Map<string, StubAccount>, epoch = 900): Connection {
  return {
    getEpochInfo: async () => ({ epoch }),
    _buildArgs: ([pubkeys]: [string[]]) => pubkeys,
    _rpcBatchRequest: async (requests: { args: string[] }[]) =>
      requests.map(({ args }) => ({
        result: {
          value: args.map((pk) => {
            const account = accounts.get(pk);
            return account
              ? {
                  lamports: account.lamports,
                  owner: (account.owner ?? PublicKey.default).toBase58(),
                  data: [account.data.toString("base64"), "base64"],
                  executable: false,
                  rentEpoch: 0,
                }
              : null;
          }),
        },
      })),
  } as unknown as Connection;
}

/** A delegated stake account (`StakeStateV2::Stake`) with `delegatedLamports` of active stake. */
export function stakeAccountData(delegatedLamports: bigint, activationEpoch = 0n): Buffer {
  const data = Buffer.alloc(200);
  data.writeUInt32LE(2, 0);
  data.writeBigUInt64LE(delegatedLamports, 156);
  data.writeBigUInt64LE(activationEpoch, 164);
  data.writeBigUInt64LE(0xffffffffffffffffn, 172);
  return data;
}
