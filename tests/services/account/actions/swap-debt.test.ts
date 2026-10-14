import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import {
  BalanceType,
  createEmptyBalance,
  HealthCacheStatus,
  makeSwapDebtTx,
  MarginfiAccountType,
  SwapEngineRunner,
  SwapProvider,
} from "~/services/account";
import { AssetTag, BankType, OracleSetup } from "~/services/bank";
import { decodeInstruction } from "~/services/transaction";
import type { MarginfiProgram } from "~/types";
import { TOKEN_PROGRAM_ID } from "~/vendor/spl";

const program = new Program<MarginfiIdlType>(
  MARGINFI_IDL,
  new AnchorProvider(new Connection("http://127.0.0.1:1"), {} as Wallet, {})
) as unknown as MarginfiProgram;

const BLOCKHASH = PublicKey.default.toBase58();
const connection = {
  getLatestBlockhash: async () => ({ blockhash: BLOCKHASH }),
  getLatestBlockhashAndContext: async () => ({ value: { blockhash: BLOCKHASH } }),
  // Every ATA exists, so no setup transactions
  getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(() => ({})),
} as unknown as Connection;

function bank(): BankType {
  const oracle = PublicKey.unique();
  return {
    address: PublicKey.unique(),
    mint: PublicKey.unique(),
    mintDecimals: 9,
    assetShareValue: new BigNumber(1),
    liabilityShareValue: new BigNumber(1),
    group: PublicKey.unique(),
    liquidityVault: PublicKey.unique(),
    oracleKey: oracle,
    premiumActive: false,
    config: {
      oracleSetup: OracleSetup.PythPushOracle,
      assetTag: AssetTag.DEFAULT,
      oracleKeys: [oracle],
    },
  } as unknown as BankType;
}

const collateral = bank();
const oldDebt = bank();
const newDebt = bank();
const bankMap = new Map([collateral, oldDebt, newDebt].map((b) => [b.address.toBase58(), b]));

const balance = (b: BankType, side: "asset" | "liability", shares: number): BalanceType => ({
  ...createEmptyBalance(b.address),
  active: true,
  assetShares: new BigNumber(side === "asset" ? shares : 0),
  liabilityShares: new BigNumber(side === "liability" ? shares : 0),
});
const marginfiAccount = {
  address: PublicKey.unique(),
  group: PublicKey.unique(),
  authority: PublicKey.unique(),
  balances: [
    balance(collateral, "asset", 1_000e9),
    balance(oldDebt, "liability", 123_456_789),
    ...Array.from({ length: 14 }, () => createEmptyBalance(PublicKey.default)),
  ],
  accountFlags: [],
  healthCache: { simulationStatus: HealthCacheStatus.UNSET },
} as unknown as MarginfiAccountType;

const swapProgram = PublicKey.unique();
const runner =
  (outAmount: string, otherAmountThreshold: string): SwapEngineRunner =>
  async () => ({
    swapInstructions: [
      new TransactionInstruction({ programId: swapProgram, keys: [], data: Buffer.from([1]) }),
    ],
    setupInstructions: [],
    swapLuts: [],
    quoteResponse: { inAmount: "18700000", outAmount, otherAmountThreshold, slippageBps: 50 },
    outputAmountNative: new BN(otherAmountThreshold),
    provider: SwapProvider.JUPITER,
  });

async function repayIxOf(swapEngineRunner: SwapEngineRunner) {
  const { transactions, actionTxIndex } = await makeSwapDebtTx({
    program,
    marginfiAccount,
    connection,
    bankMap,
    oraclePrices: new Map(),
    bankMetadataMap: {},
    assetShareValueMultiplierByBank: new Map(),
    // 0.123456789123: whole native units round it down to 0.123456789 and up to 0.12345679
    repayOpts: {
      repayBank: oldDebt,
      tokenProgram: TOKEN_PROGRAM_ID,
      totalPositionAmount: 0.123456789123,
      marketPrice: 150,
    },
    borrowOpts: { borrowBank: newDebt, tokenProgram: TOKEN_PROGRAM_ID, marketPrice: 1 },
    swapOpts: {},
    overrideInferAccounts: { group: marginfiAccount.group },
    swapEngineRunner,
  });
  const message = transactions[actionTxIndex].message;
  const keys = message.staticAccountKeys;
  const repay = message.compiledInstructions
    .filter((ix) => keys[ix.programIdIndex]?.equals(program.programId))
    .map((ix) => decodeInstruction(program.idl, Buffer.from(ix.data)))
    .find((ix) => ix?.name === "lendingAccountRepay");
  if (!repay) throw new Error("no repay ix");
  return repay.data as { amount: BN; repayAll: boolean | null };
}

describe("makeSwapDebtTx", () => {
  it("repays all of a debt that isn't a whole number of native units", async () => {
    const repay = await repayIxOf(runner("124000000", "123400000"));
    expect(repay.repayAll).toBe(true);
  });

  it("repays the minimum output, not all, when the quote falls short of the debt", async () => {
    const repay = await repayIxOf(runner("123456789", "123456789"));
    expect(repay.repayAll).toBeFalsy();
    expect(repay.amount.toString()).toBe("123456789");
  });
});
