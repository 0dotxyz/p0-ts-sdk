import {
  getTransactionMessageSizeLimit,
  type Address,
  type BlockhashLifetimeConstraint,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { BigNumber } from "bignumber.js";

import {
  MakeTransferPositionsTxParams,
  TransferPositionSide,
  TransferPositionsResult,
} from "../types";
import { MarginfiAccountType } from "../types/account.types";
import { computeQuantityUi, isCostlyBank } from "../utils";
import { findRandomAvailableAccountIndex } from "../utils/fetch.utils";

import { makeCreateAccountIxWithProjection, makeCreateMissingAtaIxs } from "./account-lifecycle";
import { makeBorrowIx } from "./borrow";
import { makeDepositIx } from "./deposit";
import { makeBeginFlashLoanIx, makeEndFlashLoanIx } from "./flash-loan";
import { makeRepayIx } from "./repay";
import { makeWithdrawIx } from "./withdraw";

import { MAX_ACCOUNT_LOCKS, MAX_BALANCES, MAX_COSTLY_POSITIONS } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import { AssetTag, BankType, RiskTier, requireBank, requireTokenProgram } from "~/services/bank";
import { makeRefreshKaminoBanksIxs, makeUpdateJupLendRateIxs } from "~/services/price";
import {
  getTotalAccountKeys,
  getTxSize,
  makePreludeTxs,
  makeTransactionMessage,
  SolanaTransaction,
  TransactionFormat,
  TransactionType,
} from "~/services/transaction";
import { BankIntegrationMetadataMap } from "~/types";

/** Default hard cap on positions moved in one transfer. Keeps the whole transfer inside one tx. */
const DEFAULT_MAX_TRANSFER_POSITIONS = 5;

const DEFAULT_BORROW_PADDING_BPS = 10;

const CU_IXS = () => [
  getSetComputeUnitLimitInstruction({ units: 1_400_000 }),
  getSetComputeUnitPriceInstruction({ microLamports: 1 }),
];

// --------------------------------------------------------------------------------------
// Classification
// --------------------------------------------------------------------------------------

export interface ClassifiedPosition {
  bankAddress: Address;
  side: TransferPositionSide;
  /** UI amount of the position (collateral: withdrawn from A / deposited to B; debt: repaid on A). */
  uiAmount: BigNumber;
  bank: BankType;
  tokenProgram: Address;
}

/** Shared lookups, thrown as INVALID_SELECTION so the copy stays user-facing. */
const invalidSelection =
  (address: Address) =>
  (message: string): Error =>
    TransactionBuildingError.transferPositionsInvalidSelection(message, [address]);

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
      bankAddresses
    );
  }

  const activeBalancesA = accountA.balances.filter((b) => b.active);
  const positions: ClassifiedPosition[] = [];

  for (const bankAddress of bankAddresses) {
    const bank = requireBank(bankMap, bankAddress, invalidSelection(bankAddress));
    const tokenProgram = requireTokenProgram(
      tokenProgramsByBank,
      bankAddress,
      invalidSelection(bankAddress)
    );

    const balance = activeBalancesA.find((b) => b.bankPk === bankAddress);
    if (!balance) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        `source account has no active position in bank ${bankAddress}`,
        [bankAddress]
      );
    }

    const side: TransferPositionSide = balance.assetShares.gt(0) ? "collateral" : "debt";
    const multiplier = assetShareValueMultiplierByBank.get(bankAddress);
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
        isolatedDebts.map((p) => p.bankAddress)
      );
    }
  }

  // Destination account validation.
  if (accountB) {
    if (accountB.group !== accountA.group) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        "destination account is in a different group",
        [accountB.address]
      );
    }
    if (accountB.authority !== accountA.authority) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        "destination account has a different authority",
        [accountB.address]
      );
    }
    const overlap = positions.filter((p) =>
      accountB.balances.some((b) => b.active && b.bankPk === p.bankAddress)
    );
    if (overlap.length > 0) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        "destination account already holds a position in a transferred bank",
        overlap.map((p) => p.bankAddress)
      );
    }
    const activeCountB = accountB.balances.filter((b) => b.active).length;
    if (activeCountB + positions.length > MAX_BALANCES) {
      throw TransactionBuildingError.transferPositionsInvalidSelection(
        `destination account cannot hold ${activeCountB + positions.length} positions (max ${MAX_BALANCES})`,
        positions.map((p) => p.bankAddress)
      );
    }
  }

  const costlyCountB =
    destPreexistingBanksOf(accountB, bankMap).filter(isCostlyBank).length +
    positions.filter((p) => p.side === "collateral" && isCostlyBank(p.bank)).length;
  if (costlyCountB > MAX_COSTLY_POSITIONS) {
    throw TransactionBuildingError.transferPositionsInvalidSelection(
      `destination account cannot hold ${costlyCountB} integration and staked positions (max ${MAX_COSTLY_POSITIONS})`,
      positions.map((p) => p.bankAddress)
    );
  }

  return positions;
}

// --------------------------------------------------------------------------------------
// Integration reserve/rate refresh
// --------------------------------------------------------------------------------------

// Kamino has no self-refresh, so its reserves and the transferred banks' obligations are
// refreshed; JupLend deposits/withdraws refresh their own bank, so only the *other* JupLend banks in
// a health pack get a rate crank. These go in the prelude to keep the flashloan's byte budget.
function buildIntegrationRefreshIxs(args: {
  accountA: MarginfiAccountType;
  destinationAccount?: MarginfiAccountType;
  positions: ClassifiedPosition[];
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
}): Instruction[] {
  const { accountA, destinationAccount, positions, bankMap, bankMetadataMap } = args;

  const transferredKaminoPks = positions
    .filter((p) => p.bank.config.assetTag === AssetTag.KAMINO)
    .map((p) => p.bankAddress);
  const transferredJupPks = positions
    .filter((p) => p.bank.config.assetTag === AssetTag.JUPLEND)
    .map((p) => p.bankAddress);

  const ixs: Instruction[] = [];

  // Kamino: refresh reserves for the source's active Kamino banks (covers the transferred ones,
  // which are active on A) plus the obligations of the transferred banks.
  ixs.push(...makeRefreshKaminoBanksIxs(accountA, bankMap, transferredKaminoPks, bankMetadataMap));
  // A pre-existing destination may hold its own Kamino collateral read by each borrow's health pack.
  if (destinationAccount) {
    ixs.push(...makeRefreshKaminoBanksIxs(destinationAccount, bankMap, [], bankMetadataMap));
  }

  // JupLend: crank the rate on the source's *other* JupLend banks; transferred banks self-refresh
  // through their own withdraw (A) and deposit (B).
  ixs.push(...makeUpdateJupLendRateIxs(accountA, bankMap, transferredJupPks, bankMetadataMap));
  if (destinationAccount) {
    ixs.push(
      ...makeUpdateJupLendRateIxs(destinationAccount, bankMap, transferredJupPks, bankMetadataMap)
    );
  }

  return ixs;
}

// --------------------------------------------------------------------------------------
// Instruction assembly
// --------------------------------------------------------------------------------------

export interface BuildContext {
  programAddress: Address;
  /** The authority of both accounts. */
  authority: TransactionSigner;
  accountA: MarginfiAccountType;
  accountB: MarginfiAccountType;
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  borrowPaddingBps: number;
  groupRateLimiterEnabled: boolean;
  /** Banks the destination account already holds before the transfer starts. */
  destPreexistingBanks: BankType[];
}

/**
 * Build one collateral position's withdraw-from-A + deposit-into-B instructions. This is the single
 * place that defines which banks the action supports: `DEFAULT`/`SOL`/`STAKED` and the
 * `KAMINO`/`JUPLEND` integrations (whose builders read their reserve/vault state from
 * `bankMetadataMap`; the on-chain refresh those reads depend on is emitted separately in
 * `buildIntegrationRefreshIxs`); anything else throws `TRANSFER_POSITIONS_UNSUPPORTED_BANK`.
 *
 * The withdraw leg carries no health accounts (A is inside the flashloan) and appends the withdrawn
 * bank only when the group rate limiter is on. The deposit leg runs no health check, so it needs
 * none.
 */
export async function buildCollateralLegIxs(
  ctx: BuildContext,
  position: ClassifiedPosition
): Promise<{ withdrawIxs: Instruction[]; depositIxs: Instruction[] }> {
  const { bank, tokenProgram, uiAmount } = position;
  const tag = bank.config.assetTag;

  // DRIFT/SOLEND (or a future tag) have no collateral-leg support yet.
  if (
    ![AssetTag.DEFAULT, AssetTag.SOL, AssetTag.STAKED, AssetTag.KAMINO, AssetTag.JUPLEND].includes(
      tag
    )
  ) {
    throw TransactionBuildingError.transferPositionsUnsupportedBank(
      bank.address,
      tag,
      bank.tokenSymbol
    );
  }

  return {
    withdrawIxs: await makeWithdrawIx({
      programAddress: ctx.programAddress,
      bank,
      bankMap: ctx.bankMap,
      tokenProgram,
      amount: uiAmount,
      marginfiAccount: ctx.accountA,
      authority: ctx.authority,
      bankMetadataMap: ctx.bankMetadataMap,
      assetShareValueMultiplierByBank: ctx.assetShareValueMultiplierByBank,
      withdrawAll: true,
      opts: {
        createAta: false,
        unwrapSol: false,
        activeBanks: [],
        groupRateLimiterEnabled: ctx.groupRateLimiterEnabled,
      },
    }),
    depositIxs: await makeDepositIx({
      programAddress: ctx.programAddress,
      bank,
      tokenProgram,
      amount: uiAmount,
      marginfiAccount: ctx.accountB,
      authority: ctx.authority,
      bankMetadataMap: ctx.bankMetadataMap,
      opts: { wrapSol: false },
    }),
  };
}

// [compute budget, withdraws (A), deposits (B), borrows (B), repays (A)]: every deposit precedes
// every borrow, so each intermediate state of B is healthier than its final one. A is inside the
// flashloan, so its withdraws and repays carry no health accounts.
async function buildInnerIxs(
  ctx: BuildContext,
  positions: ClassifiedPosition[]
): Promise<Instruction[]> {
  const collateral = positions.filter((p) => p.side === "collateral");
  const debts = positions.filter((p) => p.side === "debt");
  const collateralBanks = collateral.map((p) => p.bank);

  const withdrawIxs: Instruction[] = [];
  const depositIxs: Instruction[] = [];
  const borrowIxs: Instruction[] = [];
  const repayIxs: Instruction[] = [];

  for (const position of collateral) {
    const legs = await buildCollateralLegIxs(ctx, position);
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
        )
      : [];

  const borrowedSoFar: BankType[] = [];
  for (const position of debts) {
    const { bank, tokenProgram } = position;
    borrowedSoFar.push(bank);

    // Destination banks active at this borrow: pre-existing + all collateral + debts so far.
    const activeBanks = [...ctx.destPreexistingBanks, ...collateralBanks, ...borrowedSoFar].map(
      (b) => b.address
    );

    const borrowUi = position.uiAmount.times(1 + ctx.borrowPaddingBps / 10_000);
    borrowIxs.push(
      ...(await makeBorrowIx({
        programAddress: ctx.programAddress,
        bank,
        bankMap: ctx.bankMap,
        tokenProgram,
        amount: borrowUi,
        marginfiAccount: ctx.accountB,
        authority: ctx.authority,
        opts: {
          createAta: false,
          unwrapSol: false,
          activeBanks,
        },
      }))
    );

    repayIxs.push(
      ...(await makeRepayIx({
        programAddress: ctx.programAddress,
        bank,
        tokenProgram,
        amount: position.uiAmount,
        marginfiAccount: ctx.accountA,
        authority: ctx.authority,
        repayAll: true,
        opts: {
          wrapSol: false,
        },
      }))
    );
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

// [preIxs, begin (A), inner, end (A)]: `makeFlashLoanTx` can't put instructions before begin
async function buildTransferFlashloanTx(args: {
  programAddress: Address;
  authority: TransactionSigner;
  accountA: MarginfiAccountType;
  bankMap: Map<string, BankType>;
  projectedActiveBanksA: Address[];
  innerIxs: Instruction[];
  preIxs: Instruction[];
  latestBlockhash: BlockhashLifetimeConstraint;
  txFormat: TransactionFormat;
}): Promise<SolanaTransaction> {
  const {
    programAddress,
    authority,
    accountA,
    bankMap,
    projectedActiveBanksA,
    innerIxs,
    preIxs,
    latestBlockhash,
    txFormat,
  } = args;

  const endIndex = preIxs.length + innerIxs.length + 1;
  const begin = await makeBeginFlashLoanIx({
    programAddress,
    marginfiAccount: accountA,
    authority,
    endIndex,
  });
  const end = await makeEndFlashLoanIx({
    programAddress,
    marginfiAccount: accountA,
    authority,
    bankMap,
    activeBanks: projectedActiveBanksA,
  });

  return {
    message: makeTransactionMessage({
      instructions: [...preIxs, begin, ...innerIxs, end],
      feePayer: authority,
      latestBlockhash,
      txFormat,
    }),
    type: TransactionType.FLASHLOAN,
  };
}

function destPreexistingBanksOf(
  account: MarginfiAccountType | undefined,
  bankMap: Map<string, BankType>
): BankType[] {
  if (!account) return [];
  return account.balances
    .filter((b) => b.active)
    .map((b) => requireBank(bankMap, b.bankPk, invalidSelection(b.bankPk)));
}

// --------------------------------------------------------------------------------------
// Public: build the transfer
// --------------------------------------------------------------------------------------

/**
 * Moves the positions in `bankAddresses` from `marginfiAccount` (A) to `destinationAccount` (B, or
 * a new account created in the same transaction) in one flashloan: collateral is withdrawn from A
 * and deposited into B; debt is borrowed on B and repaid on A. Both accounts' health is checked
 * on-chain. The selection is capped at `maxPositions` (default 5) so it fits one transaction;
 * transfer more in batches. Supports `DEFAULT`, `SOL` and `STAKED` banks, and `KAMINO` and
 * `JUPLEND` collateral. Dust from the borrow padding and withdraw-all stays in the wallet.
 *
 * Each borrow briefly adds to the debt bank's rate-limit window before its repay, so a bank near
 * its cap can revert with `BankHourly/DailyRateLimitExceeded`; the flashloan reverts atomically,
 * so retrying is safe.
 * @throws TransactionBuildingError (TRANSFER_POSITIONS_INVALID_SELECTION) if the selection or the
 * destination can't take the transfer
 * @throws TransactionBuildingError (TRANSFER_POSITIONS_UNSUPPORTED_BANK) if a collateral position
 * is in a Drift or Solend bank
 * @throws TransactionBuildingError (TRANSFER_POSITIONS_UNSPLITTABLE) if the flashloan doesn't fit
 * one transaction
 */
export async function makeTransferPositionsTx(
  params: MakeTransferPositionsTxParams
): Promise<TransferPositionsResult> {
  const {
    programAddress,
    authority,
    rpc,
    marginfiAccount: accountA,
    bankMap,
    bankMetadataMap,
    assetShareValueMultiplierByBank,
    txFormat,
  } = params;

  const borrowPaddingBps = params.borrowPaddingBps ?? DEFAULT_BORROW_PADDING_BPS;
  const groupRateLimiterEnabled = params.groupRateLimiterEnabled ?? true;

  const positions = classifyAndValidate(params);

  // Resolve / create the destination account.
  let accountB = params.destinationAccount;
  let createIx: Instruction | undefined;
  if (!accountB) {
    const accountIndex =
      params.createDestinationOpts?.accountIndex ??
      (await findRandomAvailableAccountIndex(
        rpc,
        programAddress,
        accountA.group,
        accountA.authority,
        params.createDestinationOpts?.thirdPartyId
      ));
    const created = await makeCreateAccountIxWithProjection({
      programAddress,
      authority,
      group: accountA.group,
      accountIndex,
      thirdPartyId: params.createDestinationOpts?.thirdPartyId,
    });
    accountB = created.account;
    createIx = created.ix;
  }

  const ctx: BuildContext = {
    programAddress,
    authority,
    accountA,
    accountB,
    bankMap,
    bankMetadataMap,
    assetShareValueMultiplierByBank,
    borrowPaddingBps,
    groupRateLimiterEnabled,
    destPreexistingBanks: destPreexistingBanksOf(params.destinationAccount, bankMap),
  };

  const innerIxs = await buildInnerIxs(ctx, positions);

  // endFL(A) health pack: A's remaining active banks after the whole selection leaves.
  const transferred = new Set(positions.map((p) => p.bankAddress));
  const projectedActiveBanksA = accountA.balances
    .filter((b) => b.active && !transferred.has(b.bankPk))
    .map((b) => requireBank(bankMap, b.bankPk, invalidSelection(b.bankPk)).address);

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const preIxs = createIx ? [createIx] : [];
  const flashloanTx = await buildTransferFlashloanTx({
    programAddress,
    authority,
    accountA,
    bankMap,
    projectedActiveBanksA,
    innerIxs,
    preIxs,
    latestBlockhash,
    txFormat,
  });

  const size = getTxSize(flashloanTx.message);
  const keys = getTotalAccountKeys(flashloanTx.message);
  if (size > getTransactionMessageSizeLimit(flashloanTx.message) || keys > MAX_ACCOUNT_LOCKS) {
    throw TransactionBuildingError.transferPositionsUnsplittable(
      `built transaction exceeds size limits (${size} bytes, ${keys} accounts); transfer fewer positions`,
      size,
      keys
    );
  }

  // Setup ATAs for every transferred mint, then refresh integration reserves/rates. Both must land
  // before the flashloan (the withdraw legs send to these ATAs and read the refreshed state).
  const setupIxs = await makeCreateMissingAtaIxs({
    rpc,
    authority,
    tokens: positions.map((p) => ({ mint: p.bank.mint, tokenProgram: p.tokenProgram })),
  });
  const refreshIxs = buildIntegrationRefreshIxs({
    accountA,
    destinationAccount: params.destinationAccount,
    positions,
    bankMap,
    bankMetadataMap,
  });

  const additionalTxs = makePreludeTxs(setupIxs, refreshIxs, {
    latestBlockhash,
    feePayer: authority,
    txFormat,
  });

  const transactions = [...additionalTxs, flashloanTx];
  return {
    transactions,
    actionTxIndex: additionalTxs.length,
    destinationAccount: accountB,
    mustBeAtomicBundle: refreshIxs.length > 0,
  };
}
