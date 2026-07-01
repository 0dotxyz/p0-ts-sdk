import { describe, it, expect } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import {
  mergeBridgeQuotes,
  mergeBridgeQuotesDebt,
  mergeBridgeQuotesLoop,
  resolveBridgeBanks,
  accountConflictsWithBridge,
  SwapQuoteResult,
} from "~/services/account";
import {
  isStandardBorrowable,
  isStandardDepositable,
  AssetTag,
  OperationalState,
  BankType,
} from "~/services/bank";
import { MarginfiAccountType } from "~/services/account";

// ----------------------------------------------------------------------------
// Fixtures (minimal casts — these helpers only read a few fields)
// ----------------------------------------------------------------------------

function quote(o: Partial<SwapQuoteResult>): SwapQuoteResult {
  return {
    inAmount: "0",
    outAmount: "0",
    otherAmountThreshold: "0",
    slippageBps: 0,
    ...o,
  } as SwapQuoteResult;
}

function bank(opts: {
  assetTag: AssetTag;
  operationalState: OperationalState;
  borrowLimit: number;
  mint?: PublicKey;
  address?: PublicKey;
}): BankType {
  return {
    address: opts.address ?? Keypair.generate().publicKey,
    mint: opts.mint ?? Keypair.generate().publicKey,
    config: {
      assetTag: opts.assetTag,
      operationalState: opts.operationalState,
      borrowLimit: new BigNumber(opts.borrowLimit),
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

// ----------------------------------------------------------------------------
// Quote merges
// ----------------------------------------------------------------------------

describe("bridge quote merges", () => {
  const first = quote({ inAmount: "100", outAmount: "200", otherAmountThreshold: "190", slippageBps: 100 });
  const second = quote({ inAmount: "200", outAmount: "300", otherAmountThreshold: "285", slippageBps: 100 });

  it("mergeBridgeQuotes maps first.in -> second.out (collateral / loop-deposit)", () => {
    const m = mergeBridgeQuotes(first, second);
    expect(m.inAmount).toBe("100");
    expect(m.outAmount).toBe("300");
    expect(m.otherAmountThreshold).toBe("285");
  });

  it("mergeBridgeQuotesDebt maps first.out -> second.in", () => {
    const m = mergeBridgeQuotesDebt(first, second);
    expect(m.inAmount).toBe("200");
    expect(m.outAmount).toBe("200");
    expect(m.otherAmountThreshold).toBe("200");
  });

  it("mergeBridgeQuotesLoop maps second.in -> first.out", () => {
    const m = mergeBridgeQuotesLoop(first, second);
    expect(m.inAmount).toBe("200");
    expect(m.outAmount).toBe("200");
    expect(m.otherAmountThreshold).toBe("190");
  });

  it("compounds slippage multiplicatively (100bps + 100bps -> 199bps)", () => {
    // 1 - (1 - 0.01)(1 - 0.01) = 0.0199 -> 199 bps
    expect(mergeBridgeQuotes(first, second).slippageBps).toBe(199);
  });
});

// ----------------------------------------------------------------------------
// Bank filters
// ----------------------------------------------------------------------------

describe("isStandardBorrowable / isStandardDepositable", () => {
  it("native DEFAULT/SOL operational banks are borrowable + depositable", () => {
    const def = bank({ assetTag: AssetTag.DEFAULT, operationalState: OperationalState.Operational, borrowLimit: 100 });
    const sol = bank({ assetTag: AssetTag.SOL, operationalState: OperationalState.Operational, borrowLimit: 100 });
    expect(isStandardBorrowable(def)).toBe(true);
    expect(isStandardDepositable(def)).toBe(true);
    expect(isStandardBorrowable(sol)).toBe(true);
  });

  it("integration wrappers (Kamino/Drift/JupLend) are neither", () => {
    const kamino = bank({ assetTag: AssetTag.KAMINO, operationalState: OperationalState.Operational, borrowLimit: 0 });
    expect(isStandardBorrowable(kamino)).toBe(false);
    expect(isStandardDepositable(kamino)).toBe(false);
  });

  it("ReduceOnly excludes both; zero borrowLimit excludes only borrowable", () => {
    const reduceOnly = bank({ assetTag: AssetTag.DEFAULT, operationalState: OperationalState.ReduceOnly, borrowLimit: 100 });
    expect(isStandardBorrowable(reduceOnly)).toBe(false);
    expect(isStandardDepositable(reduceOnly)).toBe(false);

    const noBorrow = bank({ assetTag: AssetTag.DEFAULT, operationalState: OperationalState.Operational, borrowLimit: 0 });
    expect(isStandardBorrowable(noBorrow)).toBe(false);
    expect(isStandardDepositable(noBorrow)).toBe(true); // deposit doesn't need a borrow limit
  });
});

// ----------------------------------------------------------------------------
// Conflict + resolution
// ----------------------------------------------------------------------------

describe("accountConflictsWithBridge", () => {
  const bankPk = Keypair.generate().publicKey;

  it("deposit-side conflicts with an existing liability, not an asset", () => {
    const liab = accountWith([{ bankPk, assetShares: 0, liabilityShares: 5 }]);
    const asset = accountWith([{ bankPk, assetShares: 5, liabilityShares: 0 }]);
    expect(accountConflictsWithBridge(liab, bankPk, "deposit")).toBe(true);
    expect(accountConflictsWithBridge(asset, bankPk, "deposit")).toBe(false);
  });

  it("borrow-side conflicts with an existing asset, not a liability", () => {
    const asset = accountWith([{ bankPk, assetShares: 5, liabilityShares: 0 }]);
    const liab = accountWith([{ bankPk, assetShares: 0, liabilityShares: 5 }]);
    expect(accountConflictsWithBridge(asset, bankPk, "borrow")).toBe(true);
    expect(accountConflictsWithBridge(liab, bankPk, "borrow")).toBe(false);
  });

  it("no position on the bank -> no conflict", () => {
    const empty = accountWith([]);
    expect(accountConflictsWithBridge(empty, bankPk, "deposit")).toBe(false);
  });
});

describe("resolveBridgeBanks", () => {
  const usdcMint = Keypair.generate().publicKey;
  const solMint = Keypair.generate().publicKey;
  const wrapperMint = Keypair.generate().publicKey; // only has a non-standard bank

  const usdcBank = bank({ assetTag: AssetTag.DEFAULT, operationalState: OperationalState.Operational, borrowLimit: 100, mint: usdcMint });
  const solBank = bank({ assetTag: AssetTag.SOL, operationalState: OperationalState.Operational, borrowLimit: 100, mint: solMint });
  const wrapperBank = bank({ assetTag: AssetTag.KAMINO, operationalState: OperationalState.Operational, borrowLimit: 0, mint: wrapperMint });
  const banks = [usdcBank, solBank, wrapperBank];

  it("resolves standard banks in priority order, dedupes, skips mints with no standard bank", () => {
    const { bridges, conflicts } = resolveBridgeBanks({
      orderedBridgeMints: [usdcMint, usdcMint, wrapperMint, solMint], // dup + a no-standard-bank mint
      banks,
      marginfiAccount: accountWith([]),
      side: "deposit",
    });
    expect(bridges.map((b) => b.address.toBase58())).toEqual([
      usdcBank.address.toBase58(),
      solBank.address.toBase58(),
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("partitions a conflicting bridge out of the usable set", () => {
    // Account holds SOL as an ASSET -> borrow-side conflict on the SOL bank.
    const account = accountWith([{ bankPk: solBank.address, assetShares: 5, liabilityShares: 0 }]);
    const { bridges, conflicts } = resolveBridgeBanks({
      orderedBridgeMints: [usdcMint, solMint],
      banks,
      marginfiAccount: account,
      side: "borrow",
    });
    expect(bridges.map((b) => b.address.toBase58())).toEqual([usdcBank.address.toBase58()]);
    expect(conflicts.map((b) => b.address.toBase58())).toEqual([solBank.address.toBase58()]);
  });
});
