import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { InstructionsWrapper } from "../transaction";

import { OracleSetup } from "./types";
import { serializeOracleSetupToIndex } from "./utils";

import instructions from "~/instructions";
import { MarginfiProgram } from "~/types";
import { bigNumberToWrappedI80F48 } from "~/utils";

/**
 * Freezes a bank's settings so they can no longer be changed. Signed by the group's governance
 * admin.
 *
 * @param program - The marginfi program
 * @param bankAddress - The bank to freeze
 * @returns The `lending_pool_configure_bank_gov` instruction
 */
export async function freezeBankConfigIx(
  program: MarginfiProgram,
  bankAddress: PublicKey
): Promise<InstructionsWrapper> {
  const ix = await instructions.makePoolConfigureBankGovIx(
    program,
    { bank: bankAddress },
    {
      bankConfigOpt: {
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
      },
    }
  );

  return {
    instructions: [ix],
    keys: [],
  };
}

type AddOracleToBanksIxArgs = {
  program: MarginfiProgram;
  bankAddress: PublicKey;
  feedId: PublicKey;
  /** @deprecated Use oracleAccounts when the setup needs on-chain validation accounts. */
  oracleKey?: PublicKey;
  /** Ordered exactly as the program's oracle accounts for the selected setup. */
  oracleAccounts?: PublicKey[];
  setup: OracleSetup;
  groupAddress?: PublicKey;
  governanceAdminAddress?: PublicKey;
};

export async function addOracleToBanksIx({
  program,
  bankAddress,
  feedId,
  oracleKey,
  oracleAccounts,
  setup,
  groupAddress,
  governanceAdminAddress,
}: AddOracleToBanksIxArgs): Promise<InstructionsWrapper> {
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
  if (expectedAccountCount !== undefined && !resolvedOracleAccounts[0].equals(feedId)) {
    throw new Error(
      `${setup} requires oracleAccounts[0] to be the primary feed ${feedId.toBase58()}`
    );
  }

  const ix = await instructions.makeLendingPoolConfigureBankOracleIx(
    program,
    {
      bank: bankAddress,
      group: groupAddress,
      governanceAdmin: governanceAdminAddress,
    },
    {
      setup: serializeOracleSetupToIndex(setup),
      feedId,
    },
    resolvedOracleAccounts.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    }))
  );

  return {
    instructions: [ix],
    keys: [],
  };
}

type SetOraclePriceIxArgs = {
  program: MarginfiProgram;
  bankAddress: PublicKey;
  price: BigNumber;
  setup: OracleSetup.Fixed | OracleSetup.PTPyth | OracleSetup.PTFixed;
  /** Fixed venue account, [Pyth, Exponent vault], or [Exponent vault], depending on setup. */
  oracleAccounts?: PublicKey[];
  groupAddress?: PublicKey;
  governanceAdminAddress?: PublicKey;
};

/** Configure a flat fixed price or an Exponent PT price, signed by the group's governance admin. */
export async function setOraclePriceIx({
  program,
  bankAddress,
  price,
  setup,
  oracleAccounts = [],
  groupAddress,
  governanceAdminAddress,
}: SetOraclePriceIxArgs): Promise<InstructionsWrapper> {
  const expectedAccountCount =
    setup === OracleSetup.PTPyth ? 2 : setup === OracleSetup.PTFixed ? 1 : undefined;
  if (expectedAccountCount !== undefined && oracleAccounts.length !== expectedAccountCount) {
    throw new Error(`${setup} requires ${expectedAccountCount} ordered oracle accounts`);
  }

  const ix = await instructions.makeLendingPoolSetOraclePriceIx(
    program,
    {
      bank: bankAddress,
      group: groupAddress,
      governanceAdmin: governanceAdminAddress,
    },
    {
      price: bigNumberToWrappedI80F48(price),
      setup: serializeOracleSetupToIndex(setup),
    },
    oracleAccounts.map((pubkey) => ({ isSigner: false, isWritable: false, pubkey }))
  );

  return {
    instructions: [ix],
    keys: [],
  };
}

type ConfigureScopeOracleIxArgs = {
  program: MarginfiProgram;
  bankAddress: PublicKey;
  oracle: PublicKey;
  entryIndex: number;
  /** Kamino reserve or JupLend lending account (the bank's `oracleKeys[1]`); required for Kamino and JupLend banks */
  integrationAccount?: PublicKey;
  groupAddress?: PublicKey;
  governanceAdminAddress?: PublicKey;
};

export async function configureScopeOracleIx({
  program,
  bankAddress,
  oracle,
  entryIndex,
  integrationAccount,
  groupAddress,
  governanceAdminAddress,
}: ConfigureScopeOracleIxArgs): Promise<InstructionsWrapper> {
  const ix = await instructions.makeLendingPoolConfigureBankOracleScopeIx(
    program,
    {
      bank: bankAddress,
      group: groupAddress,
      governanceAdmin: governanceAdminAddress,
    },
    {
      oracle,
      entryIndex,
      integrationAccount,
    }
  );

  return {
    instructions: [ix],
    keys: [],
  };
}
