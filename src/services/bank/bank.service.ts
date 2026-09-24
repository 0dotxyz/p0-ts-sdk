import { AccountRole, type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import BigNumber from "bignumber.js";

import { OracleSetup } from "./types";
import { serializeOracleSetup } from "./utils/serialize.utils";

import instructions from "~/instructions";
import { bigNumberToWrappedI80F48 } from "~/utils";

type BankAdminIxArgs = {
  programAddress: Address;
  bankAddress: Address;
  groupAddress: Address;
  admin: TransactionSigner;
};

export async function freezeBankConfigIx({
  programAddress,
  bankAddress,
  groupAddress,
  admin,
}: BankAdminIxArgs): Promise<Instruction> {
  return instructions.makePoolConfigureBankIx(programAddress, {
    group: groupAddress,
    admin,
    bank: bankAddress,
    bankConfigOpt: {
      assetWeightInit: null,
      assetWeightMaint: null,
      liabilityWeightInit: null,
      liabilityWeightMaint: null,
      depositLimit: null,
      borrowLimit: null,
      operationalState: null,
      interestRateConfig: null,
      riskTier: null,
      assetTag: null,
      totalAssetValueInitLimit: null,
      oracleMaxConfidence: null,
      oracleMaxAge: null,
      permissionlessBadDebtSettlement: null,
      freezeSettings: true,
      tokenlessRepaymentsAllowed: null,
      liquidationLiquidatorFee: null,
      liquidationInsuranceFee: null,
      circuitBreakerEnabled: null,
      cbDeviationBpsTiers: null,
      cbTierDurationsSeconds: null,
      cbEscalationWindowMult: null,
      cbEmaAlphaBps: null,
      cbWindowSeconds: null,
      cbWindowMaxUpBps: null,
      cbWindowMaxDownBps: null,
    },
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
  admin,
  feedId,
  oracleKey,
  oracleAccounts,
  setup,
}: AddOracleToBanksIxArgs): Promise<Instruction> {
  if (
    setup === OracleSetup.Scope ||
    setup === OracleSetup.PTPyth ||
    setup === OracleSetup.PTFixed ||
    setup === OracleSetup.Fixed ||
    setup === OracleSetup.FixedKamino ||
    setup === OracleSetup.FixedDrift ||
    setup === OracleSetup.FixedJuplend
  ) {
    throw new Error(
      `${setup} must be configured with ${
        setup === OracleSetup.Scope ? "configureScopeOracleIx" : "setOraclePriceIx"
      }`
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
      admin,
      bank: bankAddress,
      setup: serializeOracleSetup(setup),
      oracle: feedId,
    },
    resolvedOracleAccounts.map((address) => ({ address, role: AccountRole.READONLY }))
  );
}

type SetOraclePriceIxArgs = BankAdminIxArgs & {
  price: BigNumber;
  setup: OracleSetup.Fixed | OracleSetup.PTPyth | OracleSetup.PTFixed;
  /** Fixed venue account, [Pyth, Exponent vault], or [Exponent vault], depending on setup. */
  oracleAccounts?: Address[];
};

/** Configure a flat fixed price or an Exponent PT price using the 0.1.11 instruction. */
export async function setOraclePriceIx({
  programAddress,
  bankAddress,
  groupAddress,
  admin,
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
      admin,
      bank: bankAddress,
      price: bigNumberToWrappedI80F48(price),
      setup: serializeOracleSetup(setup),
    },
    oracleAccounts.map((address) => ({ address, role: AccountRole.READONLY }))
  );
}

type ConfigureScopeOracleIxArgs = BankAdminIxArgs & {
  oracle: Address;
  entryIndex: number;
};

export async function configureScopeOracleIx({
  programAddress,
  bankAddress,
  groupAddress,
  admin,
  oracle,
  entryIndex,
}: ConfigureScopeOracleIxArgs): Promise<Instruction> {
  return instructions.makeLendingPoolConfigureBankOracleScopeIx(programAddress, {
    group: groupAddress,
    admin,
    bank: bankAddress,
    oracle,
    entryIndex,
  });
}
