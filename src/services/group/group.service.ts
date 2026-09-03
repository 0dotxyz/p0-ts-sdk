import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import {
  BankConfigOptRaw,
  BankConfigOpt,
  serializeBankConfigOpt,
  BankConfigCompactRaw,
} from "../bank";
import { InstructionsWrapper } from "../transaction";

import instructions from "~/instructions";
import { MarginfiProgram } from "~/types";
import {
  findPoolAddress,
  findPoolStakeAddress,
  findPoolMintAddress,
  findPoolOnRampAddress,
} from "~/vendor/single-spl-pool";
import { TOKEN_PROGRAM_ID } from "~/vendor/spl";

export async function makePoolConfigureBankIx(
  program: MarginfiProgram,
  bank: PublicKey,
  args: BankConfigOptRaw
): Promise<InstructionsWrapper> {
  const ix = await instructions.makePoolConfigureBankIx(
    program,
    {
      bank: bank,
    },
    { bankConfigOpt: args }
  );

  return {
    instructions: [ix],
    keys: [],
  };
}

export async function makeAddPermissionlessStakedBankIx(
  program: MarginfiProgram,
  group: PublicKey,
  voteAccountAddress: PublicKey,
  feePayer: PublicKey,
  pythOracle: PublicKey // wSOL oracle
): Promise<InstructionsWrapper> {
  const [settingsKey] = PublicKey.findProgramAddressSync(
    [Buffer.from("staked_settings", "utf-8"), group.toBuffer()],
    program.programId
  );
  const poolAddress = findPoolAddress(voteAccountAddress);
  const solPool = findPoolStakeAddress(poolAddress);
  const lstMint = findPoolMintAddress(poolAddress);
  const onRampAddress = findPoolOnRampAddress(poolAddress);

  const remainingKeys = [pythOracle, lstMint, solPool];

  const ix = await instructions.makePoolAddPermissionlessStakedBankIx(
    program,
    {
      stakedSettings: settingsKey,
      feePayer: feePayer,
      bankMint: lstMint,
      solPool,
      poolOnramp: onRampAddress,
      stakePool: poolAddress,
      validatorVoteAccount: voteAccountAddress,
    },
    remainingKeys.map((key) => ({
      pubkey: key,
      isSigner: false,
      isWritable: false,
    })),
    {
      seed: new BN(0),
    }
  );

  return {
    instructions: [ix],
    keys: [],
  };
}

export async function makePoolAddBankIx(
  program: MarginfiProgram,
  group: PublicKey,
  bank: PublicKey,
  feePayer: PublicKey,
  bankMint: PublicKey,
  bankConfig: BankConfigOpt,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  overrideOpt: { admin?: PublicKey; globalFeeWallet?: PublicKey } = {}
): Promise<InstructionsWrapper> {
  const rawBankConfig = serializeBankConfigOpt(bankConfig);

  // TODO verify this is correct
  const rawBankConfigCompact = {
    ...rawBankConfig,
    oracleMaxAge: bankConfig.oracleMaxAge,
    auto_padding_0: [0],
    auto_padding_1: [0],
    configFlags: 0,
  } as BankConfigCompactRaw;

  const ix = await instructions.makePoolAddBankIx(
    program,
    {
      marginfiGroup: group,
      feePayer,
      bankMint,
      bank,
      tokenProgram,
      ...overrideOpt,
      // if two oracle keys: first is feed id, second is oracle key
    },
    {
      bankConfig: rawBankConfigCompact,
    }
  );

  return {
    instructions: [ix], //ix
    keys: [],
  };
}
