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
  uniqueOracles.forEach((o) =>
    console.log(
      `[makeUpdateSwbFeedIx]   - ${o.key.toBase58()} (hasSwitchboardData: ${!!o.price?.switchboardData})`
    )
  );

  // latest swb intergation
  const swbProgram = await AnchorUtils.loadProgramFromConnection(props.connection);
  console.log(`[DIAG][p0] swbProgram.programId: ${swbProgram.programId.toBase58()}`);

  const pullFeedInstances: PullFeed[] = uniqueOracles.map((oracle) => {
    const pullFeed = new PullFeed(swbProgram, oracle.key);
    return pullFeed;
  });
  console.log(`[DIAG][p0] ${pullFeedInstances.length} PullFeed instances after filtering`);

  // No crank needed
  if (pullFeedInstances.length === 0) {
    console.log(`[DIAG][p0] No pull feed instances, returning early`);
    return { instructions: [], luts: [] };
  }

  const crossbarUrl =
    process.env.NEXT_PUBLIC_SWITCHBOARD_CROSSSBAR_API ||
    "https://integrator-crossbar.prod.mrgn.app";
  console.log(`[DIAG][p0] crossbarUrl: ${crossbarUrl}`);
  const crossbarClient = new CrossbarClient(crossbarUrl);

  const gateway = await pullFeedInstances[0].fetchGatewayUrl(crossbarClient);
  console.log(`[DIAG][p0] gateway: ${gateway}`);

  // Load on-chain feed data for comparison
  for (const feed of pullFeedInstances) {
    try {
      const data = await feed.loadData();
      const feedHashHex = Buffer.from(data.feedHash).toString("hex");
      console.log(`[DIAG][p0] feed ${feed.pubkey.toBase58()} on-chain feedHash: ${feedHashHex}`);
      console.log(`[DIAG][p0] feed ${feed.pubkey.toBase58()} queue: ${data.queue.toBase58()}`);
      console.log(
        `[DIAG][p0] feed ${feed.pubkey.toBase58()} maxVariance: ${data.maxVariance}, minResponses: ${data.minResponses}`
      );
    } catch (e: any) {
      console.log(`[DIAG][p0] feed ${feed.pubkey.toBase58()} loadData failed: ${e.message}`);
    }
  }

  const [pullIx, luts] = await PullFeed.fetchUpdateManyIx(swbProgram, {
    feeds: pullFeedInstances,
    gateway,
    numSignatures: 1,
    payer: props.feePayer,
    crossbarClient,
  });

  console.log(`[DIAG][p0] fetchUpdateManyIx returned ${pullIx.length} ixs, ${luts.length} LUTs`);
  pullIx.forEach((ix, i) => {
    console.log(
      `[DIAG][p0] ix[${i}] programId: ${ix.programId.toBase58()}, keys: ${ix.keys.length}, data.length: ${ix.data.length}`
    );
    ix.keys.forEach((k, j) =>
      console.log(
        `[DIAG][p0]   key[${j}]: ${k.pubkey.toBase58()} (signer=${k.isSigner}, writable=${k.isWritable})`
      )
    );
  });

  return { instructions: pullIx, luts };
}
