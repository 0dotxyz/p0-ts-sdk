import { BigNumber } from "bignumber.js";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { AssetTag, BankType, RiskTier } from "~/services/bank";
import {
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

import {
  MakeTransferPositionsTxParams,
  TransferPositionSide,
  TransferPositionsResult,
} from "../types";
import { MarginfiAccountType } from "../types/account.types";
import { computeHealthAccountMetas, computeQuantityUi } from "../utils";
import { findRandomAvailableAccountIndex } from "../utils/fetch.utils";

import { makeWithdrawIx, makeKaminoWithdrawIx, makeJuplendWithdrawIx } from "./withdraw";
import { makeDepositIx, makeKaminoDepositIx, makeJuplendDepositIx } from "./deposit";
import { makeBorrowIx } from "./borrow";
import { makeRepayIx } from "./repay";
import { makeBeginFlashLoanIx, makeEndFlashLoanIx } from "./flash-loan";
import { makeCreateAccountIxWithProjection, makeSetupIx } from "./account-lifecycle";

/** Fixed marginfi balance slots per account. */
const MAX_BALANCES = 16;

/** Default hard cap on positions moved in one transfer. Keeps the whole transfer inside one tx. */
const DEFAULT_MAX_TRANSFER_POSITIONS = 5;

const DEFAULT_BORROW_PADDING_BPS = 10;

const CU_IXS = () => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
];

// --------------------------------------------------------------------------------------
// Classification
// --------------------------------------------------------------------------------------

export interface ClassifiedPosition {
  bankAddress: PublicKey;
  side: TransferPositionSide;
  /** UI amount of the position (collateral: withdrawn from A / deposited to B; debt: repaid on A). */
  uiAmount: BigNumber;
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
 * Validate the selection, infer each position's side, and resolve its UI amount. Correctness of the
 * transfer itself (both accounts staying healthy) is enforced on-chain by the flashloan's end health
 * check on A and each borrow's health check on B — so no client-side health/USD math is needed.
 */
export function classifyAndValidate(params: MakeTransferPositionsTxParams): ClassifiedPosition[] {
  const {
    marginfiAccount: accountA,
    destinationAccount: accountB,
    bankAddresses,
    bankMap,
    tokenProgramsByBank,
    assetShareValueMultiplierByBank,
  } = params;

  const maxPositions = params.maxPositions ?? DEFAULT_MAX_TRANSFER_POSITIONS;

  if (bankAddresses.length === 0) {
    throw TransactionBuildingError.transferPositionsInvalidSelection("no positions selected", []);
  }
  if (bankAddresses.length > maxPositions) {
    throw TransactionBuildingError.transferPositionsInvalidSelection(
      `cannot transfer ${bankAddresses.length} positions in one transaction (max ${maxPositions}); select fewer and transfer in batches`,
      bankAddresses.map((b) => b.toBase58())
    );
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

    const side: TransferPositionSide = balance.assetShares.gt(0) ? "collateral" : "debt";
    const multiplier = assetShareValueMultiplierByBank.get(bankAddress.toBase58());
    const qty = computeQuantityUi(balance, bank, multiplier);

    positions.push({
      bankAddress,
      side,
      uiAmount: side === "collateral" ? qty.assets : qty.liabilities,
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
    const destHasLiabilities = (accountB?.balances ?? []).some(
      (b) => b.active && b.liabilityShares.gt(0)
    );
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

  return positions;
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
 * Following the swap-collateral / repay-with-collateral precedent these ride in a transaction that
 * precedes the flashloan rather than inside it: the builders return no signer keys, and keeping them
 * out of the flashloan preserves its byte/lock budget.
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
  // Adding an integration means adding one branch above, nothing elsewhere.
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
 * Build the flashloan's inner instructions for the whole selection:
 *   [cu…, withdraws(A)…, deposits(B)…, borrows(B)…, repays(A)…]
 * All deposits precede all borrows so every intermediate destination state is healthier than the
 * transaction-final one. Withdraws and repays carry no health accounts (A is inside the flashloan);
 * withdraws only gain the withdrawn bank's oracle when the group limiter is enabled. Each borrow
 * carries the destination's health pack for its banks active at that point.
 */
async function buildInnerIxs(
  ctx: BuildContext,
  positions: ClassifiedPosition[],
  isSync: boolean
): Promise<TransactionInstruction[]> {
  const collateral = positions.filter((p) => p.side === "collateral");
  const debts = positions.filter((p) => p.side === "debt");
  const collateralBanks = collateral.map((p) => p.bank);

  const withdrawIxs: TransactionInstruction[] = [];
  const depositIxs: TransactionInstruction[] = [];
  const borrowIxs: TransactionInstruction[] = [];
  const repayIxs: TransactionInstruction[] = [];

  for (const position of collateral) {
    // A is flagged: no health pack. Group off ⇒ no oracle either. Group on ⇒ trailing bank oracle.
    const observationBanksOverride = ctx.groupRateLimiterEnabled
      ? computeHealthAccountMetas([], true, [position.bank])
      : [];

    const legs = await buildCollateralLegIxs(ctx, position, isSync, observationBanksOverride);
    withdrawIxs.push(...legs.withdrawIxs);
    depositIxs.push(...legs.depositIxs);
  }

  // Klend re-marks an obligation stale on EVERY mutation, and marginfi's Kamino
  // obligations are bank-level (pooled) — so a transferred Kamino bank's
  // withdraw leg invalidates the refresh that preceded it, and the deposit leg
  // on the same obligation then fails with ObligationStale (6017). Re-refresh
  // the transferred Kamino banks' reserves + obligations between the two legs.
  const transferredKaminoPks = collateral
    .filter((p) => p.bank.config.assetTag === AssetTag.KAMINO)
    .map((p) => p.bankAddress);
  const kaminoReRefreshIxs =
    transferredKaminoPks.length > 0
      ? makeRefreshKaminoBanksIxs(
          ctx.accountA,
          ctx.bankMap,
          transferredKaminoPks,
          ctx.bankMetadataMap
        ).instructions
      : [];

  const borrowedSoFar: BankType[] = [];
  for (const position of debts) {
    const { bank, tokenProgram } = position;
    borrowedSoFar.push(bank);

    // Destination banks active at this borrow: pre-existing + all collateral + debts so far.
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

  return [
    ...CU_IXS(),
    ...withdrawIxs,
    ...kaminoReRefreshIxs,
    ...depositIxs,
    ...borrowIxs,
    ...repayIxs,
  ];
}

/**
 * Wrap the inner instructions in a single flashloan on the source account.
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
 * Atomically move a selected set of positions from account A to account B in a single flashloan.
 * Per position: collateral → `withdraw(A)` + `deposit(B)`; debt → `borrow(B)` + `repay(A)`. Returns
 * unsigned transactions ordered for sequential execution (setup/refresh + crank first, then the
 * flashloan); the caller signs and sends them.
 *
 * The whole transfer must fit one v0 transaction — the selection is capped at `maxPositions`
 * (default 5), and the built flashloan is size-checked, throwing `TRANSFER_POSITIONS_UNSPLITTABLE`
 * if it still overflows (possible with several integration positions). Transfer larger sets in
 * batches. Correctness (both accounts staying healthy) is enforced on-chain: `endFL(A)` checks A's
 * remainder and each `borrow(B)` checks B — no client-side health prediction.
 *
 * Supported asset tags: `DEFAULT`/`SOL`/`STAKED` on either leg, and the collateral-only integrations
 * `KAMINO`/`JUPLEND` on the collateral leg (dedicated builders + a preceding reserve/rate refresh).
 * `DRIFT`/`SOLEND` are rejected.
 *
 * Runtime notes:
 *  - Each borrow-before-repay transiently spikes the debt bank's rate-limit window; a bank near its
 *    cap can revert with `BankHourly/DailyRateLimitExceeded`. The whole flashloan reverts atomically,
 *    so this is safe and retryable — treat it as such.
 *  - Integration (Kamino/JupLend) reserve/rate refresh rides in the prelude transaction and requires
 *    `bankMetadataMap` to carry fresh `kaminoStates`/`jupLendStates`.
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

  const positions = classifyAndValidate(params);

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

  const innerIxs = await buildInnerIxs(ctx, positions, false);

  // endFL(A) health pack: A's remaining active banks after the whole selection leaves.
  const transferred = new Set(positions.map((p) => p.bankAddress.toBase58()));
  const projectedActiveBanksA = dedupeBanks(
    accountA.balances
      .filter((b) => b.active && !transferred.has(b.bankPk.toBase58()))
      .map((b) => requireBank(bankMap, b.bankPk))
  );

  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  const preIxs = createIx ? [createIx] : [];
  const flashloanTx = await buildTransferFlashloanTx({
    program,
    accountA,
    projectedActiveBanksA,
    innerIxs,
    preIxs,
    blockhash,
    luts,
  });

  const size = getTxSize(flashloanTx);
  const keys = getTotalAccountKeys(flashloanTx);
  if (size > MAX_TX_SIZE || keys > MAX_ACCOUNT_LOCKS) {
    throw TransactionBuildingError.transferPositionsUnsplittable(
      `built transaction exceeds size limits (${size} bytes, ${keys} accounts); transfer fewer positions`,
      size,
      keys
    );
  }

  // Setup ATAs for every transferred mint, then refresh integration reserves/rates. Both must land
  // before the flashloan (the withdraw legs send to these ATAs and read the refreshed state).
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

  // Crank switchboard feeds for the banks priced by the endFL health check.
  const { instructions: updateFeedIxs, luts: feedLuts } = await makeSmartCrankSwbFeedIx({
    marginfiAccount: accountA,
    bankMap,
    oraclePrices,
    assetShareValueMultiplierByBank,
    instructions: innerIxs,
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

  const transactions = [...additionalTxs, flashloanTx];
  return {
    transactions,
    actionTxIndex: additionalTxs.length,
    destinationAccount: accountB,
  };
}
