import { address, createNoopSigner, getAddressDecoder, getBase64Decoder } from "@solana/kit";
import {
  getStakeStateAccountEncoder,
  STAKE_PROGRAM_ADDRESS,
  StakeAuthorize,
} from "@solana-program/stake";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { describe, expect, it } from "vitest";

import { makeMintStakedLstIx } from "~/services/native-stake";
import {
  findPoolAddress,
  findPoolStakeAuthorityAddress,
  SINGLE_POOL_PROGRAM_ADDRESS,
} from "~/vendor/single-spl-pool";

const authority = createNoopSigner(address("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"));
const stakeAccount = address("CooLbbZy5Xmdt7DiHPQ3ss2uRXawnTXXVgpMS8E8jDzr");
const validator = address("mrgn4t2JabSgvGnrCaHXMvz8ocr4F52scsxJnkQMQsQ");

const stakeData = new Uint8Array(
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
);

// A stake account delegating 5 SOL to `validator`.
const stakeRpc = {
  getAccountInfo: () => ({
    send: async () => ({
      context: { slot: 1n },
      value: {
        data: [getBase64Decoder().decode(stakeData), "base64"],
        owner: STAKE_PROGRAM_ADDRESS,
        lamports: 5_002_282_880n,
        executable: false,
        space: BigInt(stakeData.length),
      },
    }),
  }),
  getMinimumBalanceForRentExemption: () => ({ send: async () => 2_282_880n }),
} as never;

const programs = (ixs: { programAddress: string }[]) => ixs.map((ix) => ix.programAddress);

describe("makeMintStakedLstIx", () => {
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
});
