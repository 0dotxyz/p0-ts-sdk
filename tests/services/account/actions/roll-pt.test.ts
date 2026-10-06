import {
  address,
  createNoopSigner,
  getAddressDecoder,
  getAddressEncoder,
  getBase64Decoder,
  type Instruction,
} from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { describe, it, expect, vi, beforeEach } from "vitest";


// ---- Shared capture store (hoisted so the mock factories can see it) ----------------
const store = vi.hoisted(() => ({
  flashloanIxs: [] as Instruction[],
  flashloanLuts: {} as Record<string, unknown>,
  simIxLengths: [] as number[],
  setupIxs: [] as Instruction[],
  mergeCtx: undefined as any,
  clmmCtx: undefined as any,
  mergeCalls: 0,
  clmmCalls: 0,
}));

// The exact amounts the quotes produce: merge SY from the vault's redemption-rate math,
// PT out from the standalone trade sim's event return data.
const SY_EXACT = 90_000_000_000n; // floor(pt × sy_for_pt / pt_supply)
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
  computeFlashLoanNonSwapBudget: async () => ({ sizeConstraint: 1000, maxSwapTotalAccounts: 64 }),
  compileFlashloanPrecheck: () => ({
    fullTxSize: 0,
    overshoot: -1,
    writableAccounts: 0,
    totalAccounts: 0,
  }),
}));

vi.mock("~/services/account/actions/account-lifecycle", () => ({
  makeSetupIx: async () => store.setupIxs,
}));

vi.mock("~/services/account/actions/withdraw", () => ({
  makeWithdrawIx: async () => [
    { programAddress: "11111111111111111111111111111111", accounts: [], data: new Uint8Array([9]) },
  ],
}));

// A marginfi `lending_account_deposit` (discriminator + u64 amount + None) with its 7 accounts, so
// the real `isDepositIx` / `patchDepositAmount` recognise it.
vi.mock("~/services/account/actions/deposit", () => ({
  makeDepositIx: async () => {
    const data = new Uint8Array(17);
    data.set([171, 94, 235, 103, 82, 64, 212, 140]);
    return [
      {
        programAddress: "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA",
        accounts: Array.from({ length: 7 }, () => ({
          address: "11111111111111111111111111111111",
          role: 0,
        })),
        data,
      },
    ];
  },
}));

vi.mock("~/services/account/actions/flash-loan", async () => {
  const { makeTransactionMessage, TransactionType } = await import("~/services/transaction");
  return {
    makeFlashLoanTx: async ({ ixs, latestBlockhash, txFormat, authority }: any) => {
      store.flashloanIxs = ixs;
      store.flashloanLuts = txFormat.luts;
      store.simIxLengths.push(ixs.length);
      return {
        message: makeTransactionMessage({
          instructions: ixs,
          feePayer: authority,
          latestBlockhash,
          txFormat: { version: 0, luts: {} },
        }),
        type: TransactionType.FLASHLOAN,
      };
    },
  };
});

import { makeRollPtTx } from "~/services/account/actions/roll-pt";
import type { MakeRollPtTxParams, RollPtOpts } from "~/services/account/types";
import { EXPONENT_CLMM_PROGRAM_ADDRESS, EXPONENT_CORE_PROGRAM_ADDRESS } from "~/vendor/exponent";

function pk(seed: number) {
  const bytes = new Uint8Array(32);
  bytes[31] = seed;
  return getAddressDecoder().decode(bytes);
}

const VAULT_LUT = pk(50);
const CLMM_LUT = pk(51);
// A stand-in for the ATA-create setup ixs (kept out of the flashloan, run in the setup tx).
const SETUP_ATA: Instruction = {
  programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  accounts: [],
  data: new Uint8Array([1]),
};

/** A `TradePtEvent` return blob with `amount_out` (u64 LE) at offset 138. */
function tradeReturnB64(amountOut: bigint): string {
  const blob = new Uint8Array(146);
  new DataView(blob.buffer).setBigUint64(138, amountOut, true);
  return getBase64Decoder().decode(blob);
}

function makeMergeCtx() {
  return {
    vaultAddress: pk(12),
    vault: { mintYt: pk(16) },
    mergeInput: {
      authority: pk(11),
      vault: pk(12),
      syDst: pk(70),
      escrowSy: pk(13),
      ytSrc: pk(14),
      ptSrc: pk(15),
      mintYt: pk(16),
      mintPt: pk(17),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      syProgram: pk(18),
      addressLookupTable: pk(19),
      yieldPosition: pk(20),
    },
    remainingAccounts: [],
    lookupTable: { address: VAULT_LUT, addresses: [] },
    underlying: { mint: pk(41), decimals: 9, tokenProgram: TOKEN_PROGRAM_ADDRESS },
    computeRedeemedAmountNative: () => SY_EXACT,
  };
}

function makeClmmCtx() {
  return {
    marketAddress: pk(60),
    pool: {},
    tradePtInput: {
      market: pk(60),
      ticks: pk(61),
      tokenSyTrader: pk(70),
      tokenPtTrader: pk(71),
      tokenSyEscrow: pk(62),
      tokenPtEscrow: pk(63),
      addressLookupTable: pk(64),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      syProgram: pk(18),
      tokenFeeTreasurySy: pk(65),
      tokenFeeTreasuryPt: pk(66),
    },
    remainingAccounts: [],
    lookupTable: { address: CLMM_LUT, addresses: [] },
    sy: { mint: pk(41), decimals: 9, tokenProgram: TOKEN_PROGRAM_ADDRESS },
    pt: { mint: pk(31), decimals: 6, tokenProgram: TOKEN_PROGRAM_ADDRESS },
  };
}

// The quote's SY holder token account: an initialized SPL token account owned by pk(81).
function holderTokenAccount(): string {
  const data = new Uint8Array(165);
  data.set(getAddressEncoder().encode(pk(81)), 32);
  data[108] = 1; // AccountState::Initialized
  return getBase64Decoder().decode(data);
}

function makeParams(
  overrides: Partial<Omit<MakeRollPtTxParams, "rollOpts">> & { rollOpts?: Partial<RollPtOpts> } = {}
): MakeRollPtTxParams {
  const authority = createNoopSigner(pk(1));
  const { rollOpts: rollOverrides, ...rest } = overrides;
  const send = (value: unknown) => ({ send: async () => value });
  const base: MakeRollPtTxParams = {
    programAddress: address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"),
    marginfiAccount: { authority: pk(1), address: pk(2), group: pk(3), balances: [] } as any,
    authority,
    rpc: {
      getLatestBlockhash: () =>
        send({
          value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0n },
        }),
      // The trade quote reads `TradePtEvent.amount_out` from a standalone succeeding sim's
      // returnData (the merge is sized deterministically from vault state — no sim).
      simulateTransaction: () =>
        send({
          value: {
            err: null,
            logs: [],
            returnData: {
              programId: EXPONENT_CLMM_PROGRAM_ADDRESS,
              data: [tradeReturnB64(PT_OUT), "base64"],
            },
          },
        }),
      // The trade quote runs against the largest SY holder (trader-independent pool quote).
      getTokenLargestAccounts: () =>
        send({ value: [{ address: pk(80), amount: SY_EXACT.toString() }] }),
      getAccountInfo: () =>
        send({
          value: {
            data: [holderTokenAccount(), "base64"],
            executable: false,
            lamports: 1n,
            owner: TOKEN_PROGRAM_ADDRESS,
            space: 165n,
          },
        }),
      // The PT-roll lookup table (jsonParsed, as `fetchAddressesForLookupTables` reads it).
      getMultipleAccounts: () =>
        send({
          value: [
            {
              data: {
                parsed: {
                  info: {
                    addresses: [],
                    authority: pk(1),
                    deactivationSlot: "18446744073709551615",
                    lastExtendedSlot: "0",
                    lastExtendedSlotStartIndex: 0,
                  },
                  type: "lookupTable",
                },
                program: "address-lookup-table",
                space: 56n,
              },
              executable: false,
              lamports: 1n,
              owner: "AddressLookupTab1e1111111111111111111111111",
              space: 56n,
            },
          ],
        }),
    } as any,
    bankMap: new Map(),
    withdrawOpts: {
      totalPositionAmount: 100,
      withdrawBank: { mint: pk(30), mintDecimals: 9 } as any,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    },
    depositOpts: {
      depositBank: { mint: pk(31), mintDecimals: 6 } as any,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    },
    rollOpts: { maturedMarket: pk(60), successorMarket: pk(67), slippageBps: 50 },
    txFormat: { version: 0, luts: {} },
  };
  return { ...base, ...rest, rollOpts: { ...base.rollOpts, ...rollOverrides } };
}

const expectedMinPtOut = (PT_OUT * BigInt(10_000 - 50)) / 10_000n; // slippageBps = 50

const u64At = (ix: Instruction, offset: number) =>
  new DataView(Uint8Array.from(ix.data ?? []).buffer).getBigUint64(offset, true);

describe("makeRollPtTx (merge → CLMM trade_pt)", () => {
  beforeEach(() => {
    store.flashloanIxs = [];
    store.flashloanLuts = {};
    store.simIxLengths = [];
    store.setupIxs = [SETUP_ATA];
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
    expect(ixs[2].data?.[0]).toBe(9); // withdraw stub
    // merge (core program, disc 5, amount_py = uiToNative(100, 9))
    expect(ixs[3].programAddress).toBe(EXPONENT_CORE_PROGRAM_ADDRESS);
    expect(ixs[3].data?.[0]).toBe(5);
    expect(u64At(ixs[3], 1)).toBe(100_000_000_000n);
    // trade_pt (CLMM program, disc 3): amount_in = the exact merge SY, min-out = floor·slippage
    expect(ixs[4].programAddress).toBe(EXPONENT_CLMM_PROGRAM_ADDRESS);
    expect(ixs[4].data?.[0]).toBe(3);
    expect(u64At(ixs[4], 1)).toBe(SY_EXACT); // amount_in = merge amount_sy_out
    expect(ixs[4].data?.[9]).toBe(1); // swap_direction = SyToPt
    expect(u64At(ixs[4], 11)).toBe(expectedMinPtOut); // amount_out_constraint
    // deposit patched to the guaranteed min PT out
    expect(u64At(ixs[5], 8)).toBe(expectedMinPtOut);
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

  it("builds the flash loan exactly once (merge sized from vault state, trade quoted standalone)", async () => {
    await makeRollPtTx(makeParams());
    // makeFlashLoanTx is called once, for the final bundle: the merge is sized from the vault's
    // redemption rate (no sim), and the trade is quoted with a standalone (non-flash-loan) sim.
    expect(store.simIxLengths).toHaveLength(1);
    expect(store.simIxLengths[0]).toBe(6); // cu, cu, withdraw, merge, trade_pt, deposit
  });

  it("decodes the deployed program's compact 16-byte (amount_in, amount_out) return", async () => {
    const params = makeParams();
    const compact = new Uint8Array(16);
    new DataView(compact.buffer).setBigUint64(0, SY_EXACT, true); // identifies the layout (known amount_in)
    new DataView(compact.buffer).setBigUint64(8, PT_OUT, true);
    params.simulateTx = async () => ({
      err: null,
      logs: [],
      returnData: {
        programId: EXPONENT_CLMM_PROGRAM_ADDRESS,
        data: [getBase64Decoder().decode(compact), "base64"],
      },
    });
    const res = await makeRollPtTx(params);
    expect(res.quoteResponse?.outAmount).toBe(PT_OUT.toString());
  });

  it("falls back to the trader's PT balance delta when the trade sim has no return data or logs", async () => {
    const params = makeParams();
    // A bundle-sim-style transport: no structured returnData, truncated logs — only balances.
    params.simulateTx = async () => ({
      err: null,
      logs: ["Log truncated"],
      returnData: null,
      preTokenBalances: [{ mint: pk(31), owner: pk(81), amount: "0" }],
      postTokenBalances: [{ mint: pk(31), owner: pk(81), amount: PT_OUT.toString() }],
    });
    const res = await makeRollPtTx(params);
    expect(res.quoteResponse?.outAmount).toBe(PT_OUT.toString());
  });

  it("carries the matured vault ALT + the CLMM pool ALT in the flashloan lookup tables", async () => {
    await makeRollPtTx(makeParams());
    expect(Object.keys(store.flashloanLuts)).toContain(VAULT_LUT);
    expect(Object.keys(store.flashloanLuts)).toContain(CLMM_LUT);
  });

  it("fetches and carries the dedicated PT-roll lookupTable when provided", async () => {
    await makeRollPtTx(makeParams({ rollOpts: { lookupTable: pk(99) } }));
    expect(Object.keys(store.flashloanLuts)).toContain(pk(99));
  });

  it("keeps ATA creates out of the flashloan", async () => {
    await makeRollPtTx(makeParams());
    const ataInFlashloan = store.flashloanIxs.some(
      (ix) => ix.programAddress === ASSOCIATED_TOKEN_PROGRAM_ADDRESS
    );
    expect(ataInFlashloan).toBe(false);
  });

  it("rejects when no matured market/vault is given", async () => {
    await expect(
      makeRollPtTx(makeParams({ rollOpts: { maturedMarket: undefined, maturedVault: undefined } }))
    ).rejects.toThrow(/maturedMarket/);
  });
});
