import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { InstructionsWrapper } from "../transaction";

import { BankConfigOpt, BankConfigOptRaw, OracleSetup } from "./types";
import { serializeBankConfigOpt, serializeOracleSetupToIndex } from "./utils";

import instructions from "~/instructions";
import { MarginfiProgram } from "~/types";
import { bigNumberToWrappedI80F48 } from "~/utils";



export async function freezeBankConfigIx(
  program: MarginfiProgram,
  bankAddress: PublicKey,
  bankConfigOpt: BankConfigOpt
): Promise<InstructionsWrapper> {
  let bankConfigRaw: BankConfigOptRaw;
  if (!bankConfigOpt) {
    // todo: make bankConfigOpt optional and create function to get bankConfigOptRaw from bank
  }
  bankConfigRaw = serializeBankConfigOpt(bankConfigOpt);

  const ix = await instructions.makePoolConfigureBankIx(
    program,
    {
      bank: bankAddress,
    },
    {
      bankConfigOpt: {
        ...bankConfigRaw,
        assetWeightInit: null,
        assetWeightMaint: null,

        liabilityWeightInit: null,
        liabilityWeightMaint: null,

        depositLimit: null,
        borrowLimit: null,
        riskTier: null,
        assetTag: null,
        totalAssetValueInitLimit: null,

        interestRateConfig: null,
        operationalState: null,

        oracleMaxAge: null,
        permissionlessBadDebtSettlement: null,
        freezeSettings: true,
        oracleMaxConfidence: null,
        tokenlessRepaymentsAllowed: null,
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
  adminAddress?: PublicKey;
};

export async function addOracleToBanksIx({
  program,
  bankAddress,
  feedId,
  oracleKey,
  oracleAccounts,
  setup,
  groupAddress,
  adminAddress,
}: AddOracleToBanksIxArgs): Promise<InstructionsWrapper> {
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
      admin: adminAddress,
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
  adminAddress?: PublicKey;
};

/** Configure a flat fixed price or an Exponent PT price using the 0.1.11 instruction. */
export async function setOraclePriceIx({
  program,
  bankAddress,
  price,
  setup,
  oracleAccounts = [],
  groupAddress,
  adminAddress,
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
      admin: adminAddress,
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
  groupAddress?: PublicKey;
  adminAddress?: PublicKey;
};

export async function configureScopeOracleIx({
  program,
  bankAddress,
  oracle,
  entryIndex,
  groupAddress,
  adminAddress,
}: ConfigureScopeOracleIxArgs): Promise<InstructionsWrapper> {
  const ix = await instructions.makeLendingPoolConfigureBankOracleScopeIx(
    program,
    {
      bank: bankAddress,
      group: groupAddress,
      admin: adminAddress,
    },
    {
      oracle,
      entryIndex,
    }
  );

  return {
    instructions: [ix],
    keys: [],
  };
}
