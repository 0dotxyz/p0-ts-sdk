import {
  AccountRole,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import BigNumber from "bignumber.js";

import { BankConfigOptRaw } from "../bank/types";
import {
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

export async function makePoolConfigureBankIx({
  programAddress,
  groupAddress,
  admin,
  bankAddress,
  bankConfigOpt,
}: {
  programAddress: Address;
  groupAddress: Address;
  admin: TransactionSigner;
  bankAddress: Address;
  bankConfigOpt: BankConfigOptRaw;
}): Promise<Instruction> {
  return instructions.makePoolConfigureBankIx(programAddress, {
    group: groupAddress,
    admin,
    bank: bankAddress,
    bankConfigOpt,
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
    remainingKeys.map((address) => ({ address, role: AccountRole.READONLY }))
  );
}

export async function makePoolAddBankIx({
  programAddress,
  groupAddress,
  admin,
  globalFeeWallet,
  feePayer,
  bank,
  bankMint,
  bankConfig,
  tokenProgram = TOKEN_PROGRAM_ADDRESS,
}: {
  programAddress: Address;
  groupAddress: Address;
  admin: TransactionSigner;
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
    admin,
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
