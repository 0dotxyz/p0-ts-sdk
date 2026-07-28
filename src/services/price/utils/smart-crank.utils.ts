import { PublicKey, TransactionInstruction, Connection } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { MarginfiProgram } from "~/types";
import { BankType, OracleSetup } from "~/services/bank";
import { MarginfiAccountType } from "~/services/account/types";
import {
  computeAssetHealthComponent,
  computeLiabilityHealthComponent,
  computeActiveEmodePairs,
  computeLowestEmodeWeights,
  getEmodePairs,
} from "~/services/account/utils";
import { computeProjectedActiveBalancesNoCpi, MarginRequirementType } from "~/services/account";

import { OraclePrice } from "../types";
import {
  checkMultipleOraclesCrankability,
  partitionBanksByCrankability,
} from "./crankability.utils";
import { getOracleSourceFromBank } from "./detection.utils";

/**
 * A combination of banks that need to be cranked
 */
export interface CrankCombination {
  banks: PublicKey[];
  oracleKeys: Array<{ key: PublicKey; price: OraclePrice }>; // Deduplicated oracle keys with prices that need to be cranked
  healthAfter: BigNumber;
}

/**
 * Parameters for smart crank calculation
 */
export interface SmartCrankParams {
  marginfiAccount: MarginfiAccountType;
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  instructions: TransactionInstruction[];
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  program: MarginfiProgram;
  connection?: Connection;
  crossbarUrl?: string;
  /**
   * Whether the group's net-outflow rate limiter is enabled (see
   * `isGroupRateLimiterEnabled(group.rateLimiter)`). While enabled, the program
   * requires a fresh oracle for every withdrawn bank in the withdraw instruction's
   * remaining accounts — including withdraw-all, where the bank drops out of the
   * health pack. When set, those oracles are always cranked and block if
   * uncrankable. Defaults to false (no behavior change).
   */
  groupRateLimiterEnabled?: boolean;
}

/**
 * Result of smart crank analysis
 */
export interface SmartCrankResult {
  requiredOracles: Array<{ key: PublicKey; price: OraclePrice }>;
  /** Banks with liabilities that cannot be cranked - BLOCKS ALL TRANSACTIONS */
  uncrankableLiabilities: Array<{ bank: BankType; reason: string }>;
  /** Banks with assets that cannot be cranked */
  uncrankableAssets: Array<{ bank: BankType; reason: string }>;
  isCrankable: boolean;
}

/**
 * Determines which oracles need to be cranked for a transaction to succeed.
 *
 * Algorithm:
 * 1. Parse instructions to determine projected active banks after transaction
 * 2. Check crankability of all relevant oracles
 * 3. If any liability oracle is uncrankable, throw error (transaction blocked)
 * 4. Identify required cranks (liabilities + interaction banks)
 * 5. Calculate health with only required banks cranked
 * 6. If healthy, return just required banks
 * 7. If not healthy, find minimal asset combinations to achieve health
 *
 * @param params - Smart crank parameters
 * @returns Smart crank result with ordered combinations
 */
export async function computeSmartCrank({
  marginfiAccount,
  bankMap,
  oraclePrices,
  instructions,
  program,
  connection,
  crossbarUrl,
  assetShareValueMultiplierByBank,
  groupRateLimiterEnabled = false,
}: SmartCrankParams): Promise<SmartCrankResult> {
  // Step 0: Determine projected active balances after transaction
  const { projectedBalances, withdrawnBanks } = computeProjectedActiveBalancesNoCpi({
    account: marginfiAccount,
    instructions,
    program,
    banksMap: bankMap,
    assetShareValueMultiplierByBank,
  });

  // Helper to check if bank is Switchboard
  const isSwitchboard = (bank: BankType) => getOracleSourceFromBank(bank).key === "switchboard";

  // While the group rate limiter is enabled, every withdraw (partial or final) needs a
  // fresh oracle for the withdrawn bank in remaining accounts — independent of health.
  // These oracles must always be cranked, and an uncrankable one blocks the transaction
  // outright (the on-chain price fetch would fail).
  const rateLimitBanks = groupRateLimiterEnabled
    ? withdrawnBanks
        .map((pk) => bankMap.get(pk))
        .filter((bank): bank is BankType => bank !== undefined)
        .filter(isSwitchboard)
    : [];

  let rateLimitOracles: Array<{ key: PublicKey; price: OraclePrice }> = [];
  let uncrankableRateLimitBanks: Array<{ bank: BankType; reason: string }> = [];
  if (rateLimitBanks.length > 0) {
    const rateLimitCrankability = await checkMultipleOraclesCrankability(
      rateLimitBanks,
      oraclePrices,
      connection,
      crossbarUrl
    );
    const partitioned = partitionBanksByCrankability(rateLimitBanks, rateLimitCrankability);
    uncrankableRateLimitBanks = partitioned.uncrankable.map(({ bank, reason }) => ({
      bank,
      reason: `Rate-limited withdraw requires a fresh oracle: ${reason}`,
    }));
    const seenOracles = new Set<string>();
    rateLimitOracles = partitioned.crankable
      .map((bank) => ({
        key: bank.oracleKey,
        price: oraclePrices.get(bank.address.toBase58()),
      }))
      .filter((o): o is { key: PublicKey; price: OraclePrice } => o.price !== undefined)
      .filter((o) => {
        const key = o.key.toBase58();
        if (seenOracles.has(key)) return false;
        seenOracles.add(key);
        return true;
      });
  }

  /** Merges rate-limit oracle requirements into a result, forcing a block if any are uncrankable */
  const withRateLimitCranks = (result: SmartCrankResult): SmartCrankResult => {
    if (rateLimitBanks.length === 0) return result;
    const existingKeys = new Set(result.requiredOracles.map((o) => o.key.toBase58()));
    return {
      ...result,
      requiredOracles: [
        ...result.requiredOracles,
        ...rateLimitOracles.filter((o) => !existingKeys.has(o.key.toBase58())),
      ],
      uncrankableAssets: [...result.uncrankableAssets, ...uncrankableRateLimitBanks],
      isCrankable: result.isCrankable && uncrankableRateLimitBanks.length === 0,
    };
  };

  const liabilityBalances = projectedBalances.filter((b) => b.liabilityShares.gt(0));
  const assetBalances = projectedBalances.filter((b) => b.assetShares.gt(0));

  // No liabilities means no risk, no cranking needed (beyond rate-limit oracles)
  if (liabilityBalances.length === 0) {
    return withRateLimitCranks({
      requiredOracles: [],
      uncrankableLiabilities: [],
      uncrankableAssets: [],
      isCrankable: true,
    });
  }

  // The on-chain health check applies emode asset weights whenever the account's
  // projected positions activate an emode pair. Derive them from the projected
  // balances (not the pre-transaction account state) so the health estimates below
  // match the program — otherwise emode-dependent accounts look under-collateralized
  // and the crank aborts with a false "assets don't cover liabilities".
  const activeEmodeWeightsByBank = computeLowestEmodeWeights(
    computeActiveEmodePairs(
      getEmodePairs(Array.from(bankMap.values())),
      liabilityBalances.map((b) => b.bankPk),
      assetBalances.map((b) => b.bankPk)
    )
  );

  // Get banks from balances
  const getBanks = (balances: typeof projectedBalances) =>
    balances
      .map((b) => bankMap.get(b.bankPk.toBase58()))
      .filter((bank): bank is BankType => bank !== undefined);

  const projectedAssetBanks = getBanks(assetBalances);
  const liabilityBanks = getBanks(liabilityBalances);

  // SVSP transition (0.1.9): staked banks with oracle pricing disabled (flags bit 9)
  // cannot be priced on-chain, so their collateral cannot back the health check.
  // Exclude them from priceable assets and surface them as uncrankable assets.
  const assetBanks = projectedAssetBanks.filter((bank) => !bank.stakedOracleDisabled);
  const disabledStakedAssets = projectedAssetBanks
    .filter((bank) => bank.stakedOracleDisabled)
    .map((bank) => ({
      bank,
      reason: "Staked oracle pricing disabled (SVSP transition)",
    }));

  const allActiveBanks = [...liabilityBanks, ...assetBanks];

  // Only Switchboard Pull oracles need cranking
  const allActiveSwbBanks = allActiveBanks.filter(isSwitchboard);

  if (allActiveSwbBanks.length === 0) {
    return withRateLimitCranks({
      requiredOracles: [],
      uncrankableLiabilities: [],
      uncrankableAssets: disabledStakedAssets,
      isCrankable: true,
    });
  }

  // Check crankability for all Switchboard banks
  const crankabilityResults = await checkMultipleOraclesCrankability(
    allActiveSwbBanks,
    oraclePrices,
    connection,
    crossbarUrl
  );

  const { crankable, uncrankable } = partitionBanksByCrankability(
    allActiveSwbBanks,
    crankabilityResults
  );

  // Separate uncrankable banks into liabilities and assets
  const uncrankableLiabilities = uncrankable.filter((uc) =>
    liabilityBanks.some((lb) => lb.address.equals(uc.bank.address))
  );
  const uncrankableAssets = [
    ...uncrankable.filter((uc) => assetBanks.some((ab) => ab.address.equals(uc.bank.address))),
    ...disabledStakedAssets,
  ];

  // Get all available assets (both Switchboard and non-Switchboard)
  const allAvailableAssets = assetBanks.filter(
    (ab) => crankable.some((c) => c.address.equals(ab.address)) || !isSwitchboard(ab)
  );

  // If any liability oracle is uncrankable, transaction is blocked
  if (uncrankableLiabilities.length > 0) {
    console.log(
      "\n✗ BLOCKED: Uncrankable liabilities:",
      uncrankableLiabilities.map((l) => l.bank.tokenSymbol)
    );
    return withRateLimitCranks({
      requiredOracles: [],
      uncrankableLiabilities,
      uncrankableAssets,
      isCrankable: false,
    });
  }
  // Helper to collect unique oracle keys with prices from banks
  const getOracleKeys = (banks: PublicKey[]): Array<{ key: PublicKey; price: OraclePrice }> => {
    const oracleMap = new Map<string, OraclePrice>();
    banks.forEach((addr) => {
      const bank = bankMap.get(addr.toBase58());
      if (bank) {
        const oracleKeyStr = bank.oracleKey.toBase58();
        const price = oraclePrices.get(bank.address.toBase58());
        if (price && !oracleMap.has(oracleKeyStr)) {
          oracleMap.set(oracleKeyStr, price);
        }
      }
    });
    return Array.from(oracleMap.entries()).map(([keyStr, price]) => ({
      key: new PublicKey(keyStr),
      price,
    }));
  };

  // Get total liability health
  const totalLiabilitiesInitHealth = computeLiabilityHealthComponent({
    balances: projectedBalances,
    banksMap: bankMap,
    oraclePricesByBank: oraclePrices,
    liabilityBanks: liabilityBanks.map((b) => b.address),
    marginRequirement: MarginRequirementType.Initial,
  });

  const liabilityBankAddresses = liabilityBanks.filter(isSwitchboard).map((b) => b.address);
  const nonSWBAssets = assetBanks.filter((bank) => !isSwitchboard(bank));
  const swbAssets = assetBanks.filter(isSwitchboard);

  // If non-Switchboard assets (Pyth) cover liabilities, only crank liabilities
  if (nonSWBAssets.length > 0) {
    const nonSWBAssetsHealth = computeAssetHealthComponent({
      balances: projectedBalances,
      banksMap: bankMap,
      oraclePricesByBank: oraclePrices,
      assetBanks: nonSWBAssets.map((b) => b.address),
      marginRequirement: MarginRequirementType.Initial,
      assetShareValueMultiplierByBank,
      activeEmodeWeightsByBank,
    });

    const healthDiff = nonSWBAssetsHealth.minus(totalLiabilitiesInitHealth);

    if (healthDiff.gt(0)) {
      console.log("\n✓ Pyth assets cover liabilities, cranking only liability SWB banks");
      return withRateLimitCranks({
        requiredOracles: getOracleKeys(liabilityBankAddresses),
        uncrankableLiabilities: [],
        uncrankableAssets,
        isCrankable: true,
      });
    }
  }

  // Filter to only crankable Switchboard assets
  const crankableSWBAssets = swbAssets.filter((bank) =>
    crankable.some((cb) => cb.address.equals(bank.address))
  );

  let combinations: CrankCombination[] = [];

  // Generate combinations of a specific size
  const getCombinations = <T>(arr: T[], size: number): T[][] => {
    if (size === 0) return [[]];
    if (size > arr.length) return [];

    const result: T[][] = [];
    const combine = (start: number, current: T[]) => {
      if (current.length === size) {
        result.push([...current]);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        combine(i + 1, [...current, arr[i]!]);
      }
    };
    combine(0, []);
    return result;
  };

  // Calculate health with ALL available assets (both Switchboard and non-Switchboard)
  const allAvailableAssetAddresses = allAvailableAssets.map((bank) => bank.address);
  const allAssetsHealth = computeAssetHealthComponent({
    balances: projectedBalances,
    banksMap: bankMap,
    oraclePricesByBank: oraclePrices,
    assetBanks: allAvailableAssetAddresses,
    marginRequirement: MarginRequirementType.Initial,
    assetShareValueMultiplierByBank,
    activeEmodeWeightsByBank,
  });
  const healthWithAllAssets = allAssetsHealth.minus(totalLiabilitiesInitHealth);

  // If assets don't cover liabilities even with all available cranked
  if (!healthWithAllAssets.gt(0)) {
    console.log("✗ Assets don't cover liabilities even with all cranked");
    // If there are uncrankable assets, they're blocking a potentially healthy transaction
    if (uncrankableAssets.length > 0) {
      return withRateLimitCranks({
        requiredOracles: [],
        uncrankableLiabilities: [],
        uncrankableAssets,
        isCrankable: false,
      });
    }

    // If no uncrankable assets, this is a bug - fallback to cranking everything
    return withRateLimitCranks({
      requiredOracles: getOracleKeys(allActiveSwbBanks.map((bank) => bank.address)),
      uncrankableLiabilities: [],
      uncrankableAssets: [],
      isCrankable: true,
    });
  }

  // Add full crank combination as fallback
  combinations.push({
    banks: crankable.map((cb) => cb.address),
    oracleKeys: getOracleKeys(crankable.map((cb) => cb.address)),
    healthAfter: healthWithAllAssets,
  });

  // Find minimal asset combinations needed for positive health
  const nonSWBAssetAddresses = nonSWBAssets.map((b) => b.address);
  const liabilityOracleKeySet = new Set(liabilityBanks.map((lb) => lb.oracleKey.toBase58()));

  for (let comboSize = 1; comboSize < crankableSWBAssets.length; comboSize++) {
    const assetCombos = getCombinations(crankableSWBAssets, comboSize);

    for (const assetCombo of assetCombos) {
      const comboAddresses = assetCombo.map((bank) => bank.address);
      const comboHealth = computeAssetHealthComponent({
        balances: projectedBalances,
        banksMap: bankMap,
        oraclePricesByBank: oraclePrices,
        assetBanks: [...nonSWBAssetAddresses, ...comboAddresses],
        marginRequirement: MarginRequirementType.Initial,
        assetShareValueMultiplierByBank,
        activeEmodeWeightsByBank,
      });

      const health = comboHealth.minus(totalLiabilitiesInitHealth);
      if (!health.gt(0)) continue;

      // Collect banks that need new oracle cranks (not already in liability oracles)
      const additionalBanks = comboAddresses.filter((addr) => {
        const bank = bankMap.get(addr.toBase58());
        return bank && !liabilityOracleKeySet.has(bank.oracleKey.toBase58());
      });

      const allBanks = [...liabilityBankAddresses, ...additionalBanks];
      const uniqueBanks = Array.from(new Set(allBanks.map((b) => b.toBase58()))).map(
        (addr) => new PublicKey(addr)
      );

      combinations.push({
        banks: uniqueBanks,
        oracleKeys: getOracleKeys(uniqueBanks),
        healthAfter: health,
      });
    }
  }

  // Sort by: (1) fewest oracle cranks, (2) best health
  combinations.sort((a, b) =>
    a.oracleKeys.length !== b.oracleKeys.length
      ? a.oracleKeys.length - b.oracleKeys.length
      : b.healthAfter.minus(a.healthAfter).toNumber()
  );

  const bestCombination = combinations[0];
  if (!bestCombination) {
    // No valid combination found - this shouldn't happen as we always add the full crank combo
    // Fallback to cranking all available oracles
    console.error(
      "BUG: No valid crank combination found. Falling back to crank all available oracles."
    );
    return withRateLimitCranks({
      requiredOracles: getOracleKeys(crankable.map((bank) => bank.address)),
      uncrankableLiabilities: [],
      uncrankableAssets: [],
      isCrankable: true,
    });
  }

  return withRateLimitCranks({
    requiredOracles: bestCombination.oracleKeys,
    uncrankableLiabilities: [],
    uncrankableAssets,
    isCrankable: true,
  });
}
