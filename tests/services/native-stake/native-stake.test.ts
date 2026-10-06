import {
  address,
  createNoopSigner,
  getAddressDecoder,
  getBase64Decoder,
  type Address,
} from "@solana/kit";
import {
  getStakeStateAccountEncoder,
  STAKE_PROGRAM_ADDRESS,
  StakeAuthorize,
} from "@solana-program/stake";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  getMintEncoder,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { describe, expect, it } from "vitest";

import { BankType } from "~/services/bank";
import {
  computeStakedBankMultipliers,
  makeMergeStakeAccountsTx,
  makeMintStakedLstIx,
  makeRedeemStakedLstIx,
} from "~/services/native-stake";
import {
  findPoolAddress,
  findPoolStakeAuthorityAddress,
  SINGLE_POOL_PROGRAM_ADDRESS,
} from "~/vendor/single-spl-pool";

const authority = createNoopSigner(address("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"));
const stakeAccount = address("CooLbbZy5Xmdt7DiHPQ3ss2uRXawnTXXVgpMS8E8jDzr");
const validator = address("mrgn4t2JabSgvGnrCaHXMvz8ocr4F52scsxJnkQMQsQ");
const base64 = getBase64Decoder();

const encodedAccount = (data: Uint8Array, owner: Address, lamports: bigint) => ({
  data: [base64.decode(data), "base64"],
  owner,
  lamports,
  executable: false,
  space: BigInt(data.length),
});

// A stake account delegating 5 SOL to `validator`.
const stakeRpc = {
  getAccountInfo: () => ({
    send: async () => ({
      context: { slot: 1n },
      value: encodedAccount(
        new Uint8Array(
          getStakeStateAccountEncoder().encode({
            state: {
              __kind: "Stake",
              fields: [
                {
                  rentExemptReserve: 2_282_880n,
                  authorized: { staker: authority.address, withdrawer: authority.address },
                  lockup: { unixTimestamp: 0n, epoch: 0n, custodian: SYSTEM_PROGRAM_ADDRESS },
                },
                {
                  delegation: {
                    voterPubkey: validator,
                    stake: 5_000_000_000n,
                    activationEpoch: 1n,
                    deactivationEpoch: 18_446_744_073_709_551_615n,
                    reserved: new Array(8).fill(0),
                  },
                  creditsObserved: 0n,
                },
                { bits: 0 },
              ],
            },
          })
        ),
        STAKE_PROGRAM_ADDRESS,
        5_002_282_880n
      ),
    }),
  }),
  getMinimumBalanceForRentExemption: () => ({ send: async () => 2_282_880n }),
} as never;

const programs = (ixs: { programAddress: Address }[]) => ixs.map((ix) => ix.programAddress);

describe("native stake actions", () => {
  it("splits a partial amount into a new stake account before depositing it", async () => {
    const ixs = await makeMintStakedLstIx({
      rpc: stakeRpc,
      amount: 1.25,
      authority,
      stakeAccount,
      validator,
    });

    expect(programs(ixs)).toEqual([
      ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      SYSTEM_PROGRAM_ADDRESS,
      STAKE_PROGRAM_ADDRESS,
      STAKE_PROGRAM_ADDRESS,
      STAKE_PROGRAM_ADDRESS,
      SINGLE_POOL_PROGRAM_ADDRESS,
    ]);
    const splitStake = ixs[1].accounts![1];
    expect(splitStake.address).not.toBe(stakeAccount);
    expect(ixs[5].accounts).toContainEqual(
      expect.objectContaining({ address: splitStake.address })
    );
  });

  it("authorizes the pool and deposits the whole account from its delegation up", async () => {
    const ixs = await makeMintStakedLstIx({
      rpc: stakeRpc,
      amount: 5,
      authority,
      stakeAccount,
      validator,
    });
    const poolStakeAuthority = await findPoolStakeAuthorityAddress(
      await findPoolAddress(validator)
    );

    expect(programs(ixs)).toEqual([
      ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      STAKE_PROGRAM_ADDRESS,
      STAKE_PROGRAM_ADDRESS,
      SINGLE_POOL_PROGRAM_ADDRESS,
    ]);
    expect(ixs[1].accounts![0].address).toBe(stakeAccount);
    for (const [ix, kind] of [
      [ixs[1], StakeAuthorize.Staker],
      [ixs[2], StakeAuthorize.Withdrawer],
    ] as const) {
      expect(getAddressDecoder().decode(ix.data!.slice(4, 36))).toBe(poolStakeAuthority);
      expect(ix.data![36]).toBe(kind);
    }
  });

  it("redeems LST into a new stake account", async () => {
    const ixs = await makeRedeemStakedLstIx({ rpc: stakeRpc, amount: 2.5, authority, validator });

    expect(programs(ixs)).toEqual([
      SYSTEM_PROGRAM_ADDRESS,
      TOKEN_PROGRAM_ADDRESS,
      SINGLE_POOL_PROGRAM_ADDRESS,
    ]);
    // approve and withdraw both use the native LST amount
    expect(ixs[1].data?.slice(1)).toEqual(new Uint8Array([0, 249, 2, 149, 0, 0, 0, 0]));
  });

  it("merges the source stake account into the destination", async () => {
    const { message } = await makeMergeStakeAccountsTx({
      rpc: {} as never,
      txFormat: { version: 0, luts: {} },
      latestBlockhash: {
        blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
        lastValidBlockHeight: 1n,
      } as never,
      authority,
      sourceStakeAccount: stakeAccount,
      destinationStakeAccount: validator,
    });

    expect(message.instructions[0].accounts?.map((meta) => meta.address)).toEqual([
      validator,
      stakeAccount,
      authority.address,
    ]);
  });
});

describe("computeStakedBankMultipliers", () => {
  it("divides the pool's stake above 1 SOL by the LST supply", async () => {
    const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
    const bank = (n: number) =>
      ({
        address: key(n),
        config: { oracleKeys: [SYSTEM_PROGRAM_ADDRESS, key(10 + n), key(20 + n)] },
      }) as unknown as BankType;
    const mint = (supply: bigint) =>
      new Uint8Array(
        getMintEncoder().encode({
          mintAuthority: null,
          supply,
          decimals: 9,
          isInitialized: true,
          freezeAuthority: null,
        })
      );
    const accounts: Record<string, ReturnType<typeof encodedAccount> | null> = {
      [bank(1).config.oracleKeys[2]]: encodedAccount(
        new Uint8Array(200),
        STAKE_PROGRAM_ADDRESS,
        11_000_000_000n
      ),
      [bank(1).config.oracleKeys[1]]: encodedAccount(
        mint(8_000_000_000n),
        TOKEN_PROGRAM_ADDRESS,
        1n
      ),
      [bank(2).config.oracleKeys[2]]: null,
      [bank(2).config.oracleKeys[1]]: encodedAccount(mint(1n), TOKEN_PROGRAM_ADDRESS, 1n),
    };
    const rpc = {
      getMultipleAccounts: (addresses: Address[]) => ({
        send: async () => ({ context: { slot: 1n }, value: addresses.map((a) => accounts[a]) }),
      }),
    } as never;

    const multipliers = await computeStakedBankMultipliers(rpc, [bank(1), bank(2)]);

    expect(multipliers.get(bank(1).address)?.toString()).toBe("1.25");
    expect(multipliers.get(bank(2).address)?.toString()).toBe("1");
  });
});
