import { AnchorProvider } from "@coral-xyz/anchor";
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { CrossbarClient } from "@switchboard-xyz/common";
import { AnchorUtils, PullFeed, PullFeedAccountData } from "@switchboard-xyz/on-demand";
import { BN } from "bn.js";

import { OraclePrice } from "../types";
import { computeSmartCrank } from "../utils";
import { getOracleSourceFromOracleSetup } from "../utils/detection.utils";

import { ZERO_ORACLE_KEY } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import { MarginfiAccountType } from "~/services/account";
import { BankType, OracleSetup } from "~/services/bank";
import { MarginfiProgram } from "~/types";




type MakeSmartCrankSwbFeedIxParams = {
  marginfiAccount: MarginfiAccountType;
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  instructions: TransactionInstruction[];
  program: MarginfiProgram;
  connection: Connection;
  crossbarUrl?: string;
  /**
   * Pass `isGroupRateLimiterEnabled(group.rateLimiter)`. While the group rate limiter
   * is enabled, withdrawn banks' switchboard oracles are always cranked (the program
   * requires a fresh price for every withdraw, even withdraw-all).
   */
  groupRateLimiterEnabled?: boolean;
};

export async function makeSmartCrankSwbFeedIx(params: MakeSmartCrankSwbFeedIxParams): Promise<{
  instructions: TransactionInstruction[];
  luts: AddressLookupTableAccount[];
}> {
  const crankResult = await computeSmartCrank(params);

  if (crankResult.uncrankableLiabilities.length > 0) {
    console.log(
      "Uncrankable liability details:",
      crankResult.uncrankableLiabilities.map((l) => ({
        symbol: l.bank.tokenSymbol,
        reason: l.reason,
      }))
    );
  }
  if (crankResult.uncrankableAssets.length > 0) {
    console.log(
      "Uncrankable asset details:",
      crankResult.uncrankableAssets.map((a) => ({
        symbol: a.bank.tokenSymbol,
        reason: a.reason,
      }))
    );
  }

  if (!crankResult.isCrankable) {
    throw TransactionBuildingError.oracleCrankFailed(
      crankResult.uncrankableLiabilities.map((liability) => ({
        bankAddress: liability.bank.address.toBase58(),
        mint: liability.bank.mint.toBase58(),
        symbol: liability.bank.tokenSymbol,
        reason: liability.reason,
      })),
      crankResult.uncrankableAssets.map((asset) => ({
        bankAddress: asset.bank.address.toBase58(),
        mint: asset.bank.mint.toBase58(),
        symbol: asset.bank.tokenSymbol,
        reason: asset.reason,
      }))
    );
  }

  const oraclesToCrank = crankResult.requiredOracles;

  const { instructions, luts } = await makeUpdateSwbFeedIx({
    swbPullOracles: oraclesToCrank,
    feePayer: params.marginfiAccount.authority,
    connection: params.connection,
    crossbarUrl: params.crossbarUrl,
  });

  return { instructions, luts };
}

type MakeSmartCrankSwbFeedIxForAccountsParams = Omit<
  MakeSmartCrankSwbFeedIxParams,
  "marginfiAccount"
> & {
  /**
   * Accounts targeted by instructions in the set. Each account is projected against
   * the instructions that operate on it (the projection filters by account), so the
   * same full instruction list serves every account. The first account's authority
   * pays the feed updates.
   */
  marginfiAccounts: MarginfiAccountType[];
};

/**
 * Multi-account variant of {@link makeSmartCrankSwbFeedIx} for instruction sets that
 * span several marginfi accounts (e.g. transferring positions: the source is cranked
 * against its withdraws, the destination against its projected post-transfer
 * deposits). Overlapping feeds across accounts are cranked once.
 */
export async function makeSmartCrankSwbFeedIxForAccounts(
  params: MakeSmartCrankSwbFeedIxForAccountsParams
): Promise<{
  instructions: TransactionInstruction[];
  luts: AddressLookupTableAccount[];
}> {
  const crankResults = await Promise.all(
    params.marginfiAccounts.map((marginfiAccount) =>
      computeSmartCrank({ ...params, marginfiAccount })
    )
  );

  const uncrankableLiabilities = crankResults.flatMap((r) => r.uncrankableLiabilities);
  const uncrankableAssets = crankResults.flatMap((r) => r.uncrankableAssets);

  if (uncrankableLiabilities.length > 0) {
    console.log(
      "Uncrankable liability details:",
      uncrankableLiabilities.map((l) => ({
        symbol: l.bank.tokenSymbol,
        reason: l.reason,
      }))
    );
  }
  if (uncrankableAssets.length > 0) {
    console.log(
      "Uncrankable asset details:",
      uncrankableAssets.map((a) => ({
        symbol: a.bank.tokenSymbol,
        reason: a.reason,
      }))
    );
  }

  if (crankResults.some((r) => !r.isCrankable)) {
    throw TransactionBuildingError.oracleCrankFailed(
      uncrankableLiabilities.map((liability) => ({
        bankAddress: liability.bank.address.toBase58(),
        mint: liability.bank.mint.toBase58(),
        symbol: liability.bank.tokenSymbol,
        reason: liability.reason,
      })),
      uncrankableAssets.map((asset) => ({
        bankAddress: asset.bank.address.toBase58(),
        mint: asset.bank.mint.toBase58(),
        symbol: asset.bank.tokenSymbol,
        reason: asset.reason,
      }))
    );
  }

  // makeUpdateSwbFeedIx dedupes by oracle key, so feeds required by several accounts
  // are cranked once.
  return makeUpdateSwbFeedIx({
    swbPullOracles: crankResults.flatMap((r) => r.requiredOracles),
    feePayer: params.marginfiAccounts[0].authority,
    connection: params.connection,
    crossbarUrl: params.crossbarUrl,
  });
}

export const DEFAULT_CROSSBAR_URL = "https://crossbar.0.xyz";
export const DEFAULT_FALLBACK_CROSSBAR_URL  = "https://crossbar.switchboard.xyz";

export async function makeCrankSwbFeedIx(
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  newBanksPk: PublicKey[],
  provider: AnchorProvider,
  crossbarUrl?: string
): Promise<{
  instructions: TransactionInstruction[];
  luts: AddressLookupTableAccount[];
}> {
  // filter active and newly opening balances
  const activeBanksPk = marginfiAccount.balances
    .filter((balance) => balance.active)
    .map((balance) => balance.bankPk);

  const allActiveBanks = [
    ...new Set([
      ...activeBanksPk.map((pk) => pk.toBase58()),
      ...newBanksPk.map((pk) => pk.toBase58()),
    ]).values(),
  ].map((pk) => bankMap.get(pk)!);

  const swbPullBanks = allActiveBanks.filter(
    (bank) => getOracleSourceFromOracleSetup(bank.config.oracleSetup).key === "switchboard"
  );

  if (swbPullBanks.length > 0) {
    const staleOracles = swbPullBanks
      .filter((bank) => {
        return true;
      })
      .filter((bank) => !bank.oracleKey.equals(new PublicKey(ZERO_ORACLE_KEY)))
      .map((bank) => bank.oracleKey);

    if (staleOracles.length > 0) {
      const { instructions, luts } = await makeUpdateSwbFeedIx({
        swbPullOracles: staleOracles.map((oracle) => ({ key: oracle })),
        feePayer: provider.publicKey,
        connection: provider.connection,
        crossbarUrl,
      });
      return { instructions, luts };
    }

    return { instructions: [], luts: [] };
  } else {
    return { instructions: [], luts: [] };
  }
}

export async function makeUpdateSwbFeedIx(props: {
  swbPullOracles: {
    key: PublicKey;
    price?: OraclePrice;
  }[];
  feePayer: PublicKey;
  connection: Connection;
  crossbarUrl?: string;
  fallbackCrossbarUrl?: string;
}): Promise<{
  instructions: TransactionInstruction[];
  luts: AddressLookupTableAccount[];
}> {
  // Deduplicate oracles by address
  const seen = new Set<string>();
  const uniqueOracles = props.swbPullOracles.filter((oracle) => {
    const key = oracle.key.toBase58();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // latest swb intergation
  const dummyWallet = {
    publicKey: props.feePayer,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any[]) => txs,
  } as any;
  const swbProgram = await AnchorUtils.loadProgramFromConnection(props.connection, dummyWallet);

  const pullFeedInstances: PullFeed[] = uniqueOracles.map((oracle) => {
    const pullFeed = new PullFeed(swbProgram, oracle.key);
    // if (oracle.price?.switchboardData) {
    //   const swbData = oracle.price?.switchboardData;

    //   pullFeed.data = {
    //     queue: new PublicKey(swbData.queue),
    //     feedHash: new Uint8Array(Buffer.from(swbData.feedHash, "hex")),
    //     maxVariance: new BN(swbData.maxVariance),
    //     minResponses: swbData.minResponses,
    //   } as PullFeedAccountData;
    // }
    return pullFeed;
  });

  // No crank needed
  if (pullFeedInstances.length === 0) {
    return { instructions: [], luts: [] };
  }

  const primaryUrl = props.crossbarUrl ?? DEFAULT_CROSSBAR_URL;
  const fallbackUrl = props.fallbackCrossbarUrl ?? DEFAULT_FALLBACK_CROSSBAR_URL;

  try {
    const [pullIx, luts] = await PullFeed.fetchUpdateManyIx(swbProgram, {
      feeds: pullFeedInstances,
      numSignatures: 1,
      crossbarClient: new CrossbarClient(primaryUrl),
      payer: props.feePayer,
    });
    return { instructions: pullIx, luts };
  } catch (primaryError) {
    console.warn(`Primary crossbar endpoint failed (${primaryUrl}), trying fallback:`, primaryError);
    const [pullIx, luts] = await PullFeed.fetchUpdateManyIx(swbProgram, {
      feeds: pullFeedInstances,
      numSignatures: 1,
      crossbarClient: new CrossbarClient(fallbackUrl),
      payer: props.feePayer,
    });
    return { instructions: pullIx, luts };
  }
}
