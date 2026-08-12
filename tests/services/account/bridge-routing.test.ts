import { describe, it, expect, vi } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { TransactionBuildingErrorCode } from "~/errors";
import { USDC_MINT, USDT_MINT, WSOL_MINT } from "~/constants";
import { AssetTag, OperationalState, BankType } from "~/services/bank";
import { TOKEN_PROGRAM_ID } from "~/vendor/spl";
import {
  DEFAULT_BRIDGE_MINTS,
  resolveTokenProgramForMint,
  selectSwapBridges,
  tryBridgeCandidates,
} from "~/services/account/utils/bridge-routing.utils";
import type { BridgedTxResult, MarginfiAccountType } from "~/services/account";

// ----------------------------------------------------------------------------
// Fixtures (minimal casts — these helpers only read a few fields)
// ----------------------------------------------------------------------------

function bank(mint: PublicKey): BankType {
  return {
    address: Keypair.generate().publicKey,
    mint,
    mintDecimals: 6,
    tokenSymbol: mint.toBase58().slice(0, 4),
    config: {
      assetTag: AssetTag.DEFAULT,
      operationalState: OperationalState.Operational,
      borrowLimit: new BigNumber(100),
    },
  } as unknown as BankType;
}

function accountWith(
  balances: Array<{ bankPk: PublicKey; assetShares: number; liabilityShares: number }>
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

const sourceBank = bank(Keypair.generate().publicKey);
const destinationBank = bank(Keypair.generate().publicKey);
const usdcBank = bank(USDC_MINT);
const wsolBank = bank(WSOL_MINT);
const usdtBank = bank(USDT_MINT);

const bankMap = new Map(
  [sourceBank, destinationBank, usdcBank, wsolBank, usdtBank].map((b) => [b.address.toBase58(), b])
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
    expect(usableBridgeBanks.map((b) => b.mint.toBase58())).toEqual(
      DEFAULT_BRIDGE_MINTS.map((m) => m.toBase58())
    );
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
    expect(usableBridgeBanks.map((b) => b.mint.toBase58())).toEqual([USDT_MINT.toBase58()]);
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
    expect(usableBridgeBanks.map((b) => b.mint.toBase58())).toEqual([
      WSOL_MINT.toBase58(),
      USDC_MINT.toBase58(),
    ]);
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
    expect(result?.bridgeMint?.equals(WSOL_MINT)).toBe(true);
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
    expect(result?.bridgeMint?.equals(WSOL_MINT)).toBe(true);
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
  const mint = Keypair.generate().publicKey;

  it("uses the caller-supplied map without touching the connection", async () => {
    const known = Keypair.generate().publicKey;
    const connection = { getAccountInfo: vi.fn() } as unknown as Connection;
    const cache = new Map([[mint.toBase58(), known]]);
    expect((await resolveTokenProgramForMint(mint, connection, cache)).equals(known)).toBe(true);
    expect(connection.getAccountInfo).not.toHaveBeenCalled();
  });

  it("falls back to the mint account's owner and caches it", async () => {
    const owner = Keypair.generate().publicKey;
    const getAccountInfo = vi.fn().mockResolvedValue({ owner });
    const connection = { getAccountInfo } as unknown as Connection;
    const cache = new Map<string, PublicKey>();
    expect((await resolveTokenProgramForMint(mint, connection, cache)).equals(owner)).toBe(true);
    expect((await resolveTokenProgramForMint(mint, connection, cache)).equals(owner)).toBe(true);
    expect(getAccountInfo).toHaveBeenCalledTimes(1); // second call served from the cache
  });

  it("defaults to the classic token program when the mint account is missing", async () => {
    const connection = {
      getAccountInfo: vi.fn().mockResolvedValue(null),
    } as unknown as Connection;
    const program = await resolveTokenProgramForMint(mint, connection, new Map());
    expect(program.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });
});
