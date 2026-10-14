import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { BigNumber } from "bignumber.js";

import bankFixtures from "../fixtures/mainnet-banks.json";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import {
  BalanceType,
  createEmptyBalance,
  HealthCacheStatus,
  MarginfiAccountType,
} from "~/services/account";
import { AssetTag, BankType, OracleSetup } from "~/services/bank";
import { decodeInstruction } from "~/services/transaction";
import type { MarginfiProgram } from "~/types";

// Anchor reads a withdraw's `liquidity_vault` from the bank account; any real bank account will do
const bankAccountData = Buffer.from(bankFixtures[0].data, "base64");
const accountResolverConnection = {
  getAccountInfo: async () => ({
    data: bankAccountData,
    owner: new PublicKey(MARGINFI_IDL.address),
    lamports: 1,
    executable: false,
  }),
} as unknown as Connection;

export const program = new Program<MarginfiIdlType>(
  MARGINFI_IDL,
  new AnchorProvider(accountResolverConnection, {} as Wallet, {})
) as unknown as MarginfiProgram;

const BLOCKHASH = PublicKey.default.toBase58();

/** A Connection for building transactions offline: every ATA exists, so no setup transactions. */
export const txBuildingConnection = {
  getLatestBlockhash: async () => ({ blockhash: BLOCKHASH }),
  getLatestBlockhashAndContext: async () => ({ value: { blockhash: BLOCKHASH } }),
  getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(() => ({})),
} as unknown as Connection;

/** A plain Pyth-priced bank with 9 decimals and share values of 1. */
export function bank(): BankType {
  const oracle = PublicKey.unique();
  return {
    address: PublicKey.unique(),
    mint: PublicKey.unique(),
    mintDecimals: 9,
    assetShareValue: new BigNumber(1),
    liabilityShareValue: new BigNumber(1),
    group: PublicKey.unique(),
    liquidityVault: PublicKey.unique(),
    oracleKey: oracle,
    premiumActive: false,
    config: {
      oracleSetup: OracleSetup.PythPushOracle,
      assetTag: AssetTag.DEFAULT,
      oracleKeys: [oracle],
    },
  } as unknown as BankType;
}

export const balance = (b: BankType, side: "asset" | "liability", shares: number): BalanceType => ({
  ...createEmptyBalance(b.address),
  active: true,
  assetShares: new BigNumber(side === "asset" ? shares : 0),
  liabilityShares: new BigNumber(side === "liability" ? shares : 0),
});

/** A marginfi account holding `balances`, padded with empty slots to the program's 16. */
export const account = (balances: BalanceType[]): MarginfiAccountType =>
  ({
    address: PublicKey.unique(),
    group: PublicKey.unique(),
    authority: PublicKey.unique(),
    balances: [
      ...balances,
      ...Array.from({ length: 16 - balances.length }, () => createEmptyBalance(PublicKey.default)),
    ],
    accountFlags: [],
    healthCache: { simulationStatus: HealthCacheStatus.UNSET },
  }) as unknown as MarginfiAccountType;

/** The transaction's instructions, each with its program and raw data. */
export function instructionsOf(tx: VersionedTransaction) {
  const keys = tx.message.staticAccountKeys;
  return tx.message.compiledInstructions.map((ix) => ({
    programId: keys[ix.programIdIndex],
    data: Buffer.from(ix.data),
  }));
}

/** The decoded arguments of the transaction's first marginfi instruction called `name`. */
export function marginfiIxArgs<T = { amount: BN }>(tx: VersionedTransaction, name: string): T {
  const decoded = instructionsOf(tx)
    .filter((ix) => ix.programId?.equals(program.programId))
    .map((ix) => decodeInstruction(program.idl, ix.data))
    .find((ix) => ix?.name === name);
  if (!decoded) throw new Error(`no ${name} instruction`);
  return decoded.data as T;
}
