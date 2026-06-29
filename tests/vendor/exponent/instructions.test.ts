import { describe, it, expect, vi } from "vitest";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BigNumber } from "bignumber.js";

import {
  exponentBuyPtArgs,
  exponentClmmBuyPtArgs,
  makeExponentTradePtIx,
  makeExponentClmmTradePtIx,
  makeExponentStripIx,
  makeExponentWrapperMergeIx,
  EXPONENT_CORE_PROGRAM_ID,
  EXPONENT_CLMM_PROGRAM_ID,
  ExponentSwapDirection,
  type ExponentTradePtAccounts,
  type ExponentClmmTradePtAccounts,
  type ExponentStripAccounts,
  type ExponentWrapperMergeAccounts,
} from "~/vendor/exponent";

// The resolvers pull the MarketTwo/MarketThree/Vault decode from deserialize.utils; mock that
// single boundary so the resolvers run without RPC.
const hoisted = vi.hoisted(() => ({
  market: undefined as any,
  marketThree: undefined as any,
  vault: undefined as any,
}));

vi.mock("~/vendor/exponent/utils/deserialize.utils", () => ({
  fetchExponentMarketTwo: async () => hoisted.market,
  fetchExponentMarketThree: async () => hoisted.marketThree,
  fetchExponentVault: async () => hoisted.vault,
  getMintDecimals: async (_conn: unknown, mint: PublicKey) => {
    const m = hoisted.marketThree ?? hoisted.market;
    return m && mint.equals(m.mintSy) ? 9 : 6;
  },
}));

import {
  resolveExponentTradePtContext,
  resolveExponentClmmTradePtContext,
  resolveExponentStripContext,
  resolveExponentWrapperMergeContext,
} from "~/vendor/exponent/utils/resolve.utils";

function pk(seed: number): PublicKey {
  const b = Buffer.alloc(32);
  b[31] = seed;
  return new PublicKey(b);
}

// ============================================================================
// trade_pt — instruction encoding + resolver
// ============================================================================

function makeTradePtAccounts(
  overrides: Partial<ExponentTradePtAccounts> = {}
): ExponentTradePtAccounts {
  return {
    trader: pk(1),
    market: pk(2),
    tokenSyTrader: pk(3),
    tokenPtTrader: pk(4),
    tokenSyEscrow: pk(5),
    tokenPtEscrow: pk(6),
    addressLookupTable: pk(7),
    syProgram: pk(8),
    tokenFeeTreasurySy: pk(9),
    remainingAccounts: [
      { pubkey: pk(20), isSigner: false, isWritable: false },
      { pubkey: pk(21), isSigner: false, isWritable: true },
    ],
    ...overrides,
  };
}

describe("exponentBuyPtArgs", () => {
  it("buys PT: net_trader_pt = +ptOut, sy_constraint = -maxSyIn", () => {
    expect(exponentBuyPtArgs({ ptOutNative: 1000n, maxSyInNative: 1500n })).toEqual({
      netTraderPt: 1000n,
      syConstraint: -1500n,
    });
  });
});

describe("makeExponentTradePtIx", () => {
  it("encodes discriminator [17] + two i64 LE args (sy_constraint signed)", () => {
    const ix = makeExponentTradePtIx(makeTradePtAccounts(), {
      netTraderPt: 1000n,
      syConstraint: -1500n,
    });

    expect(ix.programId.equals(EXPONENT_CORE_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(1 + 16);
    expect(ix.data[0]).toBe(17);
    expect(ix.data.readBigInt64LE(1)).toBe(1000n);
    // negative sy_constraint round-trips as two's-complement i64
    expect(ix.data.readBigInt64LE(9)).toBe(-1500n);
  });

  it("lays out the 12 fixed accounts in IDL order, then appends remaining accounts", () => {
    const accounts = makeTradePtAccounts();
    const ix = makeExponentTradePtIx(accounts, { netTraderPt: 1n, syConstraint: -1n });

    // 12 fixed + 2 remaining
    expect(ix.keys.length).toBe(14);

    // trader is the only signer; writable accounts match the IDL flags
    expect(ix.keys[0]).toMatchObject({ pubkey: accounts.trader, isSigner: true, isWritable: true });
    expect(ix.keys[1]).toMatchObject({ pubkey: accounts.market, isWritable: true });
    expect(ix.keys[2].pubkey.equals(accounts.tokenSyTrader)).toBe(true);
    expect(ix.keys[3].pubkey.equals(accounts.tokenPtTrader)).toBe(true);
    expect(ix.keys[4].pubkey.equals(accounts.tokenSyEscrow)).toBe(true);
    expect(ix.keys[5].pubkey.equals(accounts.tokenPtEscrow)).toBe(true);
    expect(ix.keys[6].pubkey.equals(accounts.addressLookupTable)).toBe(true);
    expect(ix.keys[6].isWritable).toBe(false);
    expect(ix.keys[8].pubkey.equals(accounts.syProgram)).toBe(true);
    expect(ix.keys[9]).toMatchObject({ pubkey: accounts.tokenFeeTreasurySy, isWritable: true });
    // index 11 is the core program itself (Anchor event self-CPI)
    expect(ix.keys[11].pubkey.equals(EXPONENT_CORE_PROGRAM_ID)).toBe(true);

    // remaining (SY-CPI) accounts come strictly after the 12 fixed ones, flags preserved
    expect(ix.keys[12]).toMatchObject({ pubkey: pk(20), isWritable: false });
    expect(ix.keys[13]).toMatchObject({ pubkey: pk(21), isWritable: true });

    // exactly one signer in the whole instruction
    expect(ix.keys.filter((k) => k.isSigner).length).toBe(1);
  });

  it("has no remaining accounts when the market exposes none", () => {
    const ix = makeExponentTradePtIx(makeTradePtAccounts({ remainingAccounts: [] }), {
      netTraderPt: 1n,
      syConstraint: -1n,
    });
    expect(ix.keys.length).toBe(12);
  });
});

describe("resolveExponentTradePtContext", () => {
  const owner = pk(100);
  const altAddresses = [pk(50), pk(51), pk(52), pk(53)];

  const market = {
    selfAddress: pk(2),
    mintPt: pk(40),
    mintSy: pk(41),
    vault: pk(42),
    tokenPtEscrow: pk(6),
    tokenSyEscrow: pk(5),
    tokenFeeTreasurySy: pk(9),
    addressLookupTable: pk(7),
    syProgram: pk(8),
    statusFlags: 0,
    cpiAccounts: {
      getSyState: [{ altIndex: 2, isSigner: false, isWritable: false }],
      depositSy: [{ altIndex: 0, isSigner: false, isWritable: true }],
      withdrawSy: [{ altIndex: 1, isSigner: false, isWritable: true }],
    },
  };

  function makeConnection(addresses = altAddresses) {
    return {
      getAddressLookupTable: vi.fn(async () => ({ value: { state: { addresses } } })),
    } as any;
  }

  it("resolves SY-CPI remaining accounts from the market ALT in getSyState→depositSy→withdrawSy order", async () => {
    hoisted.market = market;
    const ctx = await resolveExponentTradePtContext({
      connection: makeConnection(),
      owner,
      market: market.selfAddress,
    });

    const rem = ctx.tradePtAccounts.remainingAccounts;
    expect(rem).toHaveLength(3);
    // getSyState[0] → ALT index 2, then depositSy[0] → index 0, then withdrawSy[0] → index 1
    expect(rem[0]).toMatchObject({ pubkey: altAddresses[2], isWritable: false });
    expect(rem[1]).toMatchObject({ pubkey: altAddresses[0], isWritable: true });
    expect(rem[2]).toMatchObject({ pubkey: altAddresses[1], isWritable: true });
  });

  it("derives the owner's SY/PT ATAs and surfaces the market escrows + ALT", async () => {
    hoisted.market = market;
    const conn = makeConnection();
    const ctx = await resolveExponentTradePtContext({ connection: conn, owner, market: market.selfAddress });

    expect(ctx.marketAddress.equals(market.selfAddress)).toBe(true);
    expect(ctx.tradePtAccounts.tokenSyEscrow.equals(market.tokenSyEscrow)).toBe(true);
    expect(ctx.tradePtAccounts.tokenFeeTreasurySy.equals(market.tokenFeeTreasurySy)).toBe(true);
    expect(ctx.sy.mint.equals(market.mintSy)).toBe(true);
    expect(ctx.sy.decimals).toBe(9);
    expect(ctx.pt.decimals).toBe(6);
    // the resolved ALT account is returned so the caller can add it to the tx's lookup tables
    expect(conn.getAddressLookupTable).toHaveBeenCalledWith(market.addressLookupTable);
  });

  it("throws when a CPI account references an ALT index that is out of range", async () => {
    hoisted.market = {
      ...market,
      cpiAccounts: {
        getSyState: [{ altIndex: 99, isSigner: false, isWritable: false }],
        depositSy: [],
        withdrawSy: [],
      },
    };
    await expect(
      resolveExponentTradePtContext({ connection: makeConnection(), owner, market: market.selfAddress })
    ).rejects.toThrow(/out of range/);
  });
});

// ============================================================================
// CLMM (MarketThree) trade_pt — instruction encoding + resolver
// ============================================================================

function makeClmmTradePtAccounts(
  overrides: Partial<ExponentClmmTradePtAccounts> = {}
): ExponentClmmTradePtAccounts {
  return {
    trader: pk(1),
    market: pk(2),
    ticks: pk(3),
    tokenSyTrader: pk(4),
    tokenPtTrader: pk(5),
    tokenSyEscrow: pk(6),
    tokenPtEscrow: pk(7),
    addressLookupTable: pk(8),
    syProgram: pk(9),
    tokenFeeTreasurySy: pk(10),
    tokenFeeTreasuryPt: pk(11),
    remainingAccounts: [
      { pubkey: pk(20), isSigner: false, isWritable: false },
      { pubkey: pk(21), isSigner: false, isWritable: true },
    ],
    ...overrides,
  };
}

describe("exponentClmmBuyPtArgs", () => {
  it("buys PT with SY: amountIn = SY in, SyToPt, amountOutConstraint = min PT, no price limit", () => {
    expect(exponentClmmBuyPtArgs({ amountInSyNative: 1500n, minPtOutNative: 1000n })).toEqual({
      amountIn: 1500n,
      swapDirection: ExponentSwapDirection.SyToPt,
      amountOutConstraint: 1000n,
      priceSpotLimit: null,
    });
  });
});

describe("makeExponentClmmTradePtIx", () => {
  it("encodes disc [3] + amount_in(u64) + swap_direction(u8) + Some(min) + None(price)", () => {
    const ix = makeExponentClmmTradePtIx(
      makeClmmTradePtAccounts(),
      exponentClmmBuyPtArgs({ amountInSyNative: 1500n, minPtOutNative: 1000n })
    );

    expect(ix.programId.equals(EXPONENT_CLMM_PROGRAM_ID)).toBe(true);
    // disc(1) + amountIn(8) + swapDirection(1) + Option<u64> Some(1+8) + Option<f64> None(1) = 20
    expect(ix.data.length).toBe(1 + 8 + 1 + 9 + 1);
    expect(ix.data[0]).toBe(3);
    expect(ix.data.readBigUInt64LE(1)).toBe(1500n); // amount_in
    expect(ix.data[9]).toBe(1); // swap_direction = SyToPt
    expect(ix.data[10]).toBe(1); // amount_out_constraint Option tag = Some
    expect(ix.data.readBigUInt64LE(11)).toBe(1000n); // min PT out
    expect(ix.data[19]).toBe(0); // price_spot_limit Option tag = None
  });

  it("encodes a None amount_out_constraint as a single 0 tag byte", () => {
    const ix = makeExponentClmmTradePtIx(makeClmmTradePtAccounts(), {
      amountIn: 5n,
      swapDirection: ExponentSwapDirection.SyToPt,
      amountOutConstraint: null,
      priceSpotLimit: null,
    });
    // disc(1) + amountIn(8) + dir(1) + None(1) + None(1) = 12
    expect(ix.data.length).toBe(12);
    expect(ix.data[9]).toBe(1);
    expect(ix.data[10]).toBe(0); // None
    expect(ix.data[11]).toBe(0); // None
  });

  it("lays out the 14 fixed accounts in IDL order, then appends remaining accounts", () => {
    const accounts = makeClmmTradePtAccounts();
    const ix = makeExponentClmmTradePtIx(
      accounts,
      exponentClmmBuyPtArgs({ amountInSyNative: 1n, minPtOutNative: 1n })
    );

    expect(ix.keys.length).toBe(16); // 14 fixed + 2 remaining
    expect(ix.keys[0]).toMatchObject({ pubkey: accounts.trader, isSigner: true, isWritable: true });
    expect(ix.keys[1]).toMatchObject({ pubkey: accounts.market, isWritable: true });
    expect(ix.keys[2]).toMatchObject({ pubkey: accounts.ticks, isWritable: true });
    expect(ix.keys[3].pubkey.equals(accounts.tokenSyTrader)).toBe(true);
    expect(ix.keys[4].pubkey.equals(accounts.tokenPtTrader)).toBe(true);
    expect(ix.keys[5].pubkey.equals(accounts.tokenSyEscrow)).toBe(true);
    expect(ix.keys[6].pubkey.equals(accounts.tokenPtEscrow)).toBe(true);
    expect(ix.keys[7]).toMatchObject({ pubkey: accounts.addressLookupTable, isWritable: false });
    expect(ix.keys[9].pubkey.equals(accounts.syProgram)).toBe(true);
    expect(ix.keys[10]).toMatchObject({ pubkey: accounts.tokenFeeTreasurySy, isWritable: true });
    expect(ix.keys[11]).toMatchObject({ pubkey: accounts.tokenFeeTreasuryPt, isWritable: true });
    // index 13 is the CLMM program itself (Anchor event self-CPI)
    expect(ix.keys[13].pubkey.equals(EXPONENT_CLMM_PROGRAM_ID)).toBe(true);
    // remaining accounts come strictly after the 14 fixed ones
    expect(ix.keys[14]).toMatchObject({ pubkey: pk(20), isWritable: false });
    expect(ix.keys[15]).toMatchObject({ pubkey: pk(21), isWritable: true });
    expect(ix.keys.filter((k) => k.isSigner).length).toBe(1);
  });
});

describe("resolveExponentClmmTradePtContext", () => {
  const owner = pk(100);
  const altAddresses = [pk(50), pk(51), pk(52), pk(53)];

  const marketThree = {
    selfAddress: pk(2),
    mintPt: pk(40),
    mintSy: pk(41),
    vault: pk(42),
    ticks: pk(3),
    tokenPtEscrow: pk(7),
    tokenSyEscrow: pk(6),
    tokenFeeTreasurySy: pk(10),
    tokenFeeTreasuryPt: pk(11),
    addressLookupTable: pk(8),
    syProgram: pk(9),
    statusFlags: 0,
    cpiAccounts: {
      getSyState: [{ altIndex: 2, isSigner: false, isWritable: false }],
      getPositionState: [{ altIndex: 3, isSigner: false, isWritable: false }],
      depositSy: [{ altIndex: 0, isSigner: false, isWritable: true }],
      // withdrawSy repeats getSyState's index 2 → should de-duplicate, OR-ing writability.
      withdrawSy: [{ altIndex: 2, isSigner: false, isWritable: true }],
    },
  };

  function makeConnection(addresses = altAddresses) {
    return {
      getAddressLookupTable: vi.fn(async () => ({ value: { state: { addresses } } })),
    } as any;
  }

  it("resolves + de-duplicates SY-CPI remaining accounts in getSyState→getPositionState→depositSy→withdrawSy order", async () => {
    hoisted.marketThree = marketThree;
    const ctx = await resolveExponentClmmTradePtContext({
      connection: makeConnection(),
      owner,
      market: marketThree.selfAddress,
    });

    const rem = ctx.tradePtAccounts.remainingAccounts;
    // getSyState[2], getPositionState[3], depositSy[0]; withdrawSy[2] dedupes into the first → 3 unique
    expect(rem).toHaveLength(3);
    expect(rem[0]).toMatchObject({ pubkey: altAddresses[2], isWritable: true }); // OR-merged writability
    expect(rem[1]).toMatchObject({ pubkey: altAddresses[3], isWritable: false });
    expect(rem[2]).toMatchObject({ pubkey: altAddresses[0], isWritable: true });
  });

  it("derives the owner's SY/PT ATAs and surfaces the pool ticks, escrows, fee treasuries + ALT", async () => {
    hoisted.marketThree = marketThree;
    const conn = makeConnection();
    const ctx = await resolveExponentClmmTradePtContext({
      connection: conn,
      owner,
      market: marketThree.selfAddress,
    });

    expect(ctx.marketAddress.equals(marketThree.selfAddress)).toBe(true);
    expect(ctx.tradePtAccounts.ticks.equals(marketThree.ticks)).toBe(true);
    expect(ctx.tradePtAccounts.tokenSyEscrow.equals(marketThree.tokenSyEscrow)).toBe(true);
    expect(ctx.tradePtAccounts.tokenFeeTreasuryPt.equals(marketThree.tokenFeeTreasuryPt)).toBe(true);
    expect(ctx.sy.mint.equals(marketThree.mintSy)).toBe(true);
    expect(ctx.sy.decimals).toBe(9);
    expect(ctx.pt.decimals).toBe(6);
    expect(conn.getAddressLookupTable).toHaveBeenCalledWith(marketThree.addressLookupTable);
  });

  it("throws when a CPI account references an ALT index that is out of range", async () => {
    hoisted.marketThree = {
      ...marketThree,
      cpiAccounts: {
        getSyState: [{ altIndex: 99, isSigner: false, isWritable: false }],
        getPositionState: [],
        depositSy: [],
        withdrawSy: [],
      },
    };
    await expect(
      resolveExponentClmmTradePtContext({
        connection: makeConnection(),
        owner,
        market: marketThree.selfAddress,
      })
    ).rejects.toThrow(/out of range/);
  });
});

// ============================================================================
// strip — instruction encoding + resolver
// ============================================================================

function makeStripAccounts(overrides: Partial<ExponentStripAccounts> = {}): ExponentStripAccounts {
  return {
    depositor: pk(1),
    authority: pk(2),
    vault: pk(3),
    sySrc: pk(4),
    escrowSy: pk(5),
    ytDst: pk(6),
    ptDst: pk(7),
    mintYt: pk(8),
    mintPt: pk(9),
    syProgram: pk(10),
    addressLookupTable: pk(11),
    yieldPosition: pk(12),
    remainingAccounts: [
      { pubkey: pk(20), isSigner: false, isWritable: true },
      { pubkey: pk(21), isSigner: false, isWritable: true },
    ],
    ...overrides,
  };
}

describe("makeExponentStripIx", () => {
  it("encodes discriminator [4] + u64 LE amount", () => {
    const ix = makeExponentStripIx(makeStripAccounts(), 1_000_000_000n);
    expect(ix.programId.equals(EXPONENT_CORE_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(1 + 8);
    expect(ix.data[0]).toBe(4);
    expect(ix.data.readBigUInt64LE(1)).toBe(1_000_000_000n);
  });

  it("lays out the 15 fixed accounts (IDL order), then the remaining accounts", () => {
    const a = makeStripAccounts();
    const ix = makeExponentStripIx(a, 1n);
    expect(ix.keys.length).toBe(17); // 15 fixed + 2 remaining

    expect(ix.keys[0]).toMatchObject({ pubkey: a.depositor, isSigner: true, isWritable: true });
    expect(ix.keys[3].pubkey.equals(a.sySrc)).toBe(true); // SY source
    expect(ix.keys[5].pubkey.equals(a.ytDst)).toBe(true); // YT dest
    expect(ix.keys[6].pubkey.equals(a.ptDst)).toBe(true); // PT dest
    expect(ix.keys[14].pubkey.equals(EXPONENT_CORE_PROGRAM_ID)).toBe(true);
    expect(ix.keys[15]).toMatchObject({ pubkey: pk(20), isWritable: true });
    // only the depositor signs
    expect(ix.keys.filter((k) => k.isSigner).length).toBe(1);
  });

  it("omits remaining accounts when none are given", () => {
    const ix = makeExponentStripIx(makeStripAccounts({ remainingAccounts: [] }), 1n);
    expect(ix.keys.length).toBe(15);
  });
});

describe("resolveExponentStripContext", () => {
  const owner = pk(100);
  const altAddresses = [pk(50), pk(51), pk(52)];
  const vault = {
    authority: pk(2),
    syProgram: pk(10),
    mintSy: pk(40),
    mintYt: pk(8),
    mintPt: pk(9),
    escrowSy: pk(5),
    yieldPosition: pk(12),
    addressLookupTable: pk(11),
    cpiAccounts: {
      getSyState: [],
      depositSy: [
        { altIndex: 0, isSigner: false, isWritable: true },
        { altIndex: 2, isSigner: true, isWritable: false }, // is_signer must be forced false
      ],
      withdrawSy: [],
    },
    syForPt: 0n,
    ptSupply: 0n,
    lastSeenSyExchangeRate: new BigNumber("1.0875"),
    finalSyExchangeRate: new BigNumber(0),
    status: 0,
  };

  const connection = {
    getAddressLookupTable: vi.fn(async () => ({ value: { state: { addresses: altAddresses } } })),
  } as any;

  it("resolves depositSy remaining accounts from the vault ALT, forcing is_signer false", async () => {
    hoisted.vault = vault;
    const ctx = await resolveExponentStripContext({ connection, owner, vault: pk(3) });
    const rem = ctx.stripAccounts.remainingAccounts!;
    expect(rem).toHaveLength(2);
    expect(rem[0]).toMatchObject({ pubkey: altAddresses[0], isSigner: false, isWritable: true });
    // the context flag was is_signer:true → forced to false (PDA the inner CPI signs)
    expect(rem[1]).toMatchObject({ pubkey: altAddresses[2], isSigner: false, isWritable: false });
  });

  it("sizes minted PT from the last-seen SY exchange rate", async () => {
    hoisted.vault = vault;
    const ctx = await resolveExponentStripContext({ connection, owner, vault: pk(3) });
    expect(ctx.syExchangeRate).toBeCloseTo(1.0875);
    // floor(1_000_000_000 × 1.0875) = 1_087_500_000
    expect(ctx.computeStrippedPtNative(1_000_000_000n)).toBe(1_087_500_000n);
  });
});

// ============================================================================
// wrapper_merge — instruction encoding + resolver
// ============================================================================

function makeWrapperMergeAccounts(
  overrides: Partial<ExponentWrapperMergeAccounts> = {}
): ExponentWrapperMergeAccounts {
  return {
    owner: pk(1),
    syAta: pk(2),
    vault: pk(3),
    escrowSy: pk(4),
    ytAta: pk(5),
    ptAta: pk(6),
    mintYt: pk(7),
    mintPt: pk(8),
    authority: pk(9),
    addressLookupTable: pk(10),
    yieldPosition: pk(11),
    syProgram: pk(12),
    // redeem[0] is the owner (keeps its signer flag), then non-signer redeem + cpi accounts
    remainingAccounts: [
      { pubkey: pk(1), isSigner: true, isWritable: true },
      { pubkey: pk(20), isSigner: false, isWritable: true },
      { pubkey: pk(21), isSigner: false, isWritable: false },
    ],
    redeemSyAccountsUntil: 2,
    ...overrides,
  };
}

describe("makeExponentWrapperMergeIx", () => {
  it("encodes discriminator [39] + u64 amount_py + u8 redeem_sy_accounts_until", () => {
    const ix = makeExponentWrapperMergeIx(makeWrapperMergeAccounts(), {
      amountPyNative: 1_000_000_000n,
      redeemSyAccountsUntil: 2,
    });
    expect(ix.programId.equals(EXPONENT_CORE_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBe(1 + 9);
    expect(ix.data[0]).toBe(39);
    expect(ix.data.readBigUInt64LE(1)).toBe(1_000_000_000n);
    expect(ix.data.readUInt8(9)).toBe(2);
  });

  it("lays out the 16 fixed accounts (IDL order), then the assembled remaining accounts", () => {
    const a = makeWrapperMergeAccounts();
    const ix = makeExponentWrapperMergeIx(a, { amountPyNative: 1n, redeemSyAccountsUntil: 2 });
    expect(ix.keys.length).toBe(16 + 3);

    expect(ix.keys[0]).toMatchObject({ pubkey: a.owner, isSigner: true, isWritable: true });
    expect(ix.keys[1].pubkey.equals(a.syAta)).toBe(true);
    expect(ix.keys[2].pubkey.equals(a.vault)).toBe(true);
    expect(ix.keys[9].pubkey.equals(a.addressLookupTable)).toBe(true);
    expect(ix.keys[9].isWritable).toBe(false);
    expect(ix.keys[11].pubkey.equals(a.yieldPosition)).toBe(true);
    expect(ix.keys[12].pubkey.equals(a.syProgram)).toBe(true);
    expect(ix.keys[13].pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(ix.keys[15].pubkey.equals(EXPONENT_CORE_PROGRAM_ID)).toBe(true);
    // remaining accounts come strictly after the 16 fixed ones, flags preserved (owner stays signer)
    expect(ix.keys[16]).toMatchObject({ pubkey: pk(1), isSigner: true, isWritable: true });
    expect(ix.keys[17]).toMatchObject({ pubkey: pk(20), isWritable: true });
    expect(ix.keys[18]).toMatchObject({ pubkey: pk(21), isWritable: false });
  });
});

describe("resolveExponentWrapperMergeContext", () => {
  const owner = pk(100);
  // get_sy_state = [syState, mintSy, tokenSyEscrow, stakePool]
  const altAddresses = [pk(200), pk(41), pk(202), pk(203), pk(204)];
  const vault = {
    authority: pk(11),
    syProgram: pk(18),
    mintSy: pk(41),
    mintYt: pk(16),
    mintPt: pk(17),
    escrowSy: pk(13),
    yieldPosition: pk(20),
    addressLookupTable: pk(19),
    cpiAccounts: {
      getSyState: [
        { altIndex: 0, isSigner: false, isWritable: true },
        { altIndex: 1, isSigner: false, isWritable: false },
        { altIndex: 2, isSigner: false, isWritable: true },
        { altIndex: 3, isSigner: false, isWritable: true },
      ],
      depositSy: [],
      withdrawSy: [
        { altIndex: 0, isSigner: false, isWritable: true },
        { altIndex: 4, isSigner: false, isWritable: false },
      ],
    },
    syForPt: 919n,
    ptSupply: 1000n,
    lastSeenSyExchangeRate: new BigNumber("1.0875"),
    finalSyExchangeRate: new BigNumber(0),
    status: 0,
  };

  // Minimal SPL StakePool buffer: pubkeys at the documented offsets.
  const stakePoolData = Buffer.alloc(260);
  pk(98).toBuffer().copy(stakePoolData, 98); // validatorList
  pk(130).toBuffer().copy(stakePoolData, 130); // reserveStake
  pk(42).toBuffer().copy(stakePoolData, 162); // poolMint
  pk(194).toBuffer().copy(stakePoolData, 194); // managerFeeAccount

  const connection = {
    getAddressLookupTable: async () => ({ value: { state: { addresses: altAddresses } } }),
    getAccountInfo: async () => ({ owner: pk(90), data: stakePoolData }),
  } as any;

  it("assembles wrapper_merge accounts (redeem owner keeps signer) + the stake-pool refresh", async () => {
    hoisted.vault = vault;
    const ctx = await resolveExponentWrapperMergeContext({
      connection,
      owner,
      vault: pk(3),
      baseMint: pk(42),
    });

    const wm = ctx.wrapperMergeAccounts;
    expect(wm.redeemSyAccountsUntil).toBe(10);
    // redeem accounts: [owner(signer), syState, baseAta, baseEscrow, syAta, mintSy, mintBase, tokenProg, baseTokenProg, stakePool]
    expect(wm.remainingAccounts[0]).toMatchObject({ pubkey: owner, isSigner: true });
    expect(wm.remainingAccounts[1].pubkey.equals(altAddresses[0])).toBe(true); // syState = get_sy_state[0]
    expect(wm.remainingAccounts[5].pubkey.equals(vault.mintSy)).toBe(true);
    expect(wm.remainingAccounts[9].pubkey.equals(altAddresses[3])).toBe(true); // stakePool = get_sy_state[3]
    // cpi remaining (deduped withdraw_sy ++ get_sy_state) follow the 10 redeem accounts
    expect(wm.remainingAccounts.length).toBeGreaterThan(10);
    // no phantom signer beyond the owner
    expect(wm.remainingAccounts.filter((m) => m.isSigner).length).toBe(1);
  });

  it("builds the stake-pool refresh pre-ix on the pool's owning program", async () => {
    hoisted.vault = vault;
    const ctx = await resolveExponentWrapperMergeContext({
      connection,
      owner,
      vault: pk(3),
      baseMint: pk(42),
    });
    expect(ctx.preInstructions).toHaveLength(1);
    expect(ctx.preInstructions[0].programId.equals(pk(90))).toBe(true);
    expect(ctx.preInstructions[0].data[0]).toBe(7); // UpdateStakePoolBalance
    expect(ctx.baseToken.mint.equals(pk(42))).toBe(true);
  });

  it("sizes the redeemed base as the 1:1 merge SY output: floor(pt × sy_for_pt / pt_supply)", async () => {
    hoisted.vault = vault;
    const ctx = await resolveExponentWrapperMergeContext({
      connection,
      owner,
      vault: pk(3),
      baseMint: pk(42),
    });
    // SY→base unwrap is 1:1 in amount → floor(1000 × 919/1000) = 919
    expect(ctx.computeRedeemedBaseNative(1000n)).toBe(919n);
  });
});
