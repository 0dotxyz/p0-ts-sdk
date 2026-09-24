import { unwrapOption, type Address, type Instruction, type Option } from "@solana/kit";
import BigNumber from "bignumber.js";

import { BalanceType, MarginfiAccountType } from "../../types";

import { DEFAULT_ADDRESS } from "~/constants";
import { MarginfiInstruction, parseMarginfiIx } from "~/instructions";
import { AssetTag, BankType, OracleSetup } from "~/services/bank/types";
import {
  getAssetShares,
  getLiabilityShares,
} from "~/services/bank/utils/compute/share-conversions.utils";
import { composeRemainingAccounts } from "~/utils";

/**
 * Transaction Projection & Health Check Utilities
 * ===============================================
 */

/**
 * Computes the set of banks to include in health check account metas.
 *
 * This function determines which banks should be included when performing health checks
 * by considering active balances, mandatory banks, and exclusions. It intelligently
 * manages the 16-balance limit by:
 * - Including all active banks (excluding any in the exclusion list)
 * - Reserving inactive slots for mandatory banks that aren't currently active
 *
 * @param account - The marginfi account whose balances are evaluated
 * @param banksMap - Map of bank addresses to bank data
 * @param mandatoryBanks - Banks that must be included (e.g., for pending transactions)
 * @param excludedBanks - Banks to exclude from health checks
 * @returns Array of bank objects to include in health check
 *
 * @example
 * ```typescript
 * const healthCheckBanks = computeHealthCheckAccounts({
 *   account,
 *   banksMap,
 *   mandatoryBanks: [newBankToDeposit], // Not active yet but will be
 *   excludedBanks: [closingBank],       // Being closed in this transaction
 * });
 * ```
 */
export function computeHealthCheckAccounts({
  account,
  banksMap,
  mandatoryBanks = [],
  excludedBanks = [],
}: {
  account: MarginfiAccountType;
  banksMap: Map<string, BankType>;
  mandatoryBanks?: Address[];
  excludedBanks?: Address[];
}): BankType[] {
  const balances = account.balances;
  const activeBalances = balances.filter((b) => b.active);

  const mandatoryBanksSet = new Set(mandatoryBanks);
  const excludedBanksSet = new Set(excludedBanks);
  const activeBanks = new Set(activeBalances.map((b) => b.bankPk));
  const banksToAdd = new Set([...mandatoryBanksSet].filter((x) => !activeBanks.has(x)));

  let slotsToKeep = banksToAdd.size;
  const projectedActiveBanks = balances
    .filter((balance) => {
      if (balance.active) {
        return !excludedBanksSet.has(balance.bankPk);
      } else if (slotsToKeep > 0) {
        slotsToKeep--;
        return true;
      } else {
        return false;
      }
    })
    .map((balance) => {
      if (balance.active) {
        const bank = banksMap.get(balance.bankPk);
        if (!bank) throw Error(`Bank ${balance.bankPk} not found`);
        return bank;
      }
      const newBankAddress = [...banksToAdd.values()][0];
      banksToAdd.delete(newBankAddress);
      const bank = banksMap.get(newBankAddress);
      if (!bank) throw Error(`Bank ${newBankAddress} not found`);
      return bank;
    });

  return projectedActiveBanks;
}

/**
 * Converts bank objects to health check account metas (addresses).
 *
 * This function generates the list of account addresses needed for health check
 * instructions. For each bank, it includes:
 * - The bank address
 * - The oracle address (if not default)
 * - Additional integration accounts:
 *   - Kamino: kamino reserve account
 *   - Drift: drift spot market account
 *
 * Optionally sorts accounts using `composeRemainingAccounts` to optimize transaction size.
 *
 * @param banksToInclude - Array of banks to include in health check
 * @param enableSorting - Whether to sort/optimize account order (default: true)
 * @param trailingBanks - Banks whose accounts are appended unsorted after the health pack
 *   (e.g., the withdrawn bank on withdraw-all, for the 1.9 rate-limiter price fetch)
 * @returns Flattened array of addresses for health check accounts
 *
 * @example
 * ```typescript
 * const healthAccounts = computeHealthAccountMetas({
 *   banksToInclude: [usdcBank, solBank, kaminoUsdcBank],
 * });
 * // Returns: [bank1, oracle1, bank2, oracle2, bank3, oracle3, kaminoReserve3, ...]
 * ```
 */
export function computeHealthAccountMetas({
  banksToInclude,
  enableSorting = true,
  trailingBanks = [],
}: {
  banksToInclude: BankType[];
  enableSorting?: boolean;
  trailingBanks?: BankType[];
}): Address[] {
  const wrapperFn = enableSorting
    ? composeRemainingAccounts
    : (banksAndOracles: Address[][]) => banksAndOracles.flat();

  const accounts = wrapperFn(banksToInclude.map(computeBankRiskAccountKeys));

  // Trailing banks are appended AFTER the sorted health pack so the risk engine's strict
  // in-order matching of active balances never consumes them (unconsumed trailing accounts
  // are ignored by both the 1.8 and 1.9 programs). Used for withdraw-all: the withdrawn
  // bank's balance is closed by the instruction so it must not sit inside the health pack,
  // but the 1.9 rate-limiter/receivership price fetch searches the whole slice for the
  // bank key followed by its oracle accounts.
  for (const bank of trailingBanks) {
    accounts.push(...computeBankRiskAccountKeys(bank));
  }

  return accounts;
}

/**
 * Builds the ordered account keys the program expects for a single bank in a risk/health
 * remaining-accounts slice: bank, oracle, then per-asset-tag extras.
 */
function computeBankRiskAccountKeys(bank: BankType): Address[] {
  let keys = [];
  if (bank.oracleKey === DEFAULT_ADDRESS) {
    keys = [bank.address];
  } else {
    keys = [bank.address, bank.oracleKey];
  }

  if (
    bank.config.assetTag === AssetTag.KAMINO ||
    bank.config.assetTag === AssetTag.DRIFT ||
    bank.config.assetTag === AssetTag.SOLEND ||
    bank.config.assetTag === AssetTag.JUPLEND
  ) {
    keys.push(bank.config.oracleKeys[1]);
  }

  // The program computes these setups' price from an extra on-chain account (Marinade State /
  // SPL stake pool / Exponent vault), so that account must be included in the bank's
  // health-check accounts. Plain banks store it in oracleKeys[1]; the Kamino/Juplend variants
  // keep their venue account in oracleKeys[1] (pushed by the assetTag branch above) and store
  // the pricing account in oracleKeys[2].
  switch (bank.config.oracleSetup) {
    case OracleSetup.PythMSOL:
    case OracleSetup.PythLST:
    case OracleSetup.PTPyth:
      keys.push(bank.config.oracleKeys[1]);
      break;
    case OracleSetup.KaminoMSOL:
    case OracleSetup.JuplendMSOL:
    case OracleSetup.KaminoLST:
    case OracleSetup.JuplendLST:
      keys.push(bank.config.oracleKeys[2]);
      break;
  }

  if (bank.config.assetTag === AssetTag.STAKED) {
    keys.push(bank.config.oracleKeys[1], bank.config.oracleKeys[2]);
    // 0.1.9 SVSP transition: the 1.9 program requires the pool's on-ramp as a 4th staked
    // risk account, read from oracle_keys[3] (written by the permissionless backfill and by
    // add_pool_permissionless for new banks).
    const onrampKey = bank.config.oracleKeys[3];
    if (onrampKey !== DEFAULT_ADDRESS) {
      keys.push(onrampKey);
    }
  }

  return keys;
}

/**
 * Projects which banks will be active after a series of instructions execute.
 *
 * This function simulates instruction execution to determine which bank positions
 * will be active (non-zero) after the transaction completes. It's used to optimize
 * health check account inclusion by predicting which banks are relevant.
 *
 * **Note**: This does NOT simulate Cross-Program Invocations (CPI). Only direct
 * marginfi instructions are considered. Instructions operating on a different
 * marginfi account than `account` are ignored.
 *
 * Supported instructions:
 * - Deposits: `lendingAccountDeposit`, `kaminoDeposit`, `driftDeposit`, `solendDeposit`
 * - Borrows: `lendingAccountBorrow`
 * - Repays: `lendingAccountRepay`
 * - Withdrawals: `lendingAccountWithdraw`, `kaminoWithdraw`, `driftWithdraw`, `solendWithdraw`
 *
 * @param account - The marginfi account whose balances are projected
 * @param instructions - Instructions to simulate
 * @param programAddress - Marginfi program address; other programs' instructions are ignored
 * @returns Array of bank addresses that will be active after instruction execution
 *
 * @example
 * ```typescript
 * const projectedBanks = computeProjectedActiveBanksNoCpi({
 *   account,
 *   instructions: [depositIx, borrowIx],
 *   programAddress,
 * });
 * // Use projectedBanks for health check account selection
 * ```
 */
export function computeProjectedActiveBanksNoCpi({
  account,
  instructions,
  programAddress,
}: {
  account: MarginfiAccountType;
  instructions: Instruction[];
  programAddress: Address;
}): Address[] {
  const projectedBalances = [
    ...account.balances.map((b) => ({ active: b.active, bankPk: b.bankPk })),
  ];

  for (let index = 0; index < instructions.length; index++) {
    const ix = instructions[index];

    if (ix.programAddress !== programAddress) continue;

    const parsed = parseMarginfiIx(ix);
    if (!parsed) continue;

    switch (parsed.instructionType) {
      case MarginfiInstruction.LendingAccountBorrow:
      case MarginfiInstruction.KaminoDeposit:
      case MarginfiInstruction.DriftDeposit:
      case MarginfiInstruction.SolendDeposit:
      case MarginfiInstruction.LendingAccountDeposit:
      case MarginfiInstruction.JuplendDeposit: {
        // Skip instructions operating on a different marginfi account — e.g. transfer flows
        // build ixs for two accounts in one set.
        if (parsed.accounts.marginfiAccount.address !== account.address) continue;

        const targetBank = parsed.accounts.bank.address;
        const targetBalance = projectedBalances.find((b) => b.bankPk === targetBank);
        if (!targetBalance) {
          const firstInactiveBalanceIndex = projectedBalances.findIndex((b) => !b.active);
          if (firstInactiveBalanceIndex === -1 || !projectedBalances[firstInactiveBalanceIndex]) {
            throw Error("No inactive balance found");
          }

          projectedBalances[firstInactiveBalanceIndex].active = true;
          projectedBalances[firstInactiveBalanceIndex].bankPk = targetBank;
        }
        break;
      }
      case MarginfiInstruction.LendingAccountRepay:
      case MarginfiInstruction.KaminoWithdraw:
      case MarginfiInstruction.DriftWithdraw:
      case MarginfiInstruction.SolendWithdraw:
      case MarginfiInstruction.LendingAccountWithdraw:
      case MarginfiInstruction.JuplendWithdraw: {
        if (parsed.accounts.marginfiAccount.address !== account.address) continue;

        const targetBank = parsed.accounts.bank.address;
        const targetBalance = projectedBalances.find((b) => b.bankPk === targetBank);
        if (!targetBalance) {
          throw Error(
            `Balance for bank ${targetBank} should be projected active at this point (ix ${index}: ${
              MarginfiInstruction[parsed.instructionType]
            }))`
          );
        }

        if (closesPosition(parsed.data)) {
          targetBalance.active = false;
          targetBalance.bankPk = DEFAULT_ADDRESS;
        }
        break;
      }
      default: {
        continue;
      }
    }
  }

  return projectedBalances.filter((b) => b.active).map((b) => b.bankPk);
}

// kaminoWithdraw packs withdraw-all as bit 0 of its `flags` arg since 0.1.9
function closesPosition(
  data: { repayAll: Option<boolean> } | { withdrawAll: Option<boolean> } | { flags: Option<number> }
): boolean {
  if ("repayAll" in data) return unwrapOption(data.repayAll) === true;
  if ("withdrawAll" in data) return unwrapOption(data.withdrawAll) === true;
  return ((unwrapOption(data.flags) ?? 0) & 1) > 0;
}

/**
 * Computes projected balances after applying a series of instructions.
 *
 * Simulates how deposit/borrow/repay/withdraw instructions would change the account balances,
 * including both active/inactive state AND actual share amounts. This is more comprehensive
 * than `computeProjectedActiveBanksNoCpi` which only tracks active banks.
 *
 * **Note**: This does NOT simulate Cross-Program Invocations (CPI). Only direct
 * marginfi instructions are considered. Instructions operating on a different
 * marginfi account than `account` are ignored.
 *
 * **Integrated Protocols**: For Kamino/Drift deposits, the `assetShareValueMultiplierByBank`
 * is used to convert cToken amounts to actual asset quantities before computing shares.
 *
 * @param account - The marginfi account whose balances are projected
 * @param instructions - Instructions to simulate
 * @param programAddress - Marginfi program address; other programs' instructions are ignored
 * @param banksMap - Map of bank addresses to bank data (needed for share value conversion)
 * @param assetShareValueMultiplierByBank - Multipliers for integrated protocols (Kamino, Drift)
 * @returns Object containing projected balances and lists of impacted banks
 * @returns projectedBalances - Balance array after instruction simulation
 * @returns impactedAssetsBanks - Bank addresses where asset shares changed
 * @returns impactedLiabilityBanks - Bank addresses where liability shares changed
 *
 * @example
 * ```typescript
 * const result = computeProjectedActiveBalancesNoCpi({
 *   account,
 *   instructions: [depositIx, borrowIx],
 *   programAddress,
 *   banksMap,
 *   assetShareValueMultiplierByBank,
 * });
 * console.log(`Projected ${result.projectedBalances.length} balances`);
 * console.log(`Impacted ${result.impactedAssetsBanks.length} asset banks`);
 * ```
 */
export function computeProjectedActiveBalancesNoCpi({
  account,
  instructions,
  programAddress,
  banksMap,
  assetShareValueMultiplierByBank,
}: {
  account: MarginfiAccountType;
  instructions: Instruction[];
  programAddress: Address;
  banksMap: Map<string, BankType>;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
}): {
  projectedBalances: BalanceType[];
  impactedAssetsBanks: string[];
  impactedLiabilityBanks: string[];
  /**
   * Banks targeted by a withdraw instruction (partial or final). When the group
   * rate limiter is enabled, the program requires a fresh oracle for these banks
   * in the withdraw's remaining accounts — even if the position closes.
   */
  withdrawnBanks: string[];
} {
  // Deep clone all balances to avoid mutating original
  const projectedBalances: BalanceType[] = account.balances.map((b) => ({
    active: b.active,
    bankPk: b.bankPk,
    assetShares: new BigNumber(b.assetShares),
    liabilityShares: new BigNumber(b.liabilityShares),
    emissionsOutstanding: new BigNumber(b.emissionsOutstanding),
    lastUpdate: b.lastUpdate,
  }));

  const impactedAssetsBanks = new Set<string>();
  const impactedLiabilityBanks = new Set<string>();
  const withdrawnBanks = new Set<string>();

  for (let index = 0; index < instructions.length; index++) {
    const ix = instructions[index];

    // Skip non-marginfi instructions
    if (ix.programAddress !== programAddress) continue;

    const parsed = parseMarginfiIx(ix);
    if (!parsed) continue;

    switch (parsed.instructionType) {
      // Instructions that open or add to a position
      case MarginfiInstruction.LendingAccountDeposit:
      case MarginfiInstruction.DriftDeposit:
      case MarginfiInstruction.SolendDeposit:
      case MarginfiInstruction.KaminoDeposit:
      case MarginfiInstruction.JuplendDeposit: {
        // Skip instructions operating on a different marginfi account — e.g. transfer flows
        // build ixs for two accounts in one set.
        if (parsed.accounts.marginfiAccount.address !== account.address) continue;

        const targetBank = parsed.accounts.bank.address;
        impactedAssetsBanks.add(targetBank);

        let targetBalance = projectedBalances.find((b) => b.bankPk === targetBank);

        if (!targetBalance) {
          // Need to activate a new balance slot
          const firstInactiveBalanceIndex = projectedBalances.findIndex((b) => !b.active);

          if (firstInactiveBalanceIndex === -1 || !projectedBalances[firstInactiveBalanceIndex]) {
            throw Error("No inactive balance found");
          }

          targetBalance = projectedBalances[firstInactiveBalanceIndex];
          targetBalance.active = true;
          targetBalance.bankPk = targetBank;
          targetBalance.assetShares = new BigNumber(0);
          targetBalance.liabilityShares = new BigNumber(0);
        }

        // Convert token amount to shares and add to asset shares
        const depositTokenAmount = new BigNumber(parsed.data.amount.toString());
        const bank = banksMap.get(targetBank);
        if (!bank) {
          throw Error(`Bank ${targetBank} not found in bankMap`);
        }

        const assetShareValueMultiplier =
          assetShareValueMultiplierByBank.get(targetBank) ?? BigNumber(1);

        // For integrated protocols: convert underlying token amount to cToken amount
        // For regular banks: multiplier is 1, so this is a no-op
        const cTokenAmount = depositTokenAmount.div(assetShareValueMultiplier);

        // Convert cToken amount to shares using bank's share value
        const depositShares = getAssetShares(bank, cTokenAmount);
        targetBalance.assetShares = targetBalance.assetShares.plus(depositShares);
        break;
      }

      case MarginfiInstruction.LendingAccountBorrow: {
        if (parsed.accounts.marginfiAccount.address !== account.address) continue;

        const targetBank = parsed.accounts.bank.address;
        impactedLiabilityBanks.add(targetBank);

        let targetBalance = projectedBalances.find((b) => b.bankPk === targetBank);

        if (!targetBalance) {
          // Need to activate a new balance slot
          const firstInactiveBalanceIndex = projectedBalances.findIndex((b) => !b.active);

          if (firstInactiveBalanceIndex === -1 || !projectedBalances[firstInactiveBalanceIndex]) {
            throw Error("No inactive balance found");
          }

          targetBalance = projectedBalances[firstInactiveBalanceIndex];
          targetBalance.active = true;
          targetBalance.bankPk = targetBank;
          targetBalance.assetShares = new BigNumber(0);
          targetBalance.liabilityShares = new BigNumber(0);
        }

        // Convert token amount to shares and add to liability shares
        const borrowTokenAmount = new BigNumber(parsed.data.amount.toString());
        const bank = banksMap.get(targetBank);
        if (!bank) {
          throw Error(`Bank ${targetBank} not found in bankMap`);
        }
        const borrowShares = getLiabilityShares(bank, borrowTokenAmount);
        targetBalance.liabilityShares = targetBalance.liabilityShares.plus(borrowShares);
        break;
      }

      // Instructions that reduce or close positions
      case MarginfiInstruction.LendingAccountRepay: {
        if (parsed.accounts.marginfiAccount.address !== account.address) continue;

        const targetBank = parsed.accounts.bank.address;
        impactedLiabilityBanks.add(targetBank);

        const targetBalance = projectedBalances.find((b) => b.bankPk === targetBank);

        if (!targetBalance) {
          throw Error(
            `Balance for bank ${targetBank} should be projected active at this point (ix ${index}: ${
              MarginfiInstruction[parsed.instructionType]
            }))`
          );
        }

        // Check if this is a full repay
        if (closesPosition(parsed.data)) {
          targetBalance.liabilityShares = new BigNumber(0);

          // If no assets and no liabilities, close the balance
          if (targetBalance.assetShares.eq(0)) {
            targetBalance.active = false;
            targetBalance.bankPk = DEFAULT_ADDRESS;
          }
        } else {
          // Convert token amount to shares and subtract from liability shares
          const repayTokenAmount = new BigNumber(parsed.data.amount.toString());
          const bank = banksMap.get(targetBank);
          if (!bank) {
            throw Error(`Bank ${targetBank} not found in bankMap`);
          }
          const repayShares = getLiabilityShares(bank, repayTokenAmount);
          targetBalance.liabilityShares = BigNumber.max(
            0,
            targetBalance.liabilityShares.minus(repayShares)
          );

          // If fully repaid and no assets, close the balance
          if (targetBalance.liabilityShares.eq(0) && targetBalance.assetShares.eq(0)) {
            targetBalance.active = false;
            targetBalance.bankPk = DEFAULT_ADDRESS;
          }
        }
        break;
      }

      case MarginfiInstruction.LendingAccountWithdraw:
      case MarginfiInstruction.DriftWithdraw:
      case MarginfiInstruction.SolendWithdraw:
      case MarginfiInstruction.KaminoWithdraw:
      case MarginfiInstruction.JuplendWithdraw: {
        if (parsed.accounts.marginfiAccount.address !== account.address) continue;

        const targetBank = parsed.accounts.bank.address;
        impactedAssetsBanks.add(targetBank);
        withdrawnBanks.add(targetBank);

        const targetBalance = projectedBalances.find((b) => b.bankPk === targetBank);

        if (!targetBalance) {
          throw Error(
            `Balance for bank ${targetBank} should be projected active at this point (ix ${index}: ${
              MarginfiInstruction[parsed.instructionType]
            }))`
          );
        }

        // Check if this is a full withdraw
        if (closesPosition(parsed.data)) {
          targetBalance.assetShares = new BigNumber(0);

          // If no assets and no liabilities, close the balance
          if (targetBalance.liabilityShares.eq(0)) {
            targetBalance.active = false;
            targetBalance.bankPk = DEFAULT_ADDRESS;
          }
        } else {
          const withdrawTokenAmount = new BigNumber(parsed.data.amount.toString());
          const bank = banksMap.get(targetBank);
          if (!bank) {
            throw Error(`Bank ${targetBank} not found in bankMap`);
          }
          // Per-venue amount semantics:
          // - kaminoWithdraw: amount is already in cToken units → no multiplier
          // - lendingAccountWithdraw / driftWithdraw / solendWithdraw / juplendWithdraw:
          //   amount is in underlying units → divide by multiplier to get cToken units
          //   (multiplier is 1 for regular banks, ≠ 1 for drift / juplend integrations)
          const isKaminoWithdraw = parsed.instructionType === MarginfiInstruction.KaminoWithdraw;
          const assetShareValueMultiplier = isKaminoWithdraw
            ? new BigNumber(1)
            : (assetShareValueMultiplierByBank.get(targetBank) ?? new BigNumber(1));
          const cTokenAmount = withdrawTokenAmount.div(assetShareValueMultiplier);
          const withdrawShares = getAssetShares(bank, cTokenAmount);
          targetBalance.assetShares = BigNumber.max(
            0,
            targetBalance.assetShares.minus(withdrawShares)
          );

          // If fully withdrawn and no liabilities, close the balance
          if (targetBalance.assetShares.eq(0) && targetBalance.liabilityShares.eq(0)) {
            targetBalance.active = false;
            targetBalance.bankPk = DEFAULT_ADDRESS;
          }
        }
        break;
      }

      default: {
        // Ignore other instructions
        continue;
      }
    }
  }

  return {
    projectedBalances,
    impactedAssetsBanks: Array.from(impactedAssetsBanks),
    impactedLiabilityBanks: Array.from(impactedLiabilityBanks),
    withdrawnBanks: Array.from(withdrawnBanks),
  };
}
