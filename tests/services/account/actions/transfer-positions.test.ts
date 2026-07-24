import { describe, it, expect } from "vitest";
import { BigNumber } from "bignumber.js";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { TOKEN_PROGRAM_ID } from "~/vendor/spl";

import {
  planTransferBundles,
  buildCollateralLegIxs,
  BuildContext,
  ClassifiedPosition,
} from "~/services/account/actions/transfer-positions";
import { TransferPositionPlanItem } from "~/services/account/types";
import { MarginfiAccountType } from "~/services/account/types/account.types";
import { AssetTag, BankType } from "~/services/bank";
import { KaminoReserve } from "~/vendor/klend";
import { BankIntegrationMetadataMap, MarginfiProgram } from "~/types";
import { TransactionBuildingError, TransactionBuildingErrorCode } from "~/errors";

function pos(side: "collateral" | "debt", usd: number): TransferPositionPlanItem {
  return {
    bankAddress: PublicKey.unique(),
    side,
    uiAmount: new BigNumber(usd),
    initUsdValue: new BigNumber(usd),
  };
}

/** A `fitsInTx` that caps the number of positions per transaction. */
const maxPerTx = (n: number) => (candidate: TransferPositionPlanItem[]) => candidate.length <= n;

const EPS = new BigNumber("0.01");

describe("planTransferBundles", () => {
  it("splits a balanced selection into bundles that respect the size cap", () => {
    const positions = [pos("collateral", 100), pos("debt", 40), pos("collateral", 80), pos("debt", 30)];
    const bundles = planTransferBundles({
      positions,
      marginUsd: new BigNumber(200),
      epsilonUsd: EPS,
      fitsInTx: maxPerTx(2),
    });

    expect(bundles.length).toBe(2);
    for (const b of bundles) expect(b.positions.length).toBeLessThanOrEqual(2);
    // Every position is placed exactly once.
    const placed = bundles.flatMap((b) => b.positions.map((p) => p.bankAddress.toBase58()));
    expect(new Set(placed).size).toBe(positions.length);
  });

  it("keeps a debt larger than the source margin in the same tx as its offsetting collateral", () => {
    // Margin is only 50 but the debt is 90; the two must ride together so W dips only inside the tx.
    const positions = [pos("collateral", 100), pos("debt", 90)];
    const bundles = planTransferBundles({
      positions,
      marginUsd: new BigNumber(50),
      epsilonUsd: EPS,
      fitsInTx: maxPerTx(2),
    });

    expect(bundles.length).toBe(1);
    expect(bundles[0].positions.length).toBe(2);
    expect(bundles[0].cumulativeNetMovedUsd.toString()).toBe("10");
  });

  it("relaxes the final boundary when the source account empties (W_total == M)", () => {
    const positions = [pos("collateral", 100), pos("debt", 60)];
    const bundles = planTransferBundles({
      positions,
      marginUsd: new BigNumber(40), // == 100 - 60
      epsilonUsd: EPS,
      fitsInTx: maxPerTx(2),
    });

    expect(bundles.length).toBe(1);
    expect(bundles[0].cumulativeNetMovedUsd.toString()).toBe("40");
  });

  it("throws UNSPLITTABLE when a thin margin forces an unhealthy intermediate boundary", () => {
    // Only one position fits per tx, but leaving the collateral's counterpart for a later tx
    // pushes W above the source's margin at the first boundary.
    const positions = [pos("collateral", 100), pos("debt", 90)];
    try {
      planTransferBundles({
        positions,
        marginUsd: new BigNumber(50),
        epsilonUsd: EPS,
        fitsInTx: maxPerTx(1),
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TransactionBuildingError);
      expect((e as TransactionBuildingError).code).toBe(
        TransactionBuildingErrorCode.TRANSFER_POSITIONS_UNSPLITTABLE
      );
    }
  });

  it("throws UNSPLITTABLE when a single position does not fit one tx", () => {
    const positions = [pos("collateral", 100)];
    try {
      planTransferBundles({
        positions,
        marginUsd: new BigNumber(200),
        epsilonUsd: EPS,
        fitsInTx: () => false,
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TransactionBuildingError);
      expect((e as TransactionBuildingError).code).toBe(
        TransactionBuildingErrorCode.TRANSFER_POSITIONS_UNSPLITTABLE
      );
    }
  });

  it("places every position when the whole selection fits one tx", () => {
    const positions = [pos("collateral", 100), pos("debt", 30), pos("collateral", 50)];
    const bundles = planTransferBundles({
      positions,
      marginUsd: new BigNumber(500),
      epsilonUsd: EPS,
      fitsInTx: maxPerTx(10),
    });
    expect(bundles.length).toBe(1);
    expect(bundles[0].positions.length).toBe(3);
  });
});

// --------------------------------------------------------------------------------------
// Integration collateral-leg dispatch (Kamino sync path; JupLend withdraw is async-only so its
// success path needs an IDL-backed program and is covered by an on-chain smoke test instead).
// --------------------------------------------------------------------------------------

const pk = (seed: number) =>
  new PublicKey(Buffer.from(Array.from({ length: 32 }, (_, i) => (seed + i) % 256)));

const KAMINO_BANK_PK = pk(20);
const PROGRAM_PK = pk(99);
const ACCOUNT_B_PK = pk(40);

/** A minimal on-chain-shaped Kamino reserve (same shape the metadata map carries). */
const reserve: KaminoReserve = {
  lendingMarket: pk(1),
  farmCollateral: pk(2),
  liquidity: {
    mintPubkey: pk(3),
    supplyVault: pk(4),
    mintDecimals: new BN(6),
    availableAmount: new BN("123456789"),
    borrowedAmountSf: new BN("987654321000000000"),
    accumulatedProtocolFeesSf: new BN("111"),
    accumulatedReferrerFeesSf: new BN("222"),
    pendingReferrerFeesSf: new BN("333"),
  },
  collateral: { mintPubkey: pk(5), mintTotalSupply: new BN("55555555"), supplyVault: pk(6) },
  config: {
    protocolTakeRatePct: 15,
    hostFixedInterestRateBps: 25,
    depositLimit: new BN("10000000000000000"),
    borrowLimit: new BN("9000000000000000"),
    borrowRateCurve: { points: [{ utilizationRateBps: 0, borrowRateBps: 100 }] },
    tokenInfo: {
      scopeConfiguration: { priceFeed: pk(7) },
      switchboardConfiguration: { priceAggregator: pk(8), twapAggregator: pk(9) },
      pythConfiguration: { price: pk(10) },
    },
  },
} as unknown as KaminoReserve;

const kaminoBank = {
  address: KAMINO_BANK_PK,
  mint: pk(21),
  mintDecimals: 6,
  tokenSymbol: "kTKN",
  config: { assetTag: AssetTag.KAMINO },
  kaminoIntegrationAccounts: { kaminoReserve: pk(22), kaminoObligation: pk(23) },
} as unknown as BankType;

function baseCtx(overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    program: { programId: PROGRAM_PK } as unknown as MarginfiProgram,
    accountA: {
      address: pk(30),
      authority: pk(31),
      group: pk(32),
      balances: [],
    } as unknown as MarginfiAccountType,
    accountB: { address: ACCOUNT_B_PK, group: pk(32) } as unknown as MarginfiAccountType,
    bankMap: new Map(),
    bankMetadataMap: {
      [KAMINO_BANK_PK.toBase58()]: { kaminoStates: { reserveState: reserve } },
    } as unknown as BankIntegrationMetadataMap,
    assetShareValueMultiplierByBank: new Map([[KAMINO_BANK_PK.toBase58(), new BigNumber(2)]]),
    borrowPaddingBps: 10,
    groupRateLimiterEnabled: false,
    destPreexistingBanks: [],
    ...overrides,
  };
}

const kaminoPosition: ClassifiedPosition = {
  bankAddress: KAMINO_BANK_PK,
  side: "collateral",
  uiAmount: new BigNumber(100),
  initUsdValue: new BigNumber(100),
  bank: kaminoBank,
  tokenProgram: TOKEN_PROGRAM_ID,
};

describe("buildCollateralLegIxs (integration dispatch)", () => {
  it("routes a KAMINO position to the Kamino builders and locks its reserve/obligation accounts", async () => {
    const { withdrawIxs, depositIxs } = await buildCollateralLegIxs(baseCtx(), kaminoPosition, true, []);

    expect(withdrawIxs.length).toBeGreaterThan(0);
    expect(depositIxs.length).toBeGreaterThan(0);

    // Every emitted instruction targets the marginfi program (the Kamino CPI accounts ride as keys).
    for (const ix of [...withdrawIxs, ...depositIxs]) {
      expect(ix.programId.toBase58()).toBe(PROGRAM_PK.toBase58());
    }

    // The Kamino reserve/obligation plumbing pulled from bankMetadataMap must appear in the keys —
    // proof the dispatch chose the Kamino builder rather than the plain lending ix.
    const keys = [...withdrawIxs, ...depositIxs].flatMap((ix) =>
      ix.keys.map((k) => k.pubkey.toBase58())
    );
    expect(keys).toContain(reserve.lendingMarket.toBase58());
    expect(keys).toContain(reserve.liquidity.supplyVault.toBase58());
    expect(keys).toContain(reserve.collateral.supplyVault.toBase58());
    expect(keys).toContain(kaminoBank.kaminoIntegrationAccounts!.kaminoObligation.toBase58());

    // The deposit leg targets the destination account B.
    const depositKeys = depositIxs.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58()));
    expect(depositKeys).toContain(ACCOUNT_B_PK.toBase58());
  });

  it("throws a clear error when Kamino reserve state is missing from the metadata map", async () => {
    const ctx = baseCtx({ bankMetadataMap: {} as unknown as BankIntegrationMetadataMap });
    await expect(buildCollateralLegIxs(ctx, kaminoPosition, true, [])).rejects.toThrow(
      /kamino reserve state missing/
    );
  });

  it("throws a clear error when JupLend lending state is missing from the metadata map", async () => {
    const jupBank = {
      ...kaminoBank,
      config: { assetTag: AssetTag.JUPLEND },
      jupLendIntegrationAccounts: {
        jupLendingState: pk(50),
        jupFTokenVault: pk(51),
        jupFTokenAta: pk(52),
      },
    } as unknown as BankType;
    const jupPosition: ClassifiedPosition = { ...kaminoPosition, bank: jupBank };

    // The guard fires before the async builder, so this needs no IDL-backed program.
    await expect(buildCollateralLegIxs(baseCtx(), jupPosition, true, [])).rejects.toThrow(
      /juplend lending state missing/
    );
  });
});
