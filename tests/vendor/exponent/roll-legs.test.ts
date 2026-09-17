import {
  createNoopSigner,
  getAddressDecoder,
  isSignerRole,
  isWritableRole,
  type Address,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";

import { SwapDirection } from "~/generated/exponent-clmm";

// Wire format recorded from the web3.js resolvers + builders these replaced; never update with `-u`.

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const cpi = (altIndex: number, isWritable: boolean) => ({ altIndex, isSigner: false, isWritable });

const vault = {
  authority: key(10),
  syProgram: key(11),
  mintSy: key(12),
  mintYt: key(13),
  mintPt: key(14),
  escrowSy: key(15),
  yieldPosition: key(16),
  addressLookupTable: key(17),
  cpiAccounts: {
    getSyState: [cpi(2, false), cpi(0, true)],
    depositSy: [],
    withdrawSy: [cpi(1, true)],
  },
  syForPt: 990n,
  ptSupply: 1000n,
};
const pool = {
  selfAddress: key(30),
  mintPt: key(31),
  mintSy: key(12),
  ticks: key(33),
  tokenPtEscrow: key(34),
  tokenSyEscrow: key(35),
  tokenFeeTreasurySy: key(36),
  tokenFeeTreasuryPt: key(37),
  addressLookupTable: key(38),
  syProgram: key(11),
  cpiSyAccounts: {
    getSyState: [cpi(2, false)],
    getPositionState: [cpi(3, false)],
    depositSy: [cpi(0, true)],
    withdrawSy: [cpi(2, true)],
  },
};
const lookupTableAddresses = [key(50), key(51), key(52), key(53)];

vi.mock("~/generated/exponent-core", async (importActual) => ({
  ...(await importActual<object>()),
  fetchVault: async () => ({ data: vault }),
}));
vi.mock("~/generated/exponent-clmm", async (importActual) => ({
  ...(await importActual<object>()),
  fetchMarketThree: async () => ({ data: pool }),
}));
vi.mock("@solana/kit", async (importActual) => ({
  ...(await importActual<object>()),
  fetchAddressesForLookupTables: async ([lookupTable]: Address[]) => ({
    [lookupTable]: lookupTableAddresses,
  }),
  fetchEncodedAccount: async (_: unknown, account: Address) => ({
    address: account,
    exists: true,
    data: new Uint8Array(82).fill(9),
  }),
}));

import {
  makeExponentClmmTradePtIx,
  makeExponentMergeIx,
  resolveExponentClmmTradePtContext,
  resolveExponentMergeContext,
} from "~/vendor/exponent";

const rpc = {} as Parameters<typeof resolveExponentMergeContext>[0]["rpc"];
const owner = key(1);

const toWire = (ix: Instruction) => ({
  programId: ix.programAddress,
  keys: (ix.accounts ?? []).map((a) => [a.address, isSignerRole(a.role), isWritableRole(a.role)]),
  data: Buffer.from(ix.data ?? []).toString("hex"),
});

describe("exponent roll legs wire format", () => {
  it("merge", async () => {
    const ctx = await resolveExponentMergeContext({ rpc, owner, vault: key(20) });
    const ix = await makeExponentMergeIx(
      { ...ctx.mergeInput, owner: createNoopSigner(owner), amount: 777n },
      ctx.remainingAccounts
    );
    expect(toWire(ix)).toMatchSnapshot();
    expect(ctx.computeRedeemedAmountNative(1234n)).toBe(1221n);
    expect(ctx.underlying.decimals).toBe(9);
  });

  it.each([
    ["min out", 1000n],
    ["no min out", null],
  ])("clmm trade_pt (%s)", async (_, minPtOut) => {
    const ctx = await resolveExponentClmmTradePtContext({ rpc, owner, market: key(30) });
    const ix = await makeExponentClmmTradePtIx(
      {
        ...ctx.tradePtInput,
        trader: createNoopSigner(owner),
        amountIn: 1500n,
        swapDirection: SwapDirection.SyToPt,
        amountOutConstraint: minPtOut,
        priceSpotLimit: null,
      },
      ctx.remainingAccounts
    );
    expect(toWire(ix)).toMatchSnapshot();
  });

  it("rejects a CPI index outside the lookup table", async () => {
    pool.cpiSyAccounts.getSyState = [cpi(99, false)];
    await expect(
      resolveExponentClmmTradePtContext({ rpc, owner, market: key(30) })
    ).rejects.toThrow(/out of range/);
  });
});
