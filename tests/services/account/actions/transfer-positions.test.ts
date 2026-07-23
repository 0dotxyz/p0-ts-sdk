import { describe, it, expect } from "vitest";
import { BigNumber } from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

import { planTransferBundles } from "~/services/account/actions/transfer-positions";
import { TransferPositionPlanItem } from "~/services/account/types";
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
