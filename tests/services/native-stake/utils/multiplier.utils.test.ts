import { getBase64Decoder, type Address } from "@solana/kit";
import { STAKE_PROGRAM_ADDRESS } from "@solana-program/stake";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { getMintEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { describe, expect, it } from "vitest";

import { key } from "../../../helpers/addresses";

import { BankType } from "~/services/bank";
import { computeStakedBankMultipliers } from "~/services/native-stake";

const encodedAccount = (data: Uint8Array, owner: Address, lamports: bigint) => ({
  data: [getBase64Decoder().decode(data), "base64"],
  owner,
  lamports,
  executable: false,
  space: BigInt(data.length),
});

describe("computeStakedBankMultipliers", () => {
  it("prices the pool's delegation, or with on-ramp pricing its and the on-ramp's lamports above rent", async () => {
    const bank = (n: number, stakedOracleUsesOnramp = false) =>
      ({
        address: key(n),
        stakedOracleUsesOnramp,
        config: { oracleKeys: [SYSTEM_PROGRAM_ADDRESS, key(10 + n), key(20 + n), key(30 + n)] },
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
    // A `StakeStateV2::Stake` account: tag 2, then `delegation.stake` after the meta and voter key
    const stake = (delegated: bigint) => {
      const data = new Uint8Array(200);
      const view = new DataView(data.buffer);
      view.setUint32(0, 2, true);
      view.setBigUint64(156, delegated, true);
      return data;
    };
    const rent = 2_282_880n;
    const accounts: Record<string, ReturnType<typeof encodedAccount> | null> = {
      // (11 - 1) / 8 SOL: the delegation, not the lamports, counts
      [key(21)]: encodedAccount(stake(11_000_000_000n), STAKE_PROGRAM_ADDRESS, 12_000_000_000n),
      [key(11)]: encodedAccount(mint(8_000_000_000n), TOKEN_PROGRAM_ADDRESS, 1n),
      [key(31)]: null,
      [key(22)]: null,
      [key(12)]: encodedAccount(mint(1n), TOKEN_PROGRAM_ADDRESS, 1n),
      [key(32)]: null,
      // (6 + 3) / (7 + 1) SOL
      [key(23)]: encodedAccount(stake(1n), STAKE_PROGRAM_ADDRESS, 6_000_000_000n + rent),
      [key(13)]: encodedAccount(mint(7_000_000_000n), TOKEN_PROGRAM_ADDRESS, 1n),
      [key(33)]: encodedAccount(new Uint8Array(200), STAKE_PROGRAM_ADDRESS, 3_000_000_000n + rent),
    };
    const rpc = {
      getMultipleAccounts: (addresses: Address[]) => ({
        send: async () => ({ context: { slot: 1n }, value: addresses.map((a) => accounts[a]) }),
      }),
      getMinimumBalanceForRentExemption: () => ({ send: async () => rent }),
    } as never;

    const multipliers = await computeStakedBankMultipliers(rpc, [bank(1), bank(2), bank(3, true)]);

    expect(multipliers.get(bank(1).address)?.toString()).toBe("1.25");
    expect(multipliers.get(bank(2).address)?.toString()).toBe("1");
    expect(multipliers.get(bank(3).address)?.toString()).toBe("1.125");
  });
});
