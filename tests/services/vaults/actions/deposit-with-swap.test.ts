import {
  AccountRole,
  address,
  createNoopSigner,
  getU64Decoder,
  type Instruction,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { describe, expect, it, vi } from "vitest";

import { addr, LATEST_BLOCKHASH } from "../../../helpers/addresses";
import { vaultsRpc } from "../../../helpers/vaults";

import { WSOL_MINT } from "~/constants";
import type { SwapEngineRunner } from "~/services/account/services/swap-engine";
import { SwapProvider } from "~/services/account/types";
import { makeVaultDepositWithSwapTx } from "~/services/vaults";

// The recorded USDC Gamma vault and its asset mint
const USDC_VAULT = address("2cGosKLVJug5MRzQ46Ud5eAJe22T7KpF8tueQsdCeG2a");
const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const GAMMA_PROGRAM = address("GaMmanX9i4jGmqDZZD2tbD6B2v9p21btenPneMXnTczV");
const authority = createNoopSigner(addr());
const swapProgram = addr();

const swapRunner = (outputAmountNative: bigint, swapIx?: Instruction) =>
  vi.fn<SwapEngineRunner>(async () => ({
    swapInstructions: [
      swapIx ?? { programAddress: swapProgram, accounts: [], data: new Uint8Array([1]) },
    ],
    setupInstructions: [],
    swapLuts: {},
    quoteResponse: {
      inAmount: "1",
      outAmount: outputAmountNative.toString(),
      otherAmountThreshold: outputAmountNative.toString(),
      slippageBps: 50,
    },
    outputAmountNative,
    provider: SwapProvider.JUPITER,
  }));

function depositWithSwap(inputMint: ReturnType<typeof addr>, swapEngineRunner: SwapEngineRunner) {
  return makeVaultDepositWithSwapTx({
    rpc: vaultsRpc as never,
    authority,
    lpVault: USDC_VAULT,
    inputMint,
    inputAmount: 1.5,
    inputDecimals: 9,
    swapOpts: {},
    swapEngineRunner,
    txFormat: { version: 0, luts: {} },
    latestBlockhash: LATEST_BLOCKHASH,
  });
}

describe("makeVaultDepositWithSwapTx", () => {
  it("swaps into the vault's asset and deposits the swap's minimum output", async () => {
    const runner = swapRunner(2_000_000n);
    const inputMint = addr();

    const { transaction, destinationAmount } = await depositWithSwap(inputMint, runner);

    const [userAssetAta] = await findAssociatedTokenPda({
      mint: USDC_MINT,
      owner: authority.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    expect(runner.mock.calls[0][0]).toMatchObject({
      inputMint,
      outputMint: USDC_MINT,
      amountNative: 1_500_000_000,
      destinationTokenAccount: userAssetAta,
    });
    const ixs = transaction.message.instructions;
    const deposit = ixs[ixs.length - 1];
    expect(deposit.programAddress).toBe(GAMMA_PROGRAM);
    expect(getU64Decoder().decode(deposit.data ?? new Uint8Array(), 8)).toBe(2_000_000n);
    expect(ixs[ixs.length - 2].programAddress).toBe(swapProgram);
    expect(destinationAmount).toBe(2);
  });

  it("wraps native SOL before swapping it", async () => {
    const { transaction } = await depositWithSwap(WSOL_MINT, swapRunner(2_000_000n));

    // Create the wSOL account, move the SOL into it, sync its balance
    expect(transaction.message.instructions.slice(0, 3).map((ix) => ix.programAddress)).toEqual([
      ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      SYSTEM_PROGRAM_ADDRESS,
      TOKEN_PROGRAM_ADDRESS,
    ]);
  });

  it("throws when the route doesn't fit in one transaction", async () => {
    const hugeSwap: Instruction = {
      programAddress: swapProgram,
      accounts: Array.from({ length: 70 }, () => ({ address: addr(), role: AccountRole.WRITABLE })),
      data: new Uint8Array(8),
    };

    await expect(depositWithSwap(addr(), swapRunner(2_000_000n, hugeSwap))).rejects.toThrow(
      "too large to fit in one transaction"
    );
  });
});
