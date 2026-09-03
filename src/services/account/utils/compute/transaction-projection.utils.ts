import { BorshInstructionCoder } from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { BalanceType, MarginfiAccountType } from "../../types";

import {
  BankType,
  getAssetShares,
  getLiabilityShares,
  AssetTag,
  OracleSetup,
} from "~/services/bank";
import { MarginfiProgram } from "~/types";
import { composeRemainingAccounts } from "~/utils";
import { findPoolAddress, findPoolOnRampAddress } from "~/vendor/single-spl-pool";

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
  mandatoryBanks?: PublicKey[];
  excludedBanks?: PublicKey[];
}): BankType[] {
  const balances = account.balances;
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
      const newBankAddress = [...banksToAdd.values()][0];
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
 * @param trailingBanks - Banks whose accounts are appended unsorted after the health pack
 *   (e.g., the withdrawn bank on withdraw-all, for the 1.9 rate-limiter price fetch)
 * @returns Flattened array of public keys for health check accounts
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
}): PublicKey[] {
  const wrapperFn = enableSorting
    ? composeRemainingAccounts
    : (banksAndOracles: PublicKey[][]) => banksAndOracles.flat();

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
function computeBankRiskAccountKeys(bank: BankType): PublicKey[] {
  let keys = [];
  if (bank.oracleKey.equals(PublicKey.default)) {
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
    // risk account. The canonical source is oracle_keys[3], written by the permissionless
    // backfill (and by add_pool_permissionless for new banks) — nothing writes it on 1.8,
    // so a non-default key implies 1.9 is live. If the on-ramp pricing flag (bank flags
    // bit 10) is set before the key is backfilled, the program derives the on-ramp from
    // the validator vote account, so we do the same as a fallback.
    const onrampKey = bank.config.oracleKeys[3];
    if (onrampKey && !onrampKey.equals(PublicKey.default)) {
      keys.push(onrampKey);
    } else if (
      bank.stakedOracleUsesOnramp &&
      bank.stakedIntegrationAccounts &&
      !bank.stakedIntegrationAccounts.validatorVoteAccount.equals(PublicKey.default)
    ) {
      const pool = findPoolAddress(bank.stakedIntegrationAccounts.validatorVoteAccount);
      keys.push(findPoolOnRampAddress(pool));
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
 * @param program - Marginfi program for instruction decoding
 * @returns Array of bank public keys that will be active after instruction execution
 *
 * @example
 * ```typescript
 * const projectedBanks = computeProjectedActiveBanksNoCpi({
 *   account,
 *   instructions: [depositIx, borrowIx],
 *   program: marginfiProgram,
 * });
 * // Use projectedBanks for health check account selection
 * ```
 */
export function computeProjectedActiveBanksNoCpi({
  account,
  instructions,
  program,
}: {
  account: MarginfiAccountType;
  instructions: TransactionInstruction[];
  program: MarginfiProgram;
}): PublicKey[] {
  const projectedBalances = [
    ...account.balances.map((b) => ({ active: b.active, bankPk: b.bankPk })),
  ];

  for (let index = 0; index < instructions.length; index++) {
    const ix = instructions[index];

    if (!ix?.programId.equals(program.programId)) continue;

    const borshCoder = new BorshInstructionCoder(program.idl);
    const decoded = borshCoder.decode(ix.data, "base58");
    if (!decoded) continue;

    // All handled instructions share the account layout (group, marginfiAccount,
    // authority, bank, ...). Skip instructions operating on a different marginfi
    // account — e.g. transfer flows build ixs for two accounts in one set.
    const ixMarginfiAccount = ix.keys[1]?.pubkey;
    if (!ixMarginfiAccount?.equals(account.address)) continue;

    const ixArgs = decoded.data as any;

    switch (decoded.name) {
      case "lendingAccountBorrow":
      case "kaminoDeposit":
      case "driftDeposit":
      case "solendDeposit":
      case "lendingAccountDeposit":
      case "juplendDeposit": {
        const targetBank = new PublicKey(ix?.keys[3].pubkey);
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
      case "lendingAccountWithdraw":
      case "juplendWithdraw": {
        const targetBank = new PublicKey(ix.keys[3].pubkey);
        const targetBalance = projectedBalances.find((b) => b.bankPk.equals(targetBank));
        if (!targetBalance) {
          throw Error(
            `Balance for bank ${targetBank.toBase58()} should be projected active at this point (ix ${index}: ${
              decoded.name
            }))`
          );
        }

        // kaminoWithdraw packs withdraw-all as bit 0 of its `flags` arg since 0.1.9
        const isKaminoWithdrawAll =
          decoded.name === "kaminoWithdraw" && ((ixArgs.flags ?? 0) & 1) > 0;
        if (ixArgs.repayAll || ixArgs.withdrawAll || isKaminoWithdrawAll) {
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
 * marginfi instructions are considered. Instructions operating on a different
 * marginfi account than `account` are ignored.
 *
 * **Integrated Protocols**: For Kamino/Drift deposits, the `assetShareValueMultiplierByBank`
 * is used to convert cToken amounts to actual asset quantities before computing shares.
 *
 * @param account - The marginfi account whose balances are projected
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
 * const result = computeProjectedActiveBalancesNoCpi({
 *   account,
 *   instructions: [depositIx, borrowIx],
 *   program: marginfiProgram,
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
  program,
  banksMap,
  assetShareValueMultiplierByBank,
}: {
  account: MarginfiAccountType;
  instructions: TransactionInstruction[];
  program: MarginfiProgram;
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
    tag: b.tag,
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
    if (!ix?.programId.equals(program.programId)) continue;

    const borshCoder = new BorshInstructionCoder(program.idl);
    const decoded = borshCoder.decode(ix.data, "base58");
    if (!decoded) continue;

    // All handled instructions share the account layout (group, marginfiAccount,
    // authority, bank, ...). Skip instructions operating on a different marginfi
    // account — e.g. transfer flows build ixs for two accounts in one set.
    const ixMarginfiAccount = ix.keys[1]?.pubkey;
    if (!ixMarginfiAccount?.equals(account.address)) continue;

    const ixArgs = decoded.data as any;

    switch (decoded.name) {
      // Instructions that open or add to a position
      case "lendingAccountDeposit":
      case "driftDeposit":
      case "solendDeposit":
      case "kaminoDeposit":
      case "juplendDeposit": {
        // Bank is at index 3 for these instructions (group, account, authority, bank, ...)
        const targetBank = new PublicKey(ix.keys[3].pubkey);
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
        const targetBank = new PublicKey(ix.keys[3].pubkey);
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
        const targetBank = new PublicKey(ix.keys[3].pubkey);
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
      case "kaminoWithdraw":
      case "juplendWithdraw": {
        const targetBank = new PublicKey(ix.keys[3].pubkey);
        impactedAssetsBanks.add(targetBank.toBase58());
        withdrawnBanks.add(targetBank.toBase58());

        const targetBalance = projectedBalances.find((b) => b.bankPk.equals(targetBank));

        if (!targetBalance) {
          throw Error(
            `Balance for bank ${targetBank.toBase58()} should be projected active at this point (ix ${index}: ${
              decoded.name
            }))`
          );
        }

        // Check if this is a full withdraw
        // (kaminoWithdraw packs withdraw-all as bit 0 of its `flags` arg since 0.1.9)
        const isWithdrawAll =
          decoded.name === "kaminoWithdraw"
            ? ((ixArgs.flags ?? 0) & 1) > 0
            : Boolean(ixArgs.withdrawAll);
        if (isWithdrawAll) {
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
          // Per-venue amount semantics:
          // - kaminoWithdraw: amount is already in cToken units → no multiplier
          // - lendingAccountWithdraw / driftWithdraw / solendWithdraw / juplendWithdraw:
          //   amount is in underlying units → divide by multiplier to get cToken units
          //   (multiplier is 1 for regular banks, ≠ 1 for drift / juplend integrations)
          const isKaminoWithdraw = decoded.name === "kaminoWithdraw";
          const assetShareValueMultiplier = isKaminoWithdraw
            ? new BigNumber(1)
            : (assetShareValueMultiplierByBank.get(targetBank.toBase58()) ?? new BigNumber(1));
          const cTokenAmount = withdrawTokenAmount.div(assetShareValueMultiplier);
          const withdrawShares = getAssetShares(bank, cTokenAmount);
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
    withdrawnBanks: Array.from(withdrawnBanks),
  };
}
