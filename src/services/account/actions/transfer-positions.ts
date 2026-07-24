import { BigNumber } from "bignumber.js";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  AssetTag,
  BankType,
  RiskTier,
  computeRateLimitRemainingCapacity,
} from "~/services/bank";
import {
  OraclePrice,
  makeSmartCrankSwbFeedIx,
  makeRefreshKaminoBanksIxs,
  makeUpdateJupLendRateIxs,
} from "~/services/price";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  getTotalAccountKeys,
  getTxSize,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { TransactionBuildingError } from "~/errors";
import { MAX_ACCOUNT_LOCKS, MAX_TX_SIZE } from "~/constants";
import { MarginfiProgram, BankIntegrationMetadataMap } from "~/types";
import { uiToNative } from "~/utils";

import {
  MakeTransferPositionsTxParams,
  TransferBundle,
  TransferPositionPlanItem,
  TransferPositionsResult,
} from "../types";
import { MarginfiAccountType, MarginRequirementType } from "../types/account.types";
import {
  computeHealthAccountMetas,
  computeHealthComponentsFromBalances,
  computeQuantityUi,
  computeV0TxSize,
  getBalanceUsdValueWithPriceBias,
} from "../utils";
import { findRandomAvailableAccountIndex } from "../utils/fetch.utils";

import { makeWithdrawIx, makeKaminoWithdrawIx, makeJuplendWithdrawIx } from "./withdraw";
import { makeDepositIx, makeKaminoDepositIx, makeJuplendDepositIx } from "./deposit";
import { makeBorrowIx } from "./borrow";
import { makeRepayIx } from "./repay";
import { makeBeginFlashLoanIx, makeEndFlashLoanIx } from "./flash-loan";
import { makeCreateAccountIxWithProjection, makeSetupIx } from "./account-lifecycle";

/** Fixed marginfi balance slots per account. */
const MAX_BALANCES = 16;

/** Safety margin (bytes) kept below the hard cap when probing whether a bundle fits. */
const TRANSFER_SIZE_MARGIN = 32;

const DEFAULT_BORROW_PADDING_BPS = 10;

const CU_IXS = () => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
];

// --------------------------------------------------------------------------------------
// Pure bundle planner
// --------------------------------------------------------------------------------------

/**
 * Partition the selected positions into flashloan bundles that each keep both accounts healthy
 * at their transaction boundary.
 *
 * Feasibility corridor: let `W` be the cumulative net moved initial-weight USD (moved collateral
 * minus moved debt). At every tx boundary the destination's borrow health check requires the moved
 * bundle to be init-healthy (`W >= 0`) and the source's end-of-flashloan check requires its
 * remainder healthy (`W <= M`, where `M` is the source's health margin). We keep intermediate
 * boundaries strictly inside `[epsilon, M - epsilon]`; the final boundary is relaxed to the fully
 * validated `W_total`. Inside a single tx `W` may swing freely, which is what lets a debt larger
 * than `M` ride alongside its offsetting collateral.
 *
 * `fitsInTx(candidate, bundleIndex)` reports whether a candidate set of positions fits one v0 tx
 * (bytes + account locks). Injected so the planner stays pure and unit-testable.
 */
export function planTransferBundles(args: {
  positions: TransferPositionPlanItem[];
  marginUsd: BigNumber;
  epsilonUsd: BigNumber;
  fitsInTx: (candidate: TransferPositionPlanItem[], bundleIndex: number) => boolean;
}): TransferBundle[] {
  const { positions, marginUsd, epsilonUsd, fitsInTx } = args;

  const signed = (p: TransferPositionPlanItem) =>
    p.side === "collateral" ? p.initUsdValue : p.initUsdValue.negated();

  const byValueDesc = (a: TransferPositionPlanItem, b: TransferPositionPlanItem) =>
    b.initUsdValue.comparedTo(a.initUsdValue) ?? 0;

  const colls = positions.filter((p) => p.side === "collateral").sort(byValueDesc);
  const debts = positions.filter((p) => p.side === "debt").sort(byValueDesc);

  const lowB = epsilonUsd;
  const highB = marginUsd.minus(epsilonUsd);
  const mid = lowB.plus(highB).div(2);

  const bundles: TransferBundle[] = [];
  let W = new BigNumber(0);
  let ci = 0;
  let di = 0;

  while (ci < colls.length || di < debts.length) {
    const bundle: TransferPositionPlanItem[] = [];
    let w = W;

    // Grow the bundle, greedily balancing so the running boundary W stays near the corridor centre.
    while (ci < colls.length || di < debts.length) {
      const coll = ci < colls.length ? colls[ci] : null;
      const debt = di < debts.length ? debts[di] : null;

      const collFits = coll ? fitsInTx([...bundle, coll], bundles.length) : false;
      const debtFits = debt ? fitsInTx([...bundle, debt], bundles.length) : false;
      if (!collFits && !debtFits) break;

      let choice: "coll" | "debt";
      if (collFits && debtFits && coll && debt) {
        const wIfColl = w.plus(signed(coll));
        const wIfDebt = w.plus(signed(debt));
        choice = wIfColl.minus(mid).abs().lte(wIfDebt.minus(mid).abs()) ? "coll" : "debt";
      } else {
        choice = collFits ? "coll" : "debt";
      }

      if (choice === "coll" && coll) {
        bundle.push(coll);
        w = w.plus(signed(coll));
        ci++;
      } else if (debt) {
        bundle.push(debt);
        w = w.plus(signed(debt));
        di++;
      }
    }

    if (bundle.length === 0) {
      // The next single position does not fit an empty transaction on its own.
      const stuck = ci < colls.length ? colls[ci] : debts[di];
      throw TransactionBuildingError.transferPositionsUnsplittable(
        "a single position does not fit one transaction",
        marginUsd.toString(),
        W.toString(),
        stuck?.initUsdValue.toString(),
        stuck?.bankAddress.toBase58()
      );
    }

    const allConsumed = ci >= colls.length && di >= debts.length;
    if (!allConsumed) {
      if (w.lt(lowB) || w.gt(highB)) {
        throw TransactionBuildingError.transferPositionsUnsplittable(
          "cannot keep both accounts healthy at a transaction boundary; source health margin is too thin to split this transfer",
          marginUsd.toString(),
          w.toString()
        );
      }
    }

    bundles.push({ positions: bundle, cumulativeNetMovedUsd: w });
    W = w;
  }

  return bundles;
}

// --------------------------------------------------------------------------------------
// Classification + pricing
// --------------------------------------------------------------------------------------

export interface ClassifiedPosition extends TransferPositionPlanItem {
  bank: BankType;
  tokenProgram: PublicKey;
}

function requireBank(bankMap: Map<string, BankType>, address: PublicKey): BankType {
  const bank = bankMap.get(address.toBase58());
  if (!bank) {
    throw TransactionBuildingError.transferPositionsInvalidSelection(
      `bank ${address.toBase58()} not found`,
      [address.toBase58()]
    );
  }
  return bank;
}

function requireTokenProgram(
  tokenProgramsByBank: Map<string, PublicKey>,
  address: PublicKey
): PublicKey {
  const tp = tokenProgramsByBank.get(address.toBase58());
  if (!tp) {
    throw TransactionBuildingError.transferPositionsInvalidSelection(
      `token program for bank ${address.toBase58()} not provided`,
      [address.toBase58()]
    );
  }
  return tp;
}

/**
 * Validate the selection, infer each position's side, and price it at initial weights.
 * Returns the classified positions plus the source account's health margin `M`.
 */
function classifyAndPrice(params: MakeTransferPositionsTxParams): {
  positions: ClassifiedPosition[];
  marginUsd: BigNumber;
} {
  const {
    marginfiAccount: accountA,
    destinationAccount: accountB,
    bankAddresses,
    bankMap,
    oraclePrices,
    tokenProgramsByBank,
    assetShareValueMultiplierByBank,
    activeEmodeWeightsByBank,
  } = params;

  if (bankAddresses.length === 0) {
    throw TransactionBuildingError.transferPositionsInvalidSelection("no positions selected", []);
  }

  const activeBalancesA = accountA.balances.filter((b) => b.active);
  const positions: ClassifiedPosition[] = [];

  for (const bankAddress of bankAddresses) {
    const bank = requireBank(bankMap, bankAddress);
    const tokenProgram = requireTokenProgram(tokenProgramsByBank, bankAddress);

    const balance = activeBalancesA.find((b) => b.bankPk.equals(bankAddress));
    if (!balance) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        `source account has no active position in bank ${bankAddress.toBase58()}`,
        [bankAddress.toBase58()]
      );
    }

    const side = balance.assetShares.gt(0) ? "collateral" : "debt";

    const oraclePrice = oraclePrices.get(bankAddress.toBase58());
    if (!oraclePrice) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        `oracle price for bank ${bankAddress.toBase58()} not found`,
        [bankAddress.toBase58()]
      );
    }

    const multiplier = assetShareValueMultiplierByBank.get(bankAddress.toBase58());
    const emodeWeights = activeEmodeWeightsByBank?.get(bankAddress.toBase58());

    const qty = computeQuantityUi(balance, bank, multiplier);
    const usd = getBalanceUsdValueWithPriceBias({
      balance,
      bank,
      oraclePrice,
      marginRequirement: MarginRequirementType.Initial,
      assetShareValueMultiplier: multiplier,
      activeEmodeWeights: emodeWeights,
    });

    positions.push({
      bankAddress,
      side,
      uiAmount: side === "collateral" ? qty.assets : qty.liabilities,
      initUsdValue: side === "collateral" ? usd.assets : usd.liabilities,
      bank,
      tokenProgram,
    });
  }

  // Isolated-tier debt must be the destination account's only liability.
  const isolatedDebts = positions.filter(
    (p) => p.side === "debt" && p.bank.config.riskTier === RiskTier.Isolated
  );
  if (isolatedDebts.length > 0) {
    const otherDebts = positions.filter((p) => p.side === "debt").length > 1;
    const destHasLiabilities = (accountB?.balances ?? []).some((b) => b.active && b.liabilityShares.gt(0));
    if (isolatedDebts.length > 1 || otherDebts || destHasLiabilities) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        "an isolated-tier debt can only be transferred as the destination account's sole liability",
        isolatedDebts.map((p) => p.bankAddress.toBase58())
      );
    }
  }

  // Destination account validation.
  if (accountB) {
    if (!accountB.group.equals(accountA.group)) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        "destination account is in a different group",
        [accountB.address.toBase58()]
      );
    }
    if (!accountB.authority.equals(accountA.authority)) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        "destination account has a different authority",
        [accountB.address.toBase58()]
      );
    }
    const overlap = positions.filter((p) =>
      accountB.balances.some((b) => b.active && b.bankPk.equals(p.bankAddress))
    );
    if (overlap.length > 0) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        "destination account already holds a position in a transferred bank",
        overlap.map((p) => p.bankAddress.toBase58())
      );
    }
    const activeCountB = accountB.balances.filter((b) => b.active).length;
    if (activeCountB + positions.length > MAX_BALANCES) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        `destination account cannot hold ${activeCountB + positions.length} positions (max ${MAX_BALANCES})`,
        positions.map((p) => p.bankAddress.toBase58())
      );
    }
  }

  const health = computeHealthComponentsFromBalances({
    activeBalances: activeBalancesA,
    marginRequirement: MarginRequirementType.Initial,
    banksMap: bankMap,
    oraclePricesByBank: oraclePrices,
    assetShareValueMultiplierByBank,
    activeEmodeWeightsByBank,
  });
  const marginUsd = health.assets.minus(health.liabilities);

  return { positions, marginUsd };
}

// --------------------------------------------------------------------------------------
// Bank rate-limit precheck (debt legs)
// --------------------------------------------------------------------------------------

/**
 * The destination borrow of a moved debt records a native outflow on the debt bank *before* the
 * offsetting repay on the source releases it. Reject transfers whose borrow would exceed the bank's
 * remaining rate-limit window. Retryable: split smaller or wait for the window to advance.
 */
function precheckBankRateLimits(positions: ClassifiedPosition[], borrowPaddingBps: number): void {
  const nowTs = Math.floor(Date.now() / 1000);
  const remainingByBank = new Map<string, BigNumber>();

  for (const position of positions) {
    if (position.side !== "debt") continue;

    const key = position.bankAddress.toBase58();
    const capacity = computeRateLimitRemainingCapacity(position.bank.rateLimiter, nowTs);
    if (capacity.combined === null || capacity.bindingWindow === null) continue;

    const borrowUi = position.uiAmount.times(1 + borrowPaddingBps / 10_000);
    const borrowNative = new BigNumber(
      uiToNative(borrowUi, position.bank.mintDecimals).toString()
    );

    const remaining = remainingByBank.get(key) ?? capacity.combined;
    if (borrowNative.gt(remaining)) {
      throw TransactionBuildingError.transferPositionsBankRateLimit(
        position.bankAddress.toBase58(),
        borrowNative.toString(),
        remaining.toString(),
        capacity.bindingWindow,
        position.bank.tokenSymbol
      );
    }
    remainingByBank.set(key, remaining.minus(borrowNative));
  }
}

// --------------------------------------------------------------------------------------
// Integration reserve/rate refresh
// --------------------------------------------------------------------------------------

/**
 * On-chain reserve/rate refresh ixs the integration collateral legs depend on. Kamino has no
 * self-refresh, so its reserves must be re-derived and the bank-level obligations of the banks we
 * act on refreshed. JupLend deposit/withdraw self-refresh their own bank, so only *other* JupLend
 * banks that stay in a health pack need the permissionless rate crank.
 *
 * Following the swap-collateral / repay-with-collateral precedent these ride in transactions that
 * precede the flashloans rather than inside them: the builders return no signer keys, and keeping
 * them out of the flashloan preserves the byte/lock budget the bundle planner packs against. The
 * trade-off is that, across a multi-transaction transfer, later flashloans read a reserve/rate
 * refreshed a few slots earlier — immaterial drift (`skipPriceUpdates` refreshes only accrue
 * interest; klend does not reject a marginfi CPI over it), but see the action's runtime notes.
 */
function buildIntegrationRefreshIxs(args: {
  accountA: MarginfiAccountType;
  destinationAccount?: MarginfiAccountType;
  positions: ClassifiedPosition[];
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
}): TransactionInstruction[] {
  const { accountA, destinationAccount, positions, bankMap, bankMetadataMap } = args;

  const transferredKaminoPks = positions
    .filter((p) => p.bank.config.assetTag === AssetTag.KAMINO)
    .map((p) => p.bankAddress);
  const transferredJupPks = positions
    .filter((p) => p.bank.config.assetTag === AssetTag.JUPLEND)
    .map((p) => p.bankAddress);

  const ixs: TransactionInstruction[] = [];

  // Kamino: refresh reserves for the source's active Kamino banks (covers the transferred ones,
  // which are active on A) plus the obligations of the transferred banks.
  ixs.push(
    ...makeRefreshKaminoBanksIxs(accountA, bankMap, transferredKaminoPks, bankMetadataMap)
      .instructions
  );
  // A pre-existing destination may hold its own Kamino collateral read by each borrow's health pack.
  if (destinationAccount) {
    ixs.push(
      ...makeRefreshKaminoBanksIxs(destinationAccount, bankMap, [], bankMetadataMap).instructions
    );
  }

  // JupLend: crank the rate on the source's *other* JupLend banks; transferred banks self-refresh
  // through their own withdraw (A) and deposit (B).
  ixs.push(
    ...makeUpdateJupLendRateIxs(accountA, bankMap, transferredJupPks, bankMetadataMap).instructions
  );
  if (destinationAccount) {
    ixs.push(
      ...makeUpdateJupLendRateIxs(destinationAccount, bankMap, transferredJupPks, bankMetadataMap)
        .instructions
    );
  }

  return ixs;
}

// --------------------------------------------------------------------------------------
// Instruction assembly
// --------------------------------------------------------------------------------------

function dedupeBanks(banks: BankType[]): BankType[] {
  const seen = new Map<string, BankType>();
  for (const bank of banks) seen.set(bank.address.toBase58(), bank);
  return [...seen.values()];
}

export interface BuildContext {
  program: MarginfiProgram;
  accountA: MarginfiAccountType;
  accountB: MarginfiAccountType;
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  borrowPaddingBps: number;
  groupRateLimiterEnabled: boolean;
  overrideInferAccounts?: { group?: PublicKey; authority?: PublicKey };
  /** Banks the destination account already holds before the transfer starts. */
  destPreexistingBanks: BankType[];
}

/**
 * Build one collateral position's withdraw-from-A + deposit-into-B instructions, dispatching to the
 * right builder for the bank's asset tag. This is the single place that defines which banks the
 * action supports: `DEFAULT`/`SOL`/`STAKED` use the standard withdraw/deposit; `KAMINO`/`JUPLEND`
 * use their dedicated builders (which lock the integration's reserve/vault accounts and, for Kamino,
 * convert the underlying UI amount to cToken units); anything else throws
 * `TRANSFER_POSITIONS_UNSUPPORTED_BANK`. The reserve/rate state each integration builder needs is
 * read from `bankMetadataMap`; the on-chain refresh those reads depend on is emitted separately in
 * `buildIntegrationRefreshIxs`.
 *
 * `observationBanksOverride` controls the withdraw leg's health pack (empty while A is flashloaned
 * with the group limiter off; the withdrawn bank's oracle when it is on). The deposit leg runs no
 * health check, so it needs none.
 */
export async function buildCollateralLegIxs(
  ctx: BuildContext,
  position: ClassifiedPosition,
  isSync: boolean,
  observationBanksOverride: ReturnType<typeof computeHealthAccountMetas>
): Promise<{ withdrawIxs: TransactionInstruction[]; depositIxs: TransactionInstruction[] }> {
  const { bank, tokenProgram, uiAmount } = position;
  const tag = bank.config.assetTag;
  const key = bank.address.toBase58();

  if (tag === AssetTag.KAMINO) {
    const reserve = ctx.bankMetadataMap[key]?.kaminoStates?.reserveState;
    if (!reserve) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        `kamino reserve state missing for bank ${key} (populate bankMetadataMap.kaminoStates)`,
        [key]
      );
    }
    const multiplier = ctx.assetShareValueMultiplierByBank.get(key) ?? new BigNumber(1);
    const cTokenAmount = uiAmount.div(multiplier);
    const withdraw = await makeKaminoWithdrawIx({
      program: ctx.program,
      bank,
      bankMap: ctx.bankMap,
      tokenProgram,
      cTokenAmount,
      marginfiAccount: ctx.accountA,
      authority: ctx.accountA.authority,
      reserve,
      bankMetadataMap: ctx.bankMetadataMap,
      withdrawAll: true,
      isSync,
      opts: {
        createAtas: false,
        wrapAndUnwrapSol: false,
        overrideInferAccounts: ctx.overrideInferAccounts,
        observationBanksOverride,
      },
    });
    const deposit = await makeKaminoDepositIx({
      program: ctx.program,
      bank,
      tokenProgram,
      amount: uiAmount,
      accountAddress: ctx.accountB.address,
      authority: ctx.accountA.authority,
      group: ctx.accountB.group,
      reserve,
      isSync,
      opts: { wrapAndUnwrapSol: false, overrideInferAccounts: ctx.overrideInferAccounts },
    });
    return { withdrawIxs: withdraw.instructions, depositIxs: deposit.instructions };
  }

  if (tag === AssetTag.JUPLEND) {
    const jupLendingState = ctx.bankMetadataMap[key]?.jupLendStates?.jupLendingState;
    if (!jupLendingState) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        `juplend lending state missing for bank ${key} (populate bankMetadataMap.jupLendStates)`,
        [key]
      );
    }
    const withdraw = await makeJuplendWithdrawIx({
      program: ctx.program,
      bank,
      bankMap: ctx.bankMap,
      tokenProgram,
      amount: uiAmount,
      marginfiAccount: ctx.accountA,
      authority: ctx.accountA.authority,
      jupLendingState,
      bankMetadataMap: ctx.bankMetadataMap,
      withdrawAll: true,
      isSync,
      opts: {
        createAtas: false,
        wrapAndUnwrapSol: false,
        overrideInferAccounts: ctx.overrideInferAccounts,
        observationBanksOverride,
      },
    });
    const deposit = await makeJuplendDepositIx({
      program: ctx.program,
      bank,
      tokenProgram,
      amount: uiAmount,
      accountAddress: ctx.accountB.address,
      authority: ctx.accountA.authority,
      group: ctx.accountB.group,
      isSync,
      opts: { wrapAndUnwrapSol: false, overrideInferAccounts: ctx.overrideInferAccounts },
    });
    return { withdrawIxs: withdraw.instructions, depositIxs: deposit.instructions };
  }

  // Standard banks (DEFAULT/SOL/STAKED) move with the plain lending ixs. Any other tag is an
  // integration we don't yet have a collateral-leg builder for (DRIFT/SOLEND, or a future tag).
  // This switch is the single place that defines what `transfer-positions` supports — adding an
  // integration means adding one branch above, nothing elsewhere.
  if (tag !== AssetTag.DEFAULT && tag !== AssetTag.SOL && tag !== AssetTag.STAKED) {
    throw TransactionBuildingError.transferPositionsUnsupportedBank(key, tag, bank.tokenSymbol);
  }

  const withdraw = await makeWithdrawIx({
    program: ctx.program,
    bank,
    bankMap: ctx.bankMap,
    tokenProgram,
    amount: uiAmount,
    marginfiAccount: ctx.accountA,
    authority: ctx.accountA.authority,
    withdrawAll: true,
    bankMetadataMap: ctx.bankMetadataMap,
    isSync,
    opts: {
      createAtas: false,
      wrapAndUnwrapSol: false,
      overrideInferAccounts: ctx.overrideInferAccounts,
      observationBanksOverride,
    },
  });
  const deposit = await makeDepositIx({
    program: ctx.program,
    bank,
    tokenProgram,
    amount: uiAmount,
    accountAddress: ctx.accountB.address,
    authority: ctx.accountA.authority,
    group: ctx.accountB.group,
    isSync,
    opts: { wrapAndUnwrapSol: false, overrideInferAccounts: ctx.overrideInferAccounts },
  });
  return { withdrawIxs: withdraw.instructions, depositIxs: deposit.instructions };
}

/**
 * Build the inner instructions for one bundle:
 *   [cu…, withdraws(A)…, deposits(B)…, borrows(B)…, repays(A)…]
 * All deposits precede all borrows so every intermediate destination state is healthier than the
 * transaction-final one. Withdraws and repays carry no health accounts (A is inside the flashloan);
 * withdraws only gain the withdrawn bank's oracle when the group limiter is enabled. Each borrow
 * carries the destination's health pack for its banks active at that point.
 */
async function buildBundleInnerIxs(
  ctx: BuildContext,
  bundle: TransferPositionPlanItem[],
  bankOf: Map<string, ClassifiedPosition>,
  isSync: boolean
): Promise<TransactionInstruction[]> {
  const collateral = bundle.filter((p) => p.side === "collateral");
  const debts = bundle.filter((p) => p.side === "debt");

  const collateralBanks = collateral.map((p) => bankOf.get(p.bankAddress.toBase58())!.bank);

  const withdrawIxs: TransactionInstruction[] = [];
  const depositIxs: TransactionInstruction[] = [];
  const borrowIxs: TransactionInstruction[] = [];
  const repayIxs: TransactionInstruction[] = [];

  for (const position of collateral) {
    const classified = bankOf.get(position.bankAddress.toBase58())!;

    // A is flagged: no health pack. Group off ⇒ no oracle either. Group on ⇒ trailing bank oracle.
    const observationBanksOverride = ctx.groupRateLimiterEnabled
      ? computeHealthAccountMetas([], true, [classified.bank])
      : [];

    const legs = await buildCollateralLegIxs(ctx, classified, isSync, observationBanksOverride);
    withdrawIxs.push(...legs.withdrawIxs);
    depositIxs.push(...legs.depositIxs);
  }

  const borrowedSoFar: BankType[] = [];
  for (const position of debts) {
    const classified = bankOf.get(position.bankAddress.toBase58())!;
    const { bank, tokenProgram } = classified;
    borrowedSoFar.push(bank);

    // Destination banks active at this borrow: pre-existing + all bundle collateral + debts so far.
    const activeBanks = dedupeBanks([
      ...ctx.destPreexistingBanks,
      ...collateralBanks,
      ...borrowedSoFar,
    ]);
    const observationBanksOverride = computeHealthAccountMetas(activeBanks);

    const borrowUi = position.uiAmount.times(1 + ctx.borrowPaddingBps / 10_000);
    const borrow = await makeBorrowIx({
      program: ctx.program,
      bank,
      bankMap: ctx.bankMap,
      tokenProgram,
      amount: borrowUi,
      marginfiAccount: ctx.accountB,
      authority: ctx.accountA.authority,
      isSync,
      opts: {
        createAtas: false,
        wrapAndUnwrapSol: false,
        overrideInferAccounts: ctx.overrideInferAccounts,
        observationBanksOverride,
      },
    });
    borrowIxs.push(...borrow.instructions);

    const repay = await makeRepayIx({
      program: ctx.program,
      bank,
      tokenProgram,
      amount: position.uiAmount,
      accountAddress: ctx.accountA.address,
      authority: ctx.accountA.authority,
      repayAll: true,
      isSync,
      opts: {
        wrapAndUnwrapSol: false,
        overrideInferAccounts: ctx.overrideInferAccounts,
      },
    });
    repayIxs.push(...repay.instructions);
  }

  return [...CU_IXS(), ...withdrawIxs, ...depositIxs, ...borrowIxs, ...repayIxs];
}

/**
 * Wrap a bundle's inner instructions in a single flashloan on the source account.
 * Order: `[preIxs…, beginFL(A), inner…, endFL(A)]`; the begin ix points at the end ix.
 */
async function buildTransferFlashloanTx(args: {
  program: MarginfiProgram;
  accountA: MarginfiAccountType;
  projectedActiveBanksA: BankType[];
  innerIxs: TransactionInstruction[];
  preIxs: TransactionInstruction[];
  blockhash: string;
  luts: AddressLookupTableAccount[];
}): Promise<ExtendedV0Transaction> {
  const { program, accountA, projectedActiveBanksA, innerIxs, preIxs, blockhash, luts } = args;

  const endIndex = preIxs.length + innerIxs.length + 1;
  const begin = await makeBeginFlashLoanIx(program, accountA.address, endIndex, accountA.authority);
  const end = await makeEndFlashLoanIx(
    program,
    accountA.address,
    projectedActiveBanksA,
    accountA.authority
  );

  const message = new TransactionMessage({
    payerKey: accountA.authority,
    recentBlockhash: blockhash,
    instructions: [...preIxs, ...begin.instructions, ...innerIxs, ...end.instructions],
  }).compileToV0Message(luts);

  return addTransactionMetadata(new VersionedTransaction(message), {
    addressLookupTables: luts,
    type: TransactionType.FLASHLOAN,
  });
}

// --------------------------------------------------------------------------------------
// Size probing
// --------------------------------------------------------------------------------------

/**
 * Build synchronous probe instructions for a single position (used only for size measurement).
 * The borrow probe pack is a conservative superset (all selected collateral banks + this debt bank),
 * so a bundle's real per-borrow packs are never larger than what was probed.
 */
async function buildPositionProbeIxs(
  ctx: BuildContext,
  position: ClassifiedPosition,
  allCollateralBanks: BankType[]
): Promise<TransactionInstruction[]> {
  if (position.side === "collateral") {
    const observationBanksOverride = ctx.groupRateLimiterEnabled
      ? computeHealthAccountMetas([], true, [position.bank])
      : [];
    const legs = await buildCollateralLegIxs(ctx, position, true, observationBanksOverride);
    return [...legs.withdrawIxs, ...legs.depositIxs];
  }

  const pack = computeHealthAccountMetas(
    dedupeBanks([...ctx.destPreexistingBanks, ...allCollateralBanks, position.bank])
  );
  const borrowUi = position.uiAmount.times(1 + ctx.borrowPaddingBps / 10_000);
  const borrow = await makeBorrowIx({
    program: ctx.program,
    bank: position.bank,
    bankMap: ctx.bankMap,
    tokenProgram: position.tokenProgram,
    amount: borrowUi,
    marginfiAccount: ctx.accountB,
    authority: ctx.accountA.authority,
    isSync: true,
    opts: {
      createAtas: false,
      wrapAndUnwrapSol: false,
      overrideInferAccounts: ctx.overrideInferAccounts,
      observationBanksOverride: pack,
    },
  });
  const repay = await makeRepayIx({
    program: ctx.program,
    bank: position.bank,
    tokenProgram: position.tokenProgram,
    amount: position.uiAmount,
    accountAddress: ctx.accountA.address,
    authority: ctx.accountA.authority,
    repayAll: true,
    isSync: true,
    opts: { wrapAndUnwrapSol: false, overrideInferAccounts: ctx.overrideInferAccounts },
  });
  return [...borrow.instructions, ...repay.instructions];
}

async function buildProbe(args: {
  ctx: BuildContext;
  positions: ClassifiedPosition[];
  createIx?: TransactionInstruction;
  luts: AddressLookupTableAccount[];
}): Promise<{
  fitsInTx: (candidate: TransferPositionPlanItem[], bundleIndex: number) => boolean;
  measure: (
    candidate: TransferPositionPlanItem[],
    bundleIndex: number
  ) => { size: number; accountCount: number };
}> {
  const { ctx, positions, createIx, luts } = args;

  const allCollateralBanks = positions
    .filter((p) => p.side === "collateral")
    .map((p) => p.bank);

  // Pre-build each position's probe instructions once (async), keyed by bank.
  const probeByBank = new Map<string, TransactionInstruction[]>();
  for (const position of positions) {
    probeByBank.set(
      position.bankAddress.toBase58(),
      await buildPositionProbeIxs(ctx, position, allCollateralBanks)
    );
  }

  // Conservative endFL(A) metas: the source's full original active banks (largest possible pack).
  const originalActiveBanksA = dedupeBanks(
    ctx.accountA.balances
      .filter((b) => b.active)
      .map((b) => requireBank(ctx.bankMap, b.bankPk))
  );

  const begin = await makeBeginFlashLoanIx(
    ctx.program,
    ctx.accountA.address,
    999,
    ctx.accountA.authority,
    true
  );
  const end = await makeEndFlashLoanIx(
    ctx.program,
    ctx.accountA.address,
    originalActiveBanksA,
    ctx.accountA.authority,
    true
  );

  const measure = (
    candidate: TransferPositionPlanItem[],
    bundleIndex: number
  ): { size: number; accountCount: number } => {
    const inner: TransactionInstruction[] = [...CU_IXS()];
    for (const position of candidate) {
      const ixs = probeByBank.get(position.bankAddress.toBase58());
      if (ixs) inner.push(...ixs);
    }
    const preIxs = bundleIndex === 0 && createIx ? [createIx] : [];
    const all = [...preIxs, ...begin.instructions, ...inner, ...end.instructions];
    return computeV0TxSizeSafe(all, ctx.accountA.authority, luts);
  };

  const fitsInTx = (candidate: TransferPositionPlanItem[], bundleIndex: number): boolean => {
    const { size, accountCount } = measure(candidate, bundleIndex);
    return size <= MAX_TX_SIZE - TRANSFER_SIZE_MARGIN && accountCount <= MAX_ACCOUNT_LOCKS;
  };

  return { fitsInTx, measure };
}

// computeV0TxSize can throw a RangeError for a message that overflows the compact-array encoding;
// treat that as "does not fit".
function computeV0TxSizeSafe(
  ixs: TransactionInstruction[],
  payer: PublicKey,
  luts: AddressLookupTableAccount[]
): { size: number; accountCount: number } {
  try {
    const { size, accountCount } = computeV0TxSize(ixs, payer, luts);
    return { size, accountCount };
  } catch {
    return { size: Number.MAX_SAFE_INTEGER, accountCount: Number.MAX_SAFE_INTEGER };
  }
}

// --------------------------------------------------------------------------------------
// Public: max positions per tx
// --------------------------------------------------------------------------------------

/**
 * How many of the given positions (in order) fit in a single dual-account flashloan tx, given the
 * current balances and LUT coverage. The binding constraint is usually the 64 account-lock cap.
 */
export async function computeMaxTransferPositionsPerTx(params: {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  destinationAccount?: MarginfiAccountType;
  candidateBankAddresses: PublicKey[];
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
  oraclePrices: Map<string, OraclePrice>;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  tokenProgramsByBank: Map<string, PublicKey>;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  includeCreateAccountIx?: boolean;
  groupRateLimiterEnabled?: boolean;
}): Promise<{ maxPositions: number; bytesAtLimit: number; locksAtLimit: number }> {
  const luts = params.addressLookupTableAccounts ?? [];

  const { positions } = classifyAndPrice({
    program: params.program,
    connection: undefined as unknown as Connection,
    marginfiAccount: params.marginfiAccount,
    destinationAccount: params.destinationAccount,
    bankAddresses: params.candidateBankAddresses,
    bankMap: params.bankMap,
    oraclePrices: params.oraclePrices,
    bankMetadataMap: params.bankMetadataMap,
    assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
    tokenProgramsByBank: params.tokenProgramsByBank,
  });

  const destB = params.destinationAccount ?? params.marginfiAccount;
  const ctx: BuildContext = {
    program: params.program,
    accountA: params.marginfiAccount,
    accountB: destB,
    bankMap: params.bankMap,
    bankMetadataMap: params.bankMetadataMap,
    assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
    borrowPaddingBps: DEFAULT_BORROW_PADDING_BPS,
    groupRateLimiterEnabled: params.groupRateLimiterEnabled ?? false,
    destPreexistingBanks: destPreexistingBanksOf(params.destinationAccount, params.bankMap),
  };

  const dummyCreateIx = params.includeCreateAccountIx
    ? new TransactionInstruction({
        programId: params.program.programId,
        keys: [
          { pubkey: params.marginfiAccount.address, isSigner: false, isWritable: true },
          { pubkey: params.marginfiAccount.authority, isSigner: true, isWritable: true },
        ],
        data: Buffer.alloc(16),
      })
    : undefined;

  const { fitsInTx, measure } = await buildProbe({ ctx, positions, createIx: dummyCreateIx, luts });

  let maxPositions = 0;
  let bytesAtLimit = 0;
  let locksAtLimit = 0;
  const ordered: TransferPositionPlanItem[] = positions.map((p) => ({
    bankAddress: p.bankAddress,
    side: p.side,
    uiAmount: p.uiAmount,
    initUsdValue: p.initUsdValue,
  }));
  for (let k = 1; k <= ordered.length; k++) {
    const candidate = ordered.slice(0, k);
    if (!fitsInTx(candidate, 0)) break;
    maxPositions = k;
    const { size, accountCount } = measure(candidate, 0);
    bytesAtLimit = size;
    locksAtLimit = accountCount;
  }

  return { maxPositions, bytesAtLimit, locksAtLimit };
}

function destPreexistingBanksOf(
  account: MarginfiAccountType | undefined,
  bankMap: Map<string, BankType>
): BankType[] {
  if (!account) return [];
  return dedupeBanks(
    account.balances
      .filter((b) => b.active)
      .map((b) => bankMap.get(b.bankPk.toBase58()))
      .filter((b): b is BankType => Boolean(b))
  );
}

// --------------------------------------------------------------------------------------
// Public: build the transfer
// --------------------------------------------------------------------------------------

/**
 * Atomically move a selected set of positions from account A to account B using flashloans, split
 * across as many transactions as needed. Returns unsigned transactions ordered for sequential
 * execution (setup/crank first, then the flashloan txs); the caller signs and sends them.
 *
 * Supported asset tags: `DEFAULT`/`SOL`/`STAKED` on either leg, and the collateral-only integrations
 * `KAMINO`/`JUPLEND` on the collateral leg (they move via their dedicated withdraw/deposit builders
 * with a preceding reserve/rate refresh). `DRIFT`/`SOLEND` are rejected.
 *
 * Runtime notes:
 *  - Each borrow-before-repay transiently spikes the debt bank's rate-limit window; a bank near its
 *    cap can still revert (`BankHourly/DailyRateLimitExceeded`) — treat that as retryable.
 *  - Integration (Kamino/JupLend) reserve/rate refresh rides in the prelude transactions. Across a
 *    multi-transaction transfer the later flashloans read state refreshed a few slots earlier; the
 *    drift is interest-only and does not fail the CPI, but requires `bankMetadataMap` to carry fresh
 *    `kaminoStates`/`jupLendStates` and is worth an on-chain smoke test for integration-heavy splits.
 *  - All transactions share one blockhash; execute them in order within its validity window.
 *  - Dust (borrow padding minus accrued interest; withdraw-all/cToken-conversion excess) remains in
 *    the wallet ATAs.
 */
export async function makeTransferPositionsTx(
  params: MakeTransferPositionsTxParams
): Promise<TransferPositionsResult> {
  const {
    program,
    connection,
    marginfiAccount: accountA,
    bankMap,
    bankMetadataMap,
    oraclePrices,
    assetShareValueMultiplierByBank,
    addressLookupTableAccounts,
    crossbarUrl,
    overrideInferAccounts,
  } = params;

  const luts = addressLookupTableAccounts ?? [];
  const borrowPaddingBps = params.borrowPaddingBps ?? DEFAULT_BORROW_PADDING_BPS;
  const groupRateLimiterEnabled = params.groupRateLimiterEnabled ?? false;

  const { positions, marginUsd } = classifyAndPrice(params);

  // Reject transfers that would trip a debt bank's rate-limit window.
  precheckBankRateLimits(positions, borrowPaddingBps);

  const bankOf = new Map<string, ClassifiedPosition>();
  for (const p of positions) bankOf.set(p.bankAddress.toBase58(), p);

  // Resolve / create the destination account.
  let accountB = params.destinationAccount;
  let createIx: TransactionInstruction | undefined;
  if (!accountB) {
    const accountIndex =
      params.createDestinationOpts?.accountIndex ??
      (await findRandomAvailableAccountIndex(
        connection,
        program.programId,
        accountA.group,
        accountA.authority
      ));
    const created = await makeCreateAccountIxWithProjection({
      program,
      authority: accountA.authority,
      group: accountA.group,
      accountIndex,
      thirdPartyId: params.createDestinationOpts?.thirdPartyId,
    });
    accountB = created.account;
    createIx = created.ix;
  }

  const ctx: BuildContext = {
    program,
    accountA,
    accountB,
    bankMap,
    bankMetadataMap,
    assetShareValueMultiplierByBank,
    borrowPaddingBps,
    groupRateLimiterEnabled,
    overrideInferAccounts,
    destPreexistingBanks: destPreexistingBanksOf(params.destinationAccount, bankMap),
  };

  // Plan the split (conservative size probe drives `fitsInTx`).
  const { fitsInTx } = await buildProbe({ ctx, positions, createIx, luts });
  const epsilonUsd =
    params.boundaryEpsilonUsd !== undefined
      ? new BigNumber(params.boundaryEpsilonUsd)
      : BigNumber.max(new BigNumber("0.01"), marginUsd.times(0.0001));
  const bundles = planTransferBundles({
    positions: positions.map((p) => ({
      bankAddress: p.bankAddress,
      side: p.side,
      uiAmount: p.uiAmount,
      initUsdValue: p.initUsdValue,
    })),
    marginUsd,
    epsilonUsd,
    fitsInTx,
  });

  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  // Build each bundle's flashloan tx, threading the cumulative transferred set for endFL(A) metas.
  const originalActiveBanksA = accountA.balances.filter((b) => b.active).map((b) => b.bankPk);
  const transferred = new Set<string>();
  const flashloanTxs: ExtendedV0Transaction[] = [];
  const allInnerIxs: TransactionInstruction[] = [];

  for (let i = 0; i < bundles.length; i++) {
    const bundle = bundles[i];
    for (const p of bundle.positions) transferred.add(p.bankAddress.toBase58());

    const innerIxs = await buildBundleInnerIxs(ctx, bundle.positions, bankOf, false);
    allInnerIxs.push(...innerIxs);

    const projectedActiveBanksA = dedupeBanks(
      originalActiveBanksA
        .filter((pk) => !transferred.has(pk.toBase58()))
        .map((pk) => requireBank(bankMap, pk))
    );

    const preIxs = i === 0 && createIx ? [createIx] : [];
    const tx = await buildTransferFlashloanTx({
      program,
      accountA,
      projectedActiveBanksA,
      innerIxs,
      preIxs,
      blockhash,
      luts,
    });

    const size = getTxSize(tx);
    const keys = getTotalAccountKeys(tx);
    if (size > MAX_TX_SIZE || keys > MAX_ACCOUNT_LOCKS) {
      throw TransactionBuildingError.transferPositionsUnsplittable(
        `built transaction exceeds size limits (${size} bytes, ${keys} accounts)`,
        marginUsd.toString(),
        bundle.cumulativeNetMovedUsd.toString()
      );
    }
    flashloanTxs.push(tx);
  }

  // Setup ATAs for every transferred mint, then refresh integration reserves/rates. Both must land
  // before the flashloans (the withdraw legs send to these ATAs and read the refreshed state).
  const setupIxs = await makeSetupIx({
    connection,
    authority: accountA.authority,
    tokens: positions.map((p) => ({ mint: p.bank.mint, tokenProgram: p.tokenProgram })),
  });
  const refreshIxs = buildIntegrationRefreshIxs({
    accountA,
    destinationAccount: params.destinationAccount,
    positions,
    bankMap,
    bankMetadataMap,
  });

  const additionalTxs: ExtendedV0Transaction[] = [];
  const preludeIxs = [...setupIxs, ...refreshIxs];
  if (preludeIxs.length > 0) {
    const txs = splitInstructionsToFitTransactions([], preludeIxs, {
      blockhash,
      payerKey: accountA.authority,
      luts,
    });
    additionalTxs.push(
      ...txs.map((tx) =>
        addTransactionMetadata(tx, { type: TransactionType.CREATE_ATA, addressLookupTables: luts })
      )
    );
  }

  // Crank switchboard feeds for the banks priced by the endFL health checks.
  const { instructions: updateFeedIxs, luts: feedLuts } = await makeSmartCrankSwbFeedIx({
    marginfiAccount: accountA,
    bankMap,
    oraclePrices,
    assetShareValueMultiplierByBank,
    instructions: allInnerIxs,
    program,
    connection,
    crossbarUrl,
  });
  if (updateFeedIxs.length > 0) {
    const message = new TransactionMessage({
      payerKey: accountA.authority,
      recentBlockhash: blockhash,
      instructions: updateFeedIxs,
    }).compileToV0Message(feedLuts);
    additionalTxs.push(
      addTransactionMetadata(new VersionedTransaction(message), {
        addressLookupTables: feedLuts,
        type: TransactionType.CRANK,
      })
    );
  }

  const transactions = [...additionalTxs, ...flashloanTxs];
  return {
    transactions,
    actionTxIndex: additionalTxs.length,
    destinationAccount: accountB,
    bundles,
  };
}
