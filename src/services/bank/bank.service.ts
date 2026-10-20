import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import { BigNumber } from "bignumber.js";

import { AssetTag, BankType, OracleSetup } from "./types";
import { serializeOracleSetup } from "./utils/serialize.utils";

import instructions from "~/instructions";
import { bigNumberToWrappedI80F48 } from "~/utils";

type BankAdminIxArgs = {
  programAddress: Address;
  bankAddress: Address;
  groupAddress: Address;
  governanceAdmin: TransactionSigner;
};

/** Freeze a bank's settings against further changes, signed by the group's governance admin. */
export async function freezeBankConfigIx({
  programAddress,
  bankAddress,
  groupAddress,
  governanceAdmin,
}: BankAdminIxArgs): Promise<Instruction> {
  return instructions.makePoolConfigureBankGovIx(programAddress, {
    group: groupAddress,
    governanceAdmin,
    bank: bankAddress,
    assetWeightInit: null,
    assetWeightMaint: null,
    liabilityWeightInit: null,
    liabilityWeightMaint: null,
    operationalState: null,
    riskTier: null,
    assetTag: null,
    oracleMaxConfidence: null,
    oracleMaxAge: null,
    tokenlessRepaymentsAllowed: null,
    freezeSettings: true,
  });
}

type AddOracleToBanksIxArgs = BankAdminIxArgs & {
  feedId: Address;
  /** @deprecated Use oracleAccounts when the setup needs on-chain validation accounts. */
  oracleKey?: Address;
  /** Ordered exactly as the program's oracle accounts for the selected setup. */
  oracleAccounts?: Address[];
  setup: OracleSetup;
};

export async function addOracleToBanksIx({
  programAddress,
  bankAddress,
  groupAddress,
  governanceAdmin,
  feedId,
  oracleKey,
  oracleAccounts,
  setup,
}: AddOracleToBanksIxArgs): Promise<Instruction> {
  const isScope =
    setup === OracleSetup.Scope ||
    setup === OracleSetup.ScopeKamino ||
    setup === OracleSetup.ScopeJuplend;
  if (
    isScope ||
    setup === OracleSetup.PTPyth ||
    setup === OracleSetup.PTFixed ||
    setup === OracleSetup.Fixed ||
    setup === OracleSetup.FixedKamino ||
    setup === OracleSetup.FixedDrift ||
    setup === OracleSetup.FixedJuplend
  ) {
    throw new Error(
      `${setup} must be configured with ${isScope ? "configureScopeOracleIx" : "setOraclePriceIx"}`
    );
  }

  const resolvedOracleAccounts = oracleAccounts ?? (oracleKey ? [oracleKey] : []);
  const expectedAccountCount =
    setup === OracleSetup.PythMSOL || setup === OracleSetup.PythLST
      ? 2
      : setup === OracleSetup.KaminoMSOL ||
          setup === OracleSetup.JuplendMSOL ||
          setup === OracleSetup.KaminoLST ||
          setup === OracleSetup.JuplendLST
        ? 3
        : undefined;
  if (
    expectedAccountCount !== undefined &&
    resolvedOracleAccounts.length !== expectedAccountCount
  ) {
    throw new Error(`${setup} requires ${expectedAccountCount} ordered oracle accounts`);
  }
  // The program reads the primary feed from remaining[0] and requires it to match `oracle`
  if (expectedAccountCount !== undefined && resolvedOracleAccounts[0] !== feedId) {
    throw new Error(`${setup} requires oracleAccounts[0] to be the primary feed ${feedId}`);
  }

  return instructions.makeLendingPoolConfigureBankOracleIx(
    programAddress,
    {
      group: groupAddress,
      governanceAdmin,
      bank: bankAddress,
      setup: serializeOracleSetup(setup),
      oracle: feedId,
    },
    resolvedOracleAccounts
  );
}

type SetOraclePriceIxArgs = BankAdminIxArgs & {
  price: BigNumber;
  setup: OracleSetup.Fixed | OracleSetup.PTPyth | OracleSetup.PTFixed;
  /** Fixed venue account, [Pyth, Exponent vault], or [Exponent vault], depending on setup. */
  oracleAccounts?: Address[];
};

/** Configure a flat fixed price or an Exponent PT price, signed by the group's governance admin. */
export async function setOraclePriceIx({
  programAddress,
  bankAddress,
  groupAddress,
  governanceAdmin,
  price,
  setup,
  oracleAccounts = [],
}: SetOraclePriceIxArgs): Promise<Instruction> {
  const expectedAccountCount =
    setup === OracleSetup.PTPyth ? 2 : setup === OracleSetup.PTFixed ? 1 : undefined;
  if (expectedAccountCount !== undefined && oracleAccounts.length !== expectedAccountCount) {
    throw new Error(`${setup} requires ${expectedAccountCount} ordered oracle accounts`);
  }

  return instructions.makeLendingPoolSetOraclePriceIx(
    programAddress,
    {
      group: groupAddress,
      governanceAdmin,
      bank: bankAddress,
      price: bigNumberToWrappedI80F48(price),
      setup: serializeOracleSetup(setup),
    },
    oracleAccounts
  );
}

type ConfigureScopeOracleIxArgs = Omit<BankAdminIxArgs, "bankAddress"> & {
  bank: BankType;
  oracle: Address;
  entryIndex: number;
};

/**
 * Point a bank at an entry in a Scope OraclePrices account, signed by the group's governance admin.
 * The program picks Scope, ScopeKamino or ScopeJuplend from the bank's asset tag; for Kamino and
 * JupLend banks the reserve / lending account it validates is taken from `bank.config.oracleKeys[1]`.
 */
export async function configureScopeOracleIx({
  programAddress,
  bank,
  groupAddress,
  governanceAdmin,
  oracle,
  entryIndex,
}: ConfigureScopeOracleIxArgs): Promise<Instruction> {
  return instructions.makeLendingPoolConfigureBankOracleScopeIx(
    programAddress,
    { group: groupAddress, governanceAdmin, bank: bank.address, oracle, entryIndex },
    bank.config.assetTag === AssetTag.KAMINO || bank.config.assetTag === AssetTag.JUPLEND
      ? bank.config.oracleKeys[1]
      : undefined
  );
}
