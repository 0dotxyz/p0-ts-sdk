import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { key } from "../helpers/addresses";

import {
  deriveBankLiquidityVault,
  deriveBankLiquidityVaultAuthority,
  deriveFeeState,
  deriveMarginfiAccount,
  deriveOrderPda,
} from "~/utils";

const PROGRAM_ID = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const ACCOUNT = address("11111111111111111111111111111112");
const BANK_A = address("CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh");
const BANK_B = address("2s37akK2eyBbp8DZgCm7RtsaEz8eJE3Nbb2b9dEVRR6d");

// Values match the pre-Kit web3.js implementations; never update the snapshot with `-u`.
describe("marginfi PDAs", () => {
  it("derives the recorded addresses", async () => {
    const program = key(200);
    expect({
      liquidityVaultAuthority: await deriveBankLiquidityVaultAuthority(program, key(4)),
      liquidityVault: await deriveBankLiquidityVault(program, key(4)),
      feeState: await deriveFeeState(program),
      marginfiAccount: await deriveMarginfiAccount(program, key(1), key(2), 3, 7),
    }).toMatchSnapshot();
  });
});

describe("deriveOrderPda", () => {
  it("matches the PDA main's web3.js derivation produces", async () => {
    const [orderPda] = await deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_A, BANK_B]);
    expect(orderPda).toBe("DN9chMywrHaiAxt7StCrUWTVYoKYVEa2QasjmhkuysAb");
  });

  it("is independent of the bank key order", async () => {
    const [orderPda] = await deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_A, BANK_B]);
    const [orderPdaReversed] = await deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_B, BANK_A]);
    expect(orderPda).toBe(orderPdaReversed);
  });

  it("differs per pair", async () => {
    const [orderPda] = await deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_A, BANK_B]);
    const [otherPairOrderPda] = await deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_A, ACCOUNT]);
    expect(orderPda).not.toBe(otherPairOrderPda);
  });
});
