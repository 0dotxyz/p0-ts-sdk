import { describe, it, expect, vi, beforeEach } from "vitest";
import BN from "bn.js";
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "~/vendor/spl";
import { EXPONENT_CORE_PROGRAM_ID } from "~/vendor/exponent";

// ---- Shared capture store (hoisted so the mock factories can see it) ----------------
const store = vi.hoisted(() => ({
  flashloanIxs: [] as TransactionInstruction[],
  flashloanLuts: [] as unknown[],
  setupIxs: [] as TransactionInstruction[],
  crank: { instructions: [] as TransactionInstruction[], luts: [] as unknown[] },
  wrapperCtx: undefined as any,
  swapResult: undefined as any,
  wrapperCalls: 0,
  swapCalls: 0,
}));

const KNOWN_DEPOSIT_DISC = [171, 94, 235, 103, 82, 64, 212, 140]; // lending_account_deposit

// Stub the Exponent resolver (RPC) but keep the real ix encoder (makeExponentWrapperMergeIx).
vi.mock("~/vendor/exponent", async (importActual) => ({
  ...(await importActual<typeof import("~/vendor/exponent")>()),
  resolveExponentWrapperMergeContext: async () => {
    store.wrapperCalls++;
    return store.wrapperCtx;
  },
}));

// Keep the pure opts→fields helpers, mock the engine itself (no Titan/Jupiter RPC).
vi.mock("~/services/account/services/swap-engine", async (importActual) => ({
  ...(await importActual<typeof import("~/services/account/services/swap-engine")>()),
  runSwapEngine: async () => {
    store.swapCalls++;
    return store.swapResult;
  },
}));

// Keep isWholePosition/patchDepositAmount/isDepositIx real; stub the size estimators (need real banks).
vi.mock("~/services/account/utils", async (importActual) => ({
  ...(await importActual<typeof import("~/services/account/utils")>()),
  computeFlashLoanNonSwapBudget: () => ({ sizeConstraint: 1000, maxSwapTotalAccounts: 64 }),
  compileFlashloanPrecheck: () => ({ fullTxSize: 0, overshoot: -1, writableAccounts: 0, totalAccounts: 0 }),
}));

vi.mock("~/services/account/actions/account-lifecycle", () => ({
  makeSetupIx: async () => store.setupIxs,
}));

vi.mock("~/services/account/actions/withdraw", () => ({
  makeWithdrawIx: async () => ({
    instructions: [
      new TransactionInstruction({ keys: [], programId: PublicKey.default, data: Buffer.from([9]) }),
    ],
    keys: [],
  }),
}));

vi.mock("~/services/account/actions/deposit", () => ({
  makeDepositIx: async () => {
    const data = Buffer.alloc(16);
    Buffer.from(KNOWN_DEPOSIT_DISC).copy(data, 0);
    return {
      instructions: [new TransactionInstruction({ keys: [], programId: PublicKey.default, data })],
      keys: [],
    };
  },
}));

vi.mock("~/services/price", async (importActual) => ({
  ...(await importActual<typeof import("~/services/price")>()),
  makeSmartCrankSwbFeedIx: async () => store.crank,
}));

vi.mock("~/services/account/actions/flash-loan", () => ({
  makeFlashLoanTx: async ({ ixs, blockhash, addressLookupTableAccounts, marginfiAccount }: any) => {
    store.flashloanIxs = ixs;
    store.flashloanLuts = addressLookupTableAccounts;
    const message = new TransactionMessage({
      payerKey: marginfiAccount.authority,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();
    return new VersionedTransaction(message);
  },
}));

import { makeRollPtTx } from "~/services/account/actions/roll-pt";
import type { MakeRollPtTxParams, RollPtOpts } from "~/services/account/types";

function pk(seed: number): PublicKey {
  const b = Buffer.alloc(32);
  b[31] = seed;
  return new PublicKey(b);
}

const VAULT_LUT = { key: pk(50), state: { addresses: [] } } as any;
const SWAP_LUT = { key: pk(51), state: { addresses: [] } } as any;
const PT_ROLL_LUT = { key: pk(52), state: { addresses: [] } } as any;
const STAKE_POOL_REFRESH = new TransactionInstruction({
  keys: [],
  programId: pk(90),
  data: Buffer.from([7]),
});
const SWAP_MARKER = new TransactionInstruction({ keys: [], programId: pk(80), data: Buffer.from([0xaa]) });

function makeWrapperCtx() {
  return {
    vaultAddress: pk(12),
    vault: {} as any,
    wrapperMergeAccounts: {
      owner: pk(1),
      syAta: pk(70),
      vault: pk(12),
      escrowSy: pk(13),
      ytAta: pk(14),
      ptAta: pk(15),
      mintYt: pk(16),
      mintPt: pk(17),
      authority: pk(11),
      addressLookupTable: pk(19),
      yieldPosition: pk(20),
      syProgram: pk(18),
      tokenProgram: TOKEN_PROGRAM_ID,
      remainingAccounts: [],
      redeemSyAccountsUntil: 10,
    },
    preInstructions: [STAKE_POOL_REFRESH],
    addressLookupTable: VAULT_LUT,
    baseToken: { mint: pk(41), decimals: 9, tokenProgram: TOKEN_PROGRAM_ID },
    setupMints: [{ mint: pk(41), tokenProgram: TOKEN_PROGRAM_ID }],
    computeRedeemedBaseNative: () => 999n,
  };
}

function makeSwapResult() {
  return {
    swapInstructions: [SWAP_MARKER],
    setupInstructions: [],
    swapLuts: [SWAP_LUT],
    quoteResponse: { outAmount: "777" } as any,
    outputAmountNative: new BN(777),
  };
}

function makeParams(
  overrides: Partial<Omit<MakeRollPtTxParams, "rollOpts">> & { rollOpts?: Partial<RollPtOpts> } = {}
): MakeRollPtTxParams {
  const authority = pk(1);
  const { rollOpts: rollOverrides, ...rest } = overrides;
  const base: MakeRollPtTxParams = {
    program: {} as any,
    marginfiAccount: { authority, address: pk(2), group: pk(3), balances: [] } as any,
    connection: {
      getLatestBlockhash: async () => ({ blockhash: PublicKey.default.toBase58() }),
      getAddressLookupTable: async () => ({ value: PT_ROLL_LUT }),
    } as any,
    bankMap: new Map(),
    oraclePrices: new Map(),
    bankMetadataMap: {} as any,
    assetShareValueMultiplierByBank: new Map(),
    withdrawOpts: {
      totalPositionAmount: 100,
      withdrawBank: { mint: pk(30), mintDecimals: 9 } as any,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
    depositOpts: {
      depositBank: { mint: pk(31), mintDecimals: 6 } as any,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
    swapOpts: { swapConfig: {} } as any,
    rollOpts: { maturedMarket: pk(60), baseMint: pk(41) },
    addressLookupTableAccounts: [],
  };
  return { ...base, ...rest, rollOpts: { ...base.rollOpts, ...rollOverrides } };
}

describe("makeRollPtTx (wrapper_merge + swap engine)", () => {
  beforeEach(() => {
    store.flashloanIxs = [];
    store.flashloanLuts = [];
    store.setupIxs = [];
    store.crank = { instructions: [], luts: [] };
    store.wrapperCtx = makeWrapperCtx();
    store.swapResult = makeSwapResult();
    store.wrapperCalls = 0;
    store.swapCalls = 0;
  });

  it("bundles withdraw → wrapper_merge → swap → deposit; runs the stake-pool refresh in setup", async () => {
    const res = await makeRollPtTx(makeParams());

    expect(store.wrapperCalls).toBe(1);
    expect(store.swapCalls).toBe(1);
    // setup tx (carries the flavor stake-pool refresh pre-ix) + the flashloan
    expect(res.transactions).toHaveLength(2);
    expect(res.actionTxIndex).toBe(1);

    const ixs = store.flashloanIxs;
    // [cuLimit, cuPrice, withdraw, wrapper_merge, swap, deposit] — refresh is NOT in the flashloan
    expect(ixs).toHaveLength(6);
    expect(ixs[2].data[0]).toBe(9); // withdraw stub
    expect(ixs[3].programId.equals(EXPONENT_CORE_PROGRAM_ID)).toBe(true);
    expect(ixs[3].data[0]).toBe(39); // wrapper_merge disc
    expect(ixs[3].data.readBigUInt64LE(1)).toBe(100_000_000_000n); // amount_py = uiToNative(100, 9)
    expect(ixs[3].data.readUInt8(9)).toBe(10); // redeem_sy_accounts_until
    expect(ixs[4].data[0]).toBe(0xaa); // swap marker
    expect(ixs[5].data.readBigUInt64LE(8)).toBe(777n); // deposit patched to swap min-out
    // the stake-pool refresh ran in the setup tx, keeping its accounts out of the flashloan
    expect(ixs.some((ix) => ix.programId.equals(pk(90)))).toBe(false);
  });

  it("returns the swap engine's quote (the destination amount the UI needs)", async () => {
    const res = await makeRollPtTx(makeParams());
    expect(res.quoteResponse).toEqual({ outAmount: "777" });
  });

  it("carries the vault ALT + swap LUTs in the flashloan lookup tables", async () => {
    await makeRollPtTx(makeParams());
    expect(store.flashloanLuts).toContain(VAULT_LUT);
    expect(store.flashloanLuts).toContain(SWAP_LUT);
  });

  it("fetches and carries the dedicated PT-roll lookupTable when provided", async () => {
    await makeRollPtTx(makeParams({ rollOpts: { lookupTable: pk(99) } }));
    expect(store.flashloanLuts).toContain(PT_ROLL_LUT);
  });

  it("keeps ATA creates out of the flashloan", async () => {
    await makeRollPtTx(makeParams());
    const ataInFlashloan = store.flashloanIxs.some((ix) =>
      ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)
    );
    expect(ataInFlashloan).toBe(false);
  });

  it("rejects when no matured market/vault is given", async () => {
    await expect(
      makeRollPtTx(makeParams({ rollOpts: { maturedMarket: undefined, maturedVault: undefined } }))
    ).rejects.toThrow(/maturedMarket/);
  });
});
