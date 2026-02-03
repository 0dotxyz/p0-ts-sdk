import BigNumber from "bignumber.js";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { BorshInstructionCoder } from "@coral-xyz/anchor";

import { BankType, getAssetShares, getLiabilityShares, AssetTag } from "~/services/bank";
import { MarginfiProgram } from "~/types";
import { composeRemainingAccounts } from "~/utils";

import { BalanceType } from "../../types";

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
 * @param balances - Current account balances
 * @param banksMap - Map of bank addresses to bank data
 * @param mandatoryBanks - Banks that must be included (e.g., for pending transactions)
 * @param excludedBanks - Banks to exclude from health checks
 * @returns Array of bank objects to include in health check
 *
 * @example
 * ```typescript
 * const healthCheckBanks = computeHealthCheckAccounts(
 *   account.balances,
 *   banksMap,
 *   [newBankToDeposit], // Mandatory: not active yet but will be
 *   [closingBank]       // Excluded: being closed in this transaction
 * );
 * ```
 */
export function computeHealthCheckAccounts(
  balances: BalanceType[],
  banksMap: Map<string, BankType>,
  mandatoryBanks: PublicKey[] = [],
  excludedBanks: PublicKey[] = []
): BankType[] {
  const activeBalances = balances.filter((b) => b.active);

  const mandatoryBanksSet = new Set(mandatoryBanks.map((b) => b.toBase58()));
  const excludedBanksSet = new Set(excludedBanks.map((b) => b.toBase58()));
  const activeBanks = new Set(activeBalances.map((b) => b.bankPk.toBase58()));
  const banksToAdd = new Set([...mandatoryBanksSet].filter((x) => !activeBanks.has(x)));

  let slotsToKeep = banksToAdd.size;
  const projectedActiveBanks = balances
    .filter((balance) => {
      if (balance.active) {
        return !excludedBanksSet.has(balance.bankPk.toBase58());
      } else if (slotsToKeep > 0) {
        slotsToKeep--;
        return true;
      } else {
        return false;
      }
    })
    .map((balance) => {
      if (balance.active) {
        const bank = banksMap.get(balance.bankPk.toBase58());
        if (!bank) throw Error(`Bank ${balance.bankPk.toBase58()} not found`);
        return bank;
      }
      const newBankAddress = [...banksToAdd.values()][0]!;
      banksToAdd.delete(newBankAddress);
      const bank = banksMap.get(newBankAddress);
      if (!bank) throw Error(`Bank ${newBankAddress} not found`);
      return bank;
    });

  return projectedActiveBanks;
}

/**
 * Converts bank objects to health check account metas (public keys).
 *
 * This function generates the list of account public keys needed for health check
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
 * @returns Flattened array of public keys for health check accounts
 *
 * @example
 * ```typescript
 * const healthAccounts = computeHealthAccountMetas(
 *   [usdcBank, solBank, kaminoUsdcBank],
 *   true // Enable sorting for optimal transaction size
 * );
 * // Returns: [bank1, oracle1, bank2, oracle2, bank3, oracle3, kaminoReserve3, ...]
 * ```
 */
export function computeHealthAccountMetas(
  banksToInclude: BankType[],
  enableSorting = true
): PublicKey[] {
  let wrapperFn = enableSorting
    ? composeRemainingAccounts
    : (banksAndOracles: PublicKey[][]) => banksAndOracles.flat();

  const accounts = wrapperFn(
    banksToInclude.map((bank) => {
      let keys = [];
      if (bank.oracleKey.equals(PublicKey.default)) {
        keys = [bank.address];
      } else {
        keys = [bank.address, bank.oracleKey];
      }

      // for kamino banks, include kamino reserve
      if (bank.config.assetTag === AssetTag.KAMINO) {
        if (!bank.kaminoIntegrationAccounts) {
          console.warn("Reserve for kamino bank not found ", bank.address.toBase58());
        } else {
          keys.push(bank.kaminoIntegrationAccounts.kaminoReserve);
        }
      }

      if (bank.config.assetTag === AssetTag.DRIFT) {
        if (!bank.driftIntegrationAccounts) {
          console.warn("Drift spot market for drift bank not found ", bank.address.toBase58());
        } else {
          keys.push(bank.driftIntegrationAccounts.driftSpotMarket);
        }
      }

      return keys;
    })
  );

  return accounts;
}

/**
 * Projects which banks will be active after a series of instructions execute.
 *
 * This function simulates instruction execution to determine which bank positions
 * will be active (non-zero) after the transaction completes. It's used to optimize
 * health check account inclusion by predicting which banks are relevant.
 *
 * **Note**: This does NOT simulate Cross-Program Invocations (CPI). Only direct
 * marginfi instructions are considered.
 *
 * Supported instructions:
 * - Deposits: `lendingAccountDeposit`, `kaminoDeposit`, `driftDeposit`, `solendDeposit`
 * - Borrows: `lendingAccountBorrow`
 * - Repays: `lendingAccountRepay`
 * - Withdrawals: `lendingAccountWithdraw`, `kaminoWithdraw`, `driftWithdraw`, `solendWithdraw`
 *
 * @param balances - Current account balances
 * @param instructions - Instructions to simulate
 * @param program - Marginfi program for instruction decoding
 * @returns Array of bank public keys that will be active after instruction execution
 *
 * @example
 * ```typescript
 * const projectedBanks = computeProjectedActiveBanksNoCpi(
 *   account.balances,
 *   [depositIx, borrowIx],
 *   marginfiProgram
 * );
 * // Use projectedBanks for health check account selection
 * ```
 */
export function computeProjectedActiveBanksNoCpi(
  balances: BalanceType[],
  instructions: TransactionInstruction[],
  program: MarginfiProgram
): PublicKey[] {
  let projectedBalances = [...balances.map((b) => ({ active: b.active, bankPk: b.bankPk }))];

  for (let index = 0; index < instructions.length; index++) {
    const ix = instructions[index];

    if (!ix?.programId.equals(program.programId)) continue;

    const borshCoder = new BorshInstructionCoder(program.idl);
    const decoded = borshCoder.decode(ix.data, "base58");
    if (!decoded) continue;

    const ixArgs = decoded.data as any;

    switch (decoded.name) {
      case "lendingAccountBorrow":
      case "kaminoDeposit":
      case "driftDeposit":
      case "solendDeposit":
      case "lendingAccountDeposit": {
        const targetBank = new PublicKey(ix?.keys[3]!.pubkey);
        const targetBalance = projectedBalances.find((b) => b.bankPk.equals(targetBank));
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
      case "lendingAccountRepay":
      case "kaminoWithdraw":
      case "driftWithdraw":
      case "solendWithdraw":
      case "lendingAccountWithdraw": {
        const targetBank = new PublicKey(ix.keys[3]!.pubkey);
        const targetBalance = projectedBalances.find((b) => b.bankPk.equals(targetBank));
        if (!targetBalance) {
          throw Error(
            `Balance for bank ${targetBank.toBase58()} should be projected active at this point (ix ${index}: ${
              decoded.name
            }))`
          );
        }

        if (ixArgs.repayAll || ixArgs.withdrawAll) {
          targetBalance.active = false;
          targetBalance.bankPk = PublicKey.default;
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

/**
 * Computes projected balances after applying a series of instructions.
 *
 * Simulates how deposit/borrow/repay/withdraw instructions would change the account balances,
 * including both active/inactive state AND actual share amounts. This is more comprehensive
 * than `computeProjectedActiveBanksNoCpi` which only tracks active banks.
 *
 * **Note**: This does NOT simulate Cross-Program Invocations (CPI). Only direct
 * marginfi instructions are considered.
 *
 * **Integrated Protocols**: For Kamino/Drift deposits, the `assetShareValueMultiplierByBank`
 * is used to convert cToken amounts to actual asset quantities before computing shares.
 *
 * @param balances - Current account balances
 * @param instructions - Instructions to simulate
 * @param program - Marginfi program for instruction decoding
 * @param banksMap - Map of bank addresses to bank data (needed for share value conversion)
 * @param assetShareValueMultiplierByBank - Multipliers for integrated protocols (Kamino, Drift)
 * @returns Object containing projected balances and lists of impacted banks
 * @returns projectedBalances - Balance array after instruction simulation
 * @returns impactedAssetsBanks - Bank addresses where asset shares changed
 * @returns impactedLiabilityBanks - Bank addresses where liability shares changed
 *
 * @example
 * ```typescript
 * const result = computeProjectedActiveBalancesNoCpi(
 *   account.balances,
 *   [depositIx, borrowIx],
 *   marginfiProgram,
 *   banksMap,
 *   { [driftBankAddress]: driftMultiplier }
 * );
 * console.log(`Projected ${result.projectedBalances.length} balances`);
 * console.log(`Impacted ${result.impactedAssetsBanks.length} asset banks`);
 * ```
 */
export function computeProjectedActiveBalancesNoCpi(
  balances: BalanceType[],
  instructions: TransactionInstruction[],
  program: MarginfiProgram,
  banksMap: Map<string, BankType>,
  assetShareValueMultiplierByBank: Map<string, BigNumber>
): {
  projectedBalances: BalanceType[];
  impactedAssetsBanks: string[];
  impactedLiabilityBanks: string[];
} {
  // Deep clone all balances to avoid mutating original
  let projectedBalances: BalanceType[] = balances.map((b) => ({
    active: b.active,
    bankPk: b.bankPk,
    assetShares: new BigNumber(b.assetShares),
    liabilityShares: new BigNumber(b.liabilityShares),
    emissionsOutstanding: new BigNumber(b.emissionsOutstanding),
    lastUpdate: b.lastUpdate,
  }));

  const impactedAssetsBanks = new Set<string>();
  const impactedLiabilityBanks = new Set<string>();

  for (let index = 0; index < instructions.length; index++) {
    const ix = instructions[index];

    // Skip non-marginfi instructions
    if (!ix?.programId.equals(program.programId)) continue;

    const borshCoder = new BorshInstructionCoder(program.idl);
    const decoded = borshCoder.decode(ix.data, "base58");
    if (!decoded) continue;

    const ixArgs = decoded.data as any;

    switch (decoded.name) {
      // Instructions that open or add to a position
      case "lendingAccountDeposit":
      case "driftDeposit":
      case "solendDeposit":
      case "kaminoDeposit": {
        // Bank is at index 3 for these instructions (group, account, authority, bank, ...)
        const targetBank = new PublicKey(ix.keys[3]!.pubkey);
        impactedAssetsBanks.add(targetBank.toBase58());

        let targetBalance = projectedBalances.find((b) => b.bankPk.equals(targetBank));

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
        const depositTokenAmount = new BigNumber(ixArgs.amount?.toString() || "0");
        const bank = banksMap.get(targetBank.toBase58());
        if (!bank) {
          throw Error(`Bank ${targetBank.toBase58()} not found in bankMap`);
        }

        const assetShareValueMultiplier =
          assetShareValueMultiplierByBank.get(targetBank.toBase58()) ?? BigNumber(1);

        // For integrated protocols: convert underlying token amount to cToken amount
        // For regular banks: multiplier is 1, so this is a no-op
        const cTokenAmount = depositTokenAmount.div(assetShareValueMultiplier);

        // Convert cToken amount to shares using bank's share value
        const depositShares = getAssetShares(bank, cTokenAmount);
        targetBalance.assetShares = targetBalance.assetShares.plus(depositShares);
        break;
      }

      case "lendingAccountBorrow": {
        const targetBank = new PublicKey(ix.keys[3]!.pubkey);
        impactedLiabilityBanks.add(targetBank.toBase58());

        let targetBalance = projectedBalances.find((b) => b.bankPk.equals(targetBank));

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
        const borrowTokenAmount = new BigNumber(ixArgs.amount?.toString() || "0");
        const bank = banksMap.get(targetBank.toBase58());
        if (!bank) {
          throw Error(`Bank ${targetBank.toBase58()} not found in bankMap`);
        }
        const borrowShares = getLiabilityShares(bank, borrowTokenAmount);
        targetBalance.liabilityShares = targetBalance.liabilityShares.plus(borrowShares);
        break;
      }

      // Instructions that reduce or close positions
      case "lendingAccountRepay": {
        const targetBank = new PublicKey(ix.keys[3]!.pubkey);
        impactedLiabilityBanks.add(targetBank.toBase58());

        const targetBalance = projectedBalances.find((b) => b.bankPk.equals(targetBank));

        if (!targetBalance) {
          throw Error(
            `Balance for bank ${targetBank.toBase58()} should be projected active at this point (ix ${index}: ${
              decoded.name
            }))`
          );
        }

        // Check if this is a full repay
        if (ixArgs.repayAll) {
          targetBalance.liabilityShares = new BigNumber(0);

          // If no assets and no liabilities, close the balance
          if (targetBalance.assetShares.eq(0)) {
            targetBalance.active = false;
            targetBalance.bankPk = PublicKey.default;
          }
        } else {
          // Convert token amount to shares and subtract from liability shares
          const repayTokenAmount = new BigNumber(ixArgs.amount?.toString() || "0");
          const bank = banksMap.get(targetBank.toBase58());
          if (!bank) {
            throw Error(`Bank ${targetBank.toBase58()} not found in bankMap`);
          }
          const repayShares = getLiabilityShares(bank, repayTokenAmount);
          targetBalance.liabilityShares = BigNumber.max(
            0,
            targetBalance.liabilityShares.minus(repayShares)
          );

          // If fully repaid and no assets, close the balance
          if (targetBalance.liabilityShares.eq(0) && targetBalance.assetShares.eq(0)) {
            targetBalance.active = false;
            targetBalance.bankPk = PublicKey.default;
          }
        }
        break;
      }

      case "lendingAccountWithdraw":
      case "driftWithdraw":
      case "solendWithdraw":
      case "kaminoWithdraw": {
        const targetBank = new PublicKey(ix.keys[3]!.pubkey);
        impactedAssetsBanks.add(targetBank.toBase58());

        const targetBalance = projectedBalances.find((b) => b.bankPk.equals(targetBank));

        if (!targetBalance) {
          throw Error(
            `Balance for bank ${targetBank.toBase58()} should be projected active at this point (ix ${index}: ${
              decoded.name
            }))`
          );
        }

        // Check if this is a full withdraw
        if (ixArgs.withdrawAll) {
          targetBalance.assetShares = new BigNumber(0);

          // If no assets and no liabilities, close the balance
          if (targetBalance.liabilityShares.eq(0)) {
            targetBalance.active = false;
            targetBalance.bankPk = PublicKey.default;
          }
        } else {
          const withdrawTokenAmount = new BigNumber(ixArgs.amount?.toString() || "0");
          const bank = banksMap.get(targetBank.toBase58());
          if (!bank) {
            throw Error(`Bank ${targetBank.toBase58()} not found in bankMap`);
          }
          // You always withdraw in collateral token so no multiplier needed to convert liquidity token to collateral token
          const withdrawShares = getAssetShares(bank, withdrawTokenAmount);
          targetBalance.assetShares = BigNumber.max(
            0,
            targetBalance.assetShares.minus(withdrawShares)
          );

          // If fully withdrawn and no liabilities, close the balance
          if (targetBalance.assetShares.eq(0) && targetBalance.liabilityShares.eq(0)) {
            targetBalance.active = false;
            targetBalance.bankPk = PublicKey.default;
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
  };
}
