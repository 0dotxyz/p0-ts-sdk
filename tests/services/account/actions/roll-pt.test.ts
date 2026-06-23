import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "~/vendor/spl";
import { EXPONENT_CORE_PROGRAM_ID, type ExponentMergeAccounts } from "~/vendor/exponent";

// ---- Shared capture store (hoisted so the mock factories can see it) ----------------
const store = vi.hoisted(() => ({
  flashloanIxs: [] as TransactionInstruction[],
  flashloanLuts: [] as unknown[],
  setupIxs: [] as TransactionInstruction[],
  crank: { instructions: [] as TransactionInstruction[], luts: [] as unknown[] },
  mergeCtx: undefined as any,
  stripCtx: undefined as any,
  stripCalls: 0,
}));

const KNOWN_DEPOSIT_DISC = [171, 94, 235, 103, 82, 64, 212, 140]; // lending_account_deposit

// Stub the Exponent resolvers (RPC) but keep the real ix encoders (makeExponentMergeIx/StripIx).
vi.mock("~/vendor/exponent", async (importActual) => ({
  ...(await importActual<typeof import("~/vendor/exponent")>()),
  resolveExponentMergeContext: async () => store.mergeCtx,
  resolveExponentStripContext: async () => {
    store.stripCalls++;
    return store.stripCtx;
  },
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

const MERGE_LUT = { key: pk(50), state: { addresses: [] } } as any;
const STRIP_LUT = { key: pk(51), state: { addresses: [] } } as any;
const PT_ROLL_LUT = { key: pk(52), state: { addresses: [] } } as any;

function makeMergeAccounts(): ExponentMergeAccounts {
  return {
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
  };
}

function makeMergeCtx() {
  return {
    vaultAddress: pk(12),
    vault: {} as any,
    mergeAccounts: makeMergeAccounts(),
    addressLookupTable: MERGE_LUT,
    underlying: { mint: pk(41), decimals: 9, tokenProgram: TOKEN_PROGRAM_ID },
    computeRedeemedAmountNative: () => 1000n,
  };
}

function makeStripCtx() {
  return {
    vaultAddress: pk(61),
    vault: {} as any,
    stripAccounts: {
      depositor: pk(1),
      authority: pk(62),
      vault: pk(61),
      sySrc: pk(70),
      escrowSy: pk(63),
      ytDst: pk(64),
      ptDst: pk(65),
      mintYt: pk(72),
      mintPt: pk(66),
      syProgram: pk(18),
      addressLookupTable: pk(67),
      yieldPosition: pk(68),
      remainingAccounts: [],
    },
    addressLookupTable: STRIP_LUT,
    sy: { mint: pk(41), decimals: 9, tokenProgram: TOKEN_PROGRAM_ID },
    pt: { mint: pk(66), decimals: 9, tokenProgram: TOKEN_PROGRAM_ID },
    yt: { mint: pk(72), tokenProgram: TOKEN_PROGRAM_ID },
    syExchangeRate: 1,
    computeStrippedPtNative: (n: bigint) => n,
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
    // High-level config: markets in, resolution internal. slippage 0 for predictable amounts.
    rollOpts: { maturedMarket: pk(60), successorVault: pk(61), slippageBps: 0 },
    addressLookupTableAccounts: [],
  };
  return { ...base, ...rest, rollOpts: { ...base.rollOpts, ...rollOverrides } };
}

describe("makeRollPtTx (internalized strip roll)", () => {
  beforeEach(() => {
    store.flashloanIxs = [];
    store.flashloanLuts = [];
    store.setupIxs = [];
    store.crank = { instructions: [], luts: [] };
    store.mergeCtx = makeMergeCtx();
    store.stripCtx = makeStripCtx();
    store.stripCalls = 0;
  });

  it("internally resolves merge + strip and bundles withdraw → merge → strip → deposit", async () => {
    const res = await makeRollPtTx(makeParams());

    // strip mints a new YT → a setup tx (YT ATA create) is emitted ahead of the flashloan.
    expect(res.transactions).toHaveLength(2);
    expect(res.actionTxIndex).toBe(1);
    expect(store.stripCalls).toBe(1);

    const ixs = store.flashloanIxs;
    // [cuLimit, cuPrice, withdraw, merge, strip, deposit]
    expect(ixs).toHaveLength(6);
    const merge = ixs[3];
    const strip = ixs[4];
    const deposit = ixs[5];

    // real merge encoding (disc 5, amount = uiToNative(100, 9))
    expect(merge.programId.equals(EXPONENT_CORE_PROGRAM_ID)).toBe(true);
    expect(merge.data[0]).toBe(5);
    expect(merge.data.readBigUInt64LE(1)).toBe(100_000_000_000n);
    // real strip encoding (disc 4)
    expect(strip.programId.equals(EXPONENT_CORE_PROGRAM_ID)).toBe(true);
    expect(strip.data[0]).toBe(4);
    // deposit byte-patched to the minted PT floor (computeStrippedPtNative(1000) at 0 slippage)
    expect(deposit.data.readBigUInt64LE(8)).toBe(1000n);
  });

  it("carries the merge + strip vault ALTs in the flashloan lookup tables", async () => {
    await makeRollPtTx(makeParams());
    expect(store.flashloanLuts).toContain(MERGE_LUT);
    expect(store.flashloanLuts).toContain(STRIP_LUT);
  });

  it("fetches and carries the dedicated PT-roll lookupTable when provided", async () => {
    await makeRollPtTx(makeParams({ rollOpts: { lookupTable: pk(99) } }));
    expect(store.flashloanLuts).toContain(PT_ROLL_LUT);
  });

  it("creates the new YT ATA in the setup tx, not the flashloan", async () => {
    await makeRollPtTx(makeParams());
    const ataInFlashloan = store.flashloanIxs.some((ix) =>
      ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)
    );
    expect(ataInFlashloan).toBe(false);
  });

  it("uses rollOpts.buy (escape hatch) instead of strip when provided", async () => {
    const marker = new TransactionInstruction({ keys: [], programId: pk(80), data: Buffer.from([0xaa]) });
    const res = await makeRollPtTx(
      makeParams({ rollOpts: { buy: { instructions: [marker], ptOutNative: 500n } } })
    );

    expect(store.stripCalls).toBe(0); // strip resolver NOT called
    expect(res.transactions).toHaveLength(1); // no YT-ATA setup tx
    const ixs = store.flashloanIxs;
    expect(ixs.some((ix) => ix.data[0] === 0xaa)).toBe(true);
    expect(ixs[ixs.length - 1].data.readBigUInt64LE(8)).toBe(500n); // deposit patched to buy.ptOutNative
  });

  it("rejects when no matured market/vault is given", async () => {
    await expect(
      makeRollPtTx(makeParams({ rollOpts: { maturedMarket: undefined, maturedVault: undefined } }))
    ).rejects.toThrow(/maturedMarket/);
  });

  it("rejects when no successor market/vault and no buy override", async () => {
    await expect(
      makeRollPtTx(makeParams({ rollOpts: { successorVault: undefined, successorMarket: undefined } }))
    ).rejects.toThrow(/successorVault/);
  });
});
