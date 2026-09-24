import { describe, it, expect, vi } from "vitest";
import { getAddressDecoder, type Address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import BigNumber from "bignumber.js";

import { TransactionBuildingErrorCode } from "~/errors";
import { USDC_MINT, USDT_MINT, WSOL_MINT } from "~/constants";
import { AssetTag, OperationalState, BankType } from "~/services/bank/types";
import {
  DEFAULT_BRIDGE_MINTS,
  resolveTokenProgramForMint,
  selectSwapBridges,
  tryBridgeCandidates,
} from "~/services/account/utils/bridge-routing.utils";
import type { BridgedTxResult, MarginfiAccountType } from "~/services/account";

const uniqueAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));

/** A Kit rpc stub whose `getAccountInfo` returns `owner` (or nothing when undefined). */
function rpcWithOwner(owner?: Address) {
  const getAccountInfo = vi.fn(() => ({
    send: async () => ({
      value: owner && {
        data: ["", "base64"],
        executable: false,
        lamports: 0n,
        owner,
        space: 0n,
      },
    }),
  }));
  return { rpc: { getAccountInfo } as never, getAccountInfo };
}

// ----------------------------------------------------------------------------
// Fixtures (minimal casts — these helpers only read a few fields)
// ----------------------------------------------------------------------------

function bank(mint: Address): BankType {
  return {
    address: uniqueAddress(),
    mint,
    mintDecimals: 6,
    tokenSymbol: mint.slice(0, 4),
    config: {
      assetTag: AssetTag.DEFAULT,
      operationalState: OperationalState.Operational,
      borrowLimit: new BigNumber(100),
    },
  } as unknown as BankType;
}

function accountWith(
  balances: Array<{ bankPk: Address; assetShares: number; liabilityShares: number }>
): MarginfiAccountType {
  return {
    balances: balances.map((b) => ({
      active: true,
      bankPk: b.bankPk,
      assetShares: new BigNumber(b.assetShares),
      liabilityShares: new BigNumber(b.liabilityShares),
    })),
  } as unknown as MarginfiAccountType;
}

const sourceBank = bank(uniqueAddress());
const destinationBank = bank(uniqueAddress());
const usdcBank = bank(USDC_MINT);
const wsolBank = bank(WSOL_MINT);
const usdtBank = bank(USDT_MINT);

const bankMap = new Map(
  [sourceBank, destinationBank, usdcBank, wsolBank, usdtBank].map((b) => [b.address, b])
);

// ----------------------------------------------------------------------------
// selectSwapBridges
// ----------------------------------------------------------------------------

describe("selectSwapBridges", () => {
  it("defaults to DEFAULT_BRIDGE_MINTS in priority order", () => {
    const { usableBridgeBanks, conflictingBridgeBanks } = selectSwapBridges({
      sourceMint: sourceBank.mint,
      destinationMint: destinationBank.mint,
      bankMap,
      marginfiAccount: accountWith([]),
      bridgeTokenSide: "borrow",
    });
    expect(usableBridgeBanks.map((b) => b.mint)).toEqual(DEFAULT_BRIDGE_MINTS);
    expect(conflictingBridgeBanks).toHaveLength(0);
  });

  it("always skips the source and destination mints", () => {
    const { usableBridgeBanks } = selectSwapBridges({
      sourceMint: USDC_MINT,
      destinationMint: WSOL_MINT,
      bankMap,
      marginfiAccount: accountWith([]),
      bridgeTokenSide: "borrow",
    });
    expect(usableBridgeBanks.map((b) => b.mint)).toEqual([USDT_MINT]);
  });

  it("respects a caller-supplied ordering (product policy)", () => {
    const { usableBridgeBanks } = selectSwapBridges({
      sourceMint: sourceBank.mint,
      destinationMint: destinationBank.mint,
      bankMap,
      marginfiAccount: accountWith([]),
      bridgeTokenSide: "borrow",
      bridgeCandidateMints: [WSOL_MINT, USDC_MINT],
    });
    expect(usableBridgeBanks.map((b) => b.mint)).toEqual([WSOL_MINT, USDC_MINT]);
  });
});

// ----------------------------------------------------------------------------
// tryBridgeCandidates
// ----------------------------------------------------------------------------

describe("tryBridgeCandidates", () => {
  const bundle = (bridge: BankType): BridgedTxResult => ({
    transactions: [],
    actionTxIndex: 0,
    quoteResponse: undefined,
    bridgeMint: bridge.mint,
    mustBeAtomicBundle: true,
  });

  it("returns the first candidate that composes, in priority order", async () => {
    const buildBundleThroughBridge = vi
      .fn<(b: BankType) => Promise<BridgedTxResult | null>>()
      .mockResolvedValueOnce(null) // usdc: didn't fit
      .mockImplementationOnce(async (b) => bundle(b)); // wsol: works
    const result = await tryBridgeCandidates({
      usableBridgeBanks: [usdcBank, wsolBank, usdtBank],
      conflictingBridgeBanks: [],
      bridgeTokenSide: "borrow",
      buildBundleThroughBridge,
    });
    expect(result?.bridgeMint).toBe(WSOL_MINT);
    expect(buildBundleThroughBridge).toHaveBeenCalledTimes(2); // usdt never tried
  });

  it("treats a throwing bundle builder as 'try the next candidate'", async () => {
    const buildBundleThroughBridge = vi
      .fn<(b: BankType) => Promise<BridgedTxResult | null>>()
      .mockRejectedValueOnce(new Error("leg build failed"))
      .mockImplementationOnce(async (b) => bundle(b));
    const result = await tryBridgeCandidates({
      usableBridgeBanks: [usdcBank, wsolBank],
      conflictingBridgeBanks: [],
      bridgeTokenSide: "borrow",
      buildBundleThroughBridge,
    });
    expect(result?.bridgeMint).toBe(WSOL_MINT);
  });

  it("propagates abort errors immediately", async () => {
    const buildBundleThroughBridge = vi
      .fn<(b: BankType) => Promise<BridgedTxResult | null>>()
      .mockRejectedValueOnce(new DOMException("Operation was aborted", "AbortError"));
    await expect(
      tryBridgeCandidates({
        usableBridgeBanks: [usdcBank, wsolBank],
        conflictingBridgeBanks: [],
        bridgeTokenSide: "borrow",
        buildBundleThroughBridge,
      })
    ).rejects.toThrow("Operation was aborted");
    expect(buildBundleThroughBridge).toHaveBeenCalledTimes(1);
  });

  it("throws before attempting when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const buildBundleThroughBridge = vi.fn<(b: BankType) => Promise<BridgedTxResult | null>>();
    await expect(
      tryBridgeCandidates({
        usableBridgeBanks: [usdcBank],
        conflictingBridgeBanks: [],
        bridgeTokenSide: "borrow",
        abortSignal: controller.signal,
        buildBundleThroughBridge,
      })
    ).rejects.toThrow("Operation was aborted");
    expect(buildBundleThroughBridge).not.toHaveBeenCalled();
  });

  it("throws BRIDGE_CONFLICT when no candidate is usable but all were conflict-blocked", async () => {
    const buildBundleThroughBridge = vi.fn<(b: BankType) => Promise<BridgedTxResult | null>>();
    await expect(
      tryBridgeCandidates({
        usableBridgeBanks: [],
        conflictingBridgeBanks: [usdcBank, wsolBank],
        bridgeTokenSide: "deposit",
        buildBundleThroughBridge,
      })
    ).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.BRIDGE_CONFLICT,
      details: { bridgeTokenSide: "deposit" },
    });
  });

  it("resolves null when candidates exist but none compose (caller rethrows the direct error)", async () => {
    const buildBundleThroughBridge = vi
      .fn<(b: BankType) => Promise<BridgedTxResult | null>>()
      .mockResolvedValue(null);
    const result = await tryBridgeCandidates({
      usableBridgeBanks: [usdcBank, wsolBank],
      conflictingBridgeBanks: [usdtBank], // conflicts do NOT trigger the error when usable candidates existed
      bridgeTokenSide: "borrow",
      buildBundleThroughBridge,
    });
    expect(result).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// resolveTokenProgramForMint
// ----------------------------------------------------------------------------

describe("resolveTokenProgramForMint", () => {
  const mint = uniqueAddress();

  it("uses the caller-supplied map without touching the rpc", async () => {
    const known = uniqueAddress();
    const { rpc, getAccountInfo } = rpcWithOwner(uniqueAddress());
    const cache = new Map([[mint, known]]);
    expect(await resolveTokenProgramForMint(mint, rpc, cache)).toBe(known);
    expect(getAccountInfo).not.toHaveBeenCalled();
  });

  it("falls back to the mint account's owner and caches it", async () => {
    const owner = uniqueAddress();
    const { rpc, getAccountInfo } = rpcWithOwner(owner);
    const cache = new Map<string, Address>();
    expect(await resolveTokenProgramForMint(mint, rpc, cache)).toBe(owner);
    expect(await resolveTokenProgramForMint(mint, rpc, cache)).toBe(owner);
    expect(getAccountInfo).toHaveBeenCalledTimes(1); // second call served from the cache
  });

  it("defaults to the classic token program when the mint account is missing", async () => {
    const { rpc } = rpcWithOwner();
    expect(await resolveTokenProgramForMint(mint, rpc, new Map())).toBe(TOKEN_PROGRAM_ADDRESS);
  });
});
