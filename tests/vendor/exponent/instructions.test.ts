import { describe, it, expect, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { BigNumber } from "bignumber.js";

import {
  exponentBuyPtArgs,
  makeExponentTradePtIx,
  makeExponentStripIx,
  EXPONENT_CORE_PROGRAM_ID,
  type ExponentTradePtAccounts,
  type ExponentStripAccounts,
} from "~/vendor/exponent";

// The resolvers pull the MarketTwo/Vault decode from deserialize.utils; mock that single
// boundary so `resolveExponentTradePtContext` / `resolveExponentStripContext` run without RPC.
const hoisted = vi.hoisted(() => ({ market: undefined as any, vault: undefined as any }));

vi.mock("~/vendor/exponent/utils/deserialize.utils", () => ({
  fetchExponentMarketTwo: async () => hoisted.market,
  fetchExponentVault: async () => hoisted.vault,
  getMintDecimals: async (_conn: unknown, mint: PublicKey) =>
    hoisted.market && mint.equals(hoisted.market.mintSy) ? 9 : 6,
}));

import {
  resolveExponentTradePtContext,
  resolveExponentStripContext,
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
