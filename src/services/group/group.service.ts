import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import { BankConfigFastOpt, BankConfigGovOpt } from "../bank/types";
import {
  serializeBankConfigFast,
  serializeBankConfigGov,
  serializeInterestRateConfig,
  serializeOperationalState,
  serializeRiskTier,
} from "../bank/utils/serialize.utils";

import { AddBankConfig } from "./types";

import instructions from "~/instructions";
import { bigNumberToWrappedI80F48 } from "~/utils";
import {
  findPoolAddress,
  findPoolStakeAddress,
  findPoolMintAddress,
  findPoolOnRampAddress,
} from "~/vendor/single-spl-pool";

/**
 * Configures a bank's admin-level settings (limits, interest rates, pausing), signed by the group
 * admin. Weights, risk tier, asset tag, oracle limits, freezing and returning a paused bank to
 * operational go through {@link makePoolConfigureBankGovIx}.
 */
export async function makePoolConfigureBankIx({
  programAddress,
  groupAddress,
  admin,
  bankAddress,
  bankConfig,
}: {
  programAddress: Address;
  groupAddress: Address;
  admin: TransactionSigner;
  bankAddress: Address;
  bankConfig: BankConfigFastOpt;
}): Promise<Instruction> {
  return instructions.makePoolConfigureBankIx(programAddress, {
    group: groupAddress,
    admin,
    bank: bankAddress,
    ...serializeBankConfigFast(bankConfig),
  });
}

/**
 * Configures a bank's governance settings (weights, risk tier, asset tag, oracle limits, tokenless
 * repayments, freezing, returning to operational), signed by the group's governance admin.
 */
export async function makePoolConfigureBankGovIx({
  programAddress,
  groupAddress,
  governanceAdmin,
  bankAddress,
  bankConfig,
}: {
  programAddress: Address;
  groupAddress: Address;
  governanceAdmin: TransactionSigner;
  bankAddress: Address;
  bankConfig: BankConfigGovOpt;
}): Promise<Instruction> {
  return instructions.makePoolConfigureBankGovIx(programAddress, {
    group: groupAddress,
    governanceAdmin,
    bank: bankAddress,
    ...serializeBankConfigGov(bankConfig),
  });
}

export async function makeAddPermissionlessStakedBankIx({
  programAddress,
  groupAddress,
  voteAccountAddress,
  feePayer,
  pythOracle,
}: {
  programAddress: Address;
  groupAddress: Address;
  voteAccountAddress: Address;
  feePayer: TransactionSigner;
  /** wSOL oracle */
  pythOracle: Address;
}): Promise<Instruction> {
  const [settingsKey] = await getProgramDerivedAddress({
    programAddress,
    seeds: ["staked_settings", getAddressEncoder().encode(groupAddress)],
  });
  const poolAddress = await findPoolAddress(voteAccountAddress);
  const [solPool, lstMint, onRampAddress] = await Promise.all([
    findPoolStakeAddress(poolAddress),
    findPoolMintAddress(poolAddress),
    findPoolOnRampAddress(poolAddress),
  ]);

  const remainingKeys = [pythOracle, lstMint, solPool];

  return instructions.makePoolAddPermissionlessStakedBankIx(
    programAddress,
    {
      marginfiGroup: groupAddress,
      stakedSettings: settingsKey,
      feePayer,
      bankMint: lstMint,
      solPool,
      poolOnramp: onRampAddress,
      stakePool: poolAddress,
      validatorVoteAccount: voteAccountAddress,
    },
    remainingKeys
  );
}

export async function makePoolAddBankIx({
  programAddress,
  groupAddress,
  governanceAdmin,
  globalFeeWallet,
  feePayer,
  bank,
  bankMint,
  bankConfig,
  tokenProgram = TOKEN_PROGRAM_ADDRESS,
}: {
  programAddress: Address;
  groupAddress: Address;
  governanceAdmin: TransactionSigner;
  /** The `FeeState`'s global fee wallet */
  globalFeeWallet: Address;
  feePayer: TransactionSigner;
  /** Keypair of the new bank */
  bank: TransactionSigner;
  bankMint: Address;
  bankConfig: AddBankConfig;
  tokenProgram?: Address;
}): Promise<Instruction> {
  const toBigInt = (value: BigNumber) => BigInt(value.toFixed());

  return instructions.makePoolAddBankIx(programAddress, {
    marginfiGroup: groupAddress,
    governanceAdmin,
    feePayer,
    globalFeeWallet,
    bankMint,
    bank,
    tokenProgram,
    bankConfig: {
      assetWeightInit: bigNumberToWrappedI80F48(bankConfig.assetWeightInit),
      assetWeightMaint: bigNumberToWrappedI80F48(bankConfig.assetWeightMaint),
      liabilityWeightInit: bigNumberToWrappedI80F48(bankConfig.liabilityWeightInit),
      liabilityWeightMaint: bigNumberToWrappedI80F48(bankConfig.liabilityWeightMaint),
      depositLimit: toBigInt(bankConfig.depositLimit),
      interestRateConfig: serializeInterestRateConfig(bankConfig.interestRateConfig),
      operationalState: serializeOperationalState(bankConfig.operationalState),
      borrowLimit: toBigInt(bankConfig.borrowLimit),
      riskTier: serializeRiskTier(bankConfig.riskTier),
      assetTag: bankConfig.assetTag,
      totalAssetValueInitLimit: toBigInt(bankConfig.totalAssetValueInitLimit),
      oracleMaxAge: bankConfig.oracleMaxAge,
      oracleMaxConfidence: bankConfig.oracleMaxConfidence,
    },
  });
}
