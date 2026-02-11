import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { AnchorUtils, PullFeed } from "@switchboard-xyz/on-demand";
import { CrossbarClient } from "@switchboard-xyz/common";

import { MarginfiAccountType } from "~/services/account";
import { BankType, OracleSetup } from "~/services/bank";
import { MarginfiProgram } from "~/types";
import { TransactionBuildingError } from "~/errors";

import { OraclePrice } from "../types";
import { computeSmartCrank } from "../utils";
import { ZERO_ORACLE_KEY } from "~/constants";

type MakeSmartCrankSwbFeedIxParams = {
  marginfiAccount: MarginfiAccountType;
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  instructions: TransactionInstruction[];
  program: MarginfiProgram;
  connection: Connection;
  crossbarUrl?: string;
};

export async function makeSmartCrankSwbFeedIx(params: MakeSmartCrankSwbFeedIxParams): Promise<{
  instructions: TransactionInstruction[];
  luts: AddressLookupTableAccount[];
}> {
  console.log("[makeSmartCrankSwbFeedIx] Called");
  const crankResult = await computeSmartCrank(params);
  console.log("[makeSmartCrankSwbFeedIx] Crank result:", crankResult);

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

  console.log("[makeSmartCrankSwbFeedIx] Oracles to crank:", oraclesToCrank);
  const { instructions, luts } = await makeUpdateSwbFeedIx({
    swbPullOracles: oraclesToCrank,
    feePayer: params.marginfiAccount.authority,
    connection: params.connection,
  });

  return { instructions, luts };
}

export async function makeCrankSwbFeedIx(
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  newBanksPk: PublicKey[],
  provider: AnchorProvider
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
    (bank) =>
      bank.config.oracleSetup === OracleSetup.SwitchboardPull ||
      bank.config.oracleSetup === OracleSetup.KaminoSwitchboardPull ||
      bank.config.oracleSetup === OracleSetup.DriftSwitchboardPull ||
      bank.config.oracleSetup === OracleSetup.SolendSwitchboardPull
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
      });
      return { instructions, luts };
    }

    return { instructions: [], luts: [] };
  } else {
    return { instructions: [], luts: [] };
  }
}

/**
 * Patches the Switchboard SDK feed hash mismatch bug.
 *
 * The crossbar sometimes re-derives a different feed hash from job definitions than what's
 * stored on-chain. When fetchUpdateManyIx matches crossbar responses to feeds by hash and
 * can't find a match, it puts PublicKey.default (11111111...) in the remaining accounts.
 * When the wrong hash collides with a different feed's hash, it produces a DUPLICATE feed
 * pubkey in the remaining accounts, causing AccountAlreadyInUse errors.
 *
 * This function handles BOTH failure modes:
 * 1. PublicKey.default entries (no hash match → default substituted)
 * 2. Duplicate feed pubkeys (wrong hash matched a different feed)
 *
 * It ONLY operates on the feed section of remaining accounts (after fixed accounts),
 * preserving the legitimate SystemProgram.programId in fixed accounts.
 *
 * Instruction layout: [9 fixed accounts, ...feedPubkeys (writable), ...oraclePubkeys (readonly), ...oracleStats (writable)]
 */
function patchSwbFeedHashMismatch(
  pullIx: TransactionInstruction[],
  expectedFeedPubkeys: PublicKey[]
): void {
  const DEFAULT_KEY = PublicKey.default.toBase58();
  const expectedSet = new Set(expectedFeedPubkeys.map((pk) => pk.toBase58()));
  const numExpectedFeeds = expectedFeedPubkeys.length;

  for (const ix of pullIx) {
    // 1. Find where the feed section starts by locating the first known feed pubkey.
    let feedSectionStart = -1;
    for (let i = 0; i < ix.keys.length; i++) {
      if (expectedSet.has(ix.keys[i].pubkey.toBase58())) {
        feedSectionStart = i;
        break;
      }
    }

    // Fallback: if ALL feeds got default keys (no known feed found in instruction),
    // find the first writable PublicKey.default — feed slots are writable while the
    // legitimate SystemProgram in fixed accounts is not.
    if (feedSectionStart === -1) {
      for (let i = 0; i < ix.keys.length; i++) {
        if (ix.keys[i].pubkey.toBase58() === DEFAULT_KEY && ix.keys[i].isWritable) {
          feedSectionStart = i;
          break;
        }
      }
    }

    if (feedSectionStart === -1) continue;

    // 2. Feed section spans numExpectedFeeds positions starting at feedSectionStart.
    const feedSectionEnd = Math.min(feedSectionStart + numExpectedFeeds, ix.keys.length);

    // 3. Walk the feed section: claim the first occurrence of each expected feed,
    //    mark positions with defaults or duplicates as "needs replacement".
    const claimedFeeds = new Set<string>();
    const badPositions: number[] = [];

    for (let i = feedSectionStart; i < feedSectionEnd; i++) {
      const key = ix.keys[i].pubkey.toBase58();
      if (key === DEFAULT_KEY) {
        // Case 1: PublicKey.default (no hash match)
        badPositions.push(i);
      } else if (expectedSet.has(key) && claimedFeeds.has(key)) {
        // Case 2: Duplicate feed pubkey (wrong hash matched another feed)
        badPositions.push(i);
      } else if (expectedSet.has(key)) {
        claimedFeeds.add(key);
      } else {
        // Unknown key in feed section — shouldn't happen but mark it
        badPositions.push(i);
      }
    }

    // 4. Find which expected feeds are missing (not claimed).
    const missingFeeds = expectedFeedPubkeys.filter((pk) => !claimedFeeds.has(pk.toBase58()));
    if (missingFeeds.length === 0 || badPositions.length === 0) continue;

    // 5. Replace bad positions with missing feeds.
    const replacements = Math.min(missingFeeds.length, badPositions.length);
    for (let j = 0; j < replacements; j++) {
      const i = badPositions[j];
      const oldKey = ix.keys[i].pubkey.toBase58();
      const reason =
        oldKey === DEFAULT_KEY ? "PublicKey.default" : `duplicate(${oldKey.slice(0, 8)}...)`;
      console.log(
        `[patchSwbFeedHashMismatch] ix.keys[${i}]: replacing ${reason} → ${missingFeeds[j].toBase58()}`
      );
      ix.keys[i].pubkey = missingFeeds[j];
    }

    console.log(
      `[patchSwbFeedHashMismatch] Patched ${replacements}/${numExpectedFeeds} feed key(s)`
    );
  }
}

export async function makeUpdateSwbFeedIx(props: {
  swbPullOracles: {
    key: PublicKey;
    price?: OraclePrice;
  }[];
  feePayer: PublicKey;
  connection: Connection;
}): Promise<{
  instructions: TransactionInstruction[];
  luts: AddressLookupTableAccount[];
}> {
  console.log(
    `[makeUpdateSwbFeedIx] Called with ${props.swbPullOracles.length} oracles, feePayer: ${props.feePayer.toBase58()}`
  );

  // Deduplicate oracles by address
  const seen = new Set<string>();
  const uniqueOracles = props.swbPullOracles.filter((oracle) => {
    const key = oracle.key.toBase58();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(
    `[makeUpdateSwbFeedIx] ${uniqueOracles.length} unique oracles after dedup (removed ${props.swbPullOracles.length - uniqueOracles.length})`
  );

  // latest swb integration
  const dummyWallet = {
    publicKey: props.feePayer,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any[]) => txs,
  } as any;
  const swbProgram = await AnchorUtils.loadProgramFromConnection(props.connection, dummyWallet);

  const pullFeedInstances: PullFeed[] = uniqueOracles.map((oracle) => {
    const pullFeed = new PullFeed(swbProgram, oracle.key);
    if (oracle.price?.switchboardData) {
      const swbData = oracle.price?.switchboardData;

      pullFeed.configs = {
        queue: new PublicKey(swbData.queue),
        feedHash: Buffer.from(swbData.feedHash, "hex"),
        maxVariance: Number(swbData.maxVariance),
        minResponses: swbData.minResponses,
        minSampleSize: swbData.minResponses,
      };
    }
    return pullFeed;
  });

  // No crank needed
  if (pullFeedInstances.length === 0) {
    return { instructions: [], luts: [] };
  }

  const crossbarClient = new CrossbarClient(
    process.env.NEXT_PUBLIC_SWITCHBOARD_CROSSSBAR_API || "https://integrator-crossbar.prod.mrgn.app"
  );

  const [pullIx, luts] = await PullFeed.fetchUpdateManyIx(swbProgram, {
    feeds: pullFeedInstances,
    numSignatures: 1,
    crossbarClient,
    payer: props.feePayer,
  });

  console.log(`[makeUpdateSwbFeedIx] Got ${pullIx.length} instructions, ${luts.length} LUTs`);

  // Patch the SDK bug where crossbar feed hash mismatch causes PublicKey.default in remaining accounts
  const expectedFeedPubkeys = pullFeedInstances.map((f) => f.pubkey);
  patchSwbFeedHashMismatch(pullIx, expectedFeedPubkeys);

  return { instructions: pullIx, luts };
}
