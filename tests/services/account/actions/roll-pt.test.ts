import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "~/vendor/spl";
import { EXPONENT_CORE_PROGRAM_ID, EXPONENT_CLMM_PROGRAM_ID } from "~/vendor/exponent";

// ---- Shared capture store (hoisted so the mock factories can see it) ----------------
const store = vi.hoisted(() => ({
  flashloanIxs: [] as TransactionInstruction[],
  flashloanLuts: [] as unknown[],
  simIxLengths: [] as number[],
  setupIxs: [] as TransactionInstruction[],
  crank: { instructions: [] as TransactionInstruction[], luts: [] as unknown[] },
  mergeCtx: undefined as any,
  clmmCtx: undefined as any,
  mergeCalls: 0,
  clmmCalls: 0,
}));

const KNOWN_DEPOSIT_DISC = [171, 94, 235, 103, 82, 64, 212, 140]; // lending_account_deposit

// The exact amounts the quote simulation "returns" via the event return data.
const SY_EXACT = 90_000_000_000n; // MergeEvent.amount_sy_out
const PT_OUT = 1_000_000_000n; // TradePtEvent.amount_out

// Stub the two Exponent resolvers (RPC) but keep the real ix encoders (merge + clmm trade_pt).
vi.mock("~/vendor/exponent", async (importActual) => ({
  ...(await importActual<typeof import("~/vendor/exponent")>()),
  resolveExponentMergeContext: async () => {
    store.mergeCalls++;
    return store.mergeCtx;
  },
  resolveExponentClmmTradePtContext: async () => {
    store.clmmCalls++;
    return store.clmmCtx;
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
    store.simIxLengths.push(ixs.length);
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
const CLMM_LUT = { key: pk(51), state: { addresses: [] } } as any;
const PT_ROLL_LUT = { key: pk(52), state: { addresses: [] } } as any;
// A stand-in for the ATA-create setup ixs (kept out of the flashloan, run in the setup tx).
const SETUP_ATA = new TransactionInstruction({
  keys: [],
  programId: ASSOCIATED_TOKEN_PROGRAM_ID,
  data: Buffer.from([1]),
});

/** A `MergeEvent` return blob with `amount_sy_out` (u64 LE) at offset 296. */
function mergeReturnB64(syOut: bigint): string {
  const buf = Buffer.alloc(304);
  buf.writeBigUInt64LE(syOut, 296);
  return buf.toString("base64");
}
/** A `TradePtEvent` return blob with `amount_out` (u64 LE) at offset 138. */
function tradeReturnB64(amountOut: bigint): string {
  const buf = Buffer.alloc(146);
  buf.writeBigUInt64LE(amountOut, 138);
  return buf.toString("base64");
}

function makeMergeCtx() {
  return {
    vaultAddress: pk(12),
    vault: {} as any,
    mergeAccounts: {
      owner: pk(1),
      authority: pk(11),
      vault: pk(12),
      sySrcDstAta: pk(70),
      escrowSy: pk(13),
      ytSrcAta: pk(14),
      ptSrcAta: pk(15),
      mintYt: pk(16),
      mintPt: pk(17),
      syProgram: pk(18),
      addressLookupTable: pk(19),
      yieldPosition: pk(20),
      tokenProgram: TOKEN_PROGRAM_ID,
      remainingAccounts: [],
    },
    addressLookupTable: VAULT_LUT,
    underlying: { mint: pk(41), decimals: 9, tokenProgram: TOKEN_PROGRAM_ID },
    computeRedeemedAmountNative: () => 0n,
  };
}

function makeClmmCtx() {
  return {
    marketAddress: pk(60),
    market: {} as any,
    tradePtAccounts: {
      trader: pk(1),
      market: pk(60),
      ticks: pk(61),
      tokenSyTrader: pk(70),
      tokenPtTrader: pk(71),
      tokenSyEscrow: pk(62),
      tokenPtEscrow: pk(63),
      addressLookupTable: pk(64),
      syProgram: pk(18),
      tokenFeeTreasurySy: pk(65),
      tokenFeeTreasuryPt: pk(66),
      tokenProgram: TOKEN_PROGRAM_ID,
      remainingAccounts: [],
    },
    addressLookupTable: CLMM_LUT,
    sy: { mint: pk(41), decimals: 9, tokenProgram: TOKEN_PROGRAM_ID },
    pt: { mint: pk(31), decimals: 6, tokenProgram: TOKEN_PROGRAM_ID },
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
      // The merge quote reads `MergeEvent.amount_sy_out` from the flash-loan sim's logs; the trade
      // quote reads `TradePtEvent.amount_out` from a standalone sim's returnData. The same mock
      // surfaces both, so either reader finds what it needs.
      simulateTransaction: async () => ({
        value: {
          err: { InstructionError: [9, { Custom: 1 }] }, // omitted-deposit health check "fails"
          logs: [`Program return: ${EXPONENT_CORE_PROGRAM_ID.toBase58()} ${mergeReturnB64(SY_EXACT)}`],
          returnData: { programId: EXPONENT_CLMM_PROGRAM_ID.toBase58(), data: [tradeReturnB64(PT_OUT), "base64"] },
        },
      }),
      // The trade quote runs against the largest SY holder (trader-independent pool quote).
      getTokenLargestAccounts: async () => ({ value: [{ address: pk(80), amount: SY_EXACT.toString() }] }),
      getParsedAccountInfo: async () => ({ value: { data: { parsed: { info: { owner: pk(81).toBase58() } } } } }),
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
    rollOpts: { maturedMarket: pk(60), successorMarket: pk(67), slippageBps: 50 },
    addressLookupTableAccounts: [],
  };
  return { ...base, ...rest, rollOpts: { ...base.rollOpts, ...rollOverrides } };
}

const expectedMinPtOut = (PT_OUT * BigInt(10_000 - 50)) / 10_000n; // slippageBps = 50

describe("makeRollPtTx (merge → CLMM trade_pt)", () => {
  beforeEach(() => {
    store.flashloanIxs = [];
    store.flashloanLuts = [];
    store.simIxLengths = [];
    store.setupIxs = [SETUP_ATA];
    store.crank = { instructions: [], luts: [] };
    store.mergeCtx = makeMergeCtx();
    store.clmmCtx = makeClmmCtx();
    store.mergeCalls = 0;
    store.clmmCalls = 0;
  });

  it("bundles withdraw → merge → trade_pt → deposit (deposit sized to the min PT out)", async () => {
    const res = await makeRollPtTx(makeParams());

    expect(store.mergeCalls).toBe(1);
    expect(store.clmmCalls).toBe(1);
    // setup tx (ATA creates) + the flashloan
    expect(res.transactions).toHaveLength(2);
    expect(res.actionTxIndex).toBe(1);

    const ixs = store.flashloanIxs;
    // [cuLimit, cuPrice, withdraw, merge, trade_pt, deposit]
    expect(ixs).toHaveLength(6);
    expect(ixs[2].data[0]).toBe(9); // withdraw stub
    // merge (core program, disc 5, amount_py = uiToNative(100, 9))
    expect(ixs[3].programId.equals(EXPONENT_CORE_PROGRAM_ID)).toBe(true);
    expect(ixs[3].data[0]).toBe(5);
    expect(ixs[3].data.readBigUInt64LE(1)).toBe(100_000_000_000n);
    // trade_pt (CLMM program, disc 3): amount_in = the exact merge SY, min-out = floor·slippage
    expect(ixs[4].programId.equals(EXPONENT_CLMM_PROGRAM_ID)).toBe(true);
    expect(ixs[4].data[0]).toBe(3);
    expect(ixs[4].data.readBigUInt64LE(1)).toBe(SY_EXACT); // amount_in = merge amount_sy_out
    expect(ixs[4].data[9]).toBe(1); // swap_direction = SyToPt
    expect(ixs[4].data.readBigUInt64LE(11)).toBe(expectedMinPtOut); // amount_out_constraint
    // deposit patched to the guaranteed min PT out
    expect(ixs[5].data.readBigUInt64LE(8)).toBe(expectedMinPtOut);
  });

  it("returns a quote: exact merge SY in, exact PT out, min-out threshold + slippage", async () => {
    const res = await makeRollPtTx(makeParams());
    expect(res.quoteResponse).toEqual({
      inAmount: SY_EXACT.toString(),
      outAmount: PT_OUT.toString(),
      otherAmountThreshold: expectedMinPtOut.toString(),
      slippageBps: 50,
    });
  });

  it("builds a flash loan twice: the merge-only quote sim, then the final bundle", async () => {
    await makeRollPtTx(makeParams());
    // makeFlashLoanTx is called 2×: the merge quote (redeem only) + the final bundle. The trade
    // is quoted with a standalone simulation (not a flash loan), so it isn't counted here.
    expect(store.simIxLengths).toHaveLength(2);
    // the merge quote sim (setup + cu + withdraw + merge) has fewer ixs than the final bundle.
    expect(store.simIxLengths[0]).toBeLessThan(store.simIxLengths[1]);
    expect(store.simIxLengths[1]).toBe(6); // cu, cu, withdraw, merge, trade_pt, deposit
  });

  it("carries the matured vault ALT + the CLMM pool ALT in the flashloan lookup tables", async () => {
    await makeRollPtTx(makeParams());
    expect(store.flashloanLuts).toContain(VAULT_LUT);
    expect(store.flashloanLuts).toContain(CLMM_LUT);
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
