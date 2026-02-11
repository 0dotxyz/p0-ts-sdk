import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { BN } from "bn.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { AnchorUtils, PullFeed, PullFeedAccountData } from "@switchboard-xyz/on-demand";
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
  console.log(`[makeUpdateSwbFeedIx] Loading SWB program from connection...`);
  const swbProgram = await AnchorUtils.loadProgramFromConnection(props.connection);
  console.log(
    `[makeUpdateSwbFeedIx] SWB program loaded - programId: ${swbProgram.programId.toBase58()}`
  );

  const pullFeedInstances: PullFeed[] = uniqueOracles.map((oracle) => {
    const pullFeed = new PullFeed(swbProgram, oracle.key);
    console.log(
      `[makeUpdateSwbFeedIx] Created PullFeed for ${oracle.key.toBase58()} - no switchboardData set (commented out)`
    );
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

  console.log(
    `[makeUpdateSwbFeedIx] pullFeedInstances:`,
    pullFeedInstances.map((f) => ({ key: f.pubkey.toBase58(), hasConfigs: !!f.configs }))
  );

  // No crank needed
  if (pullFeedInstances.length === 0) {
    console.log(`[makeUpdateSwbFeedIx] No pull feed instances, returning early`);
    return { instructions: [], luts: [] };
  }

  const crossbarClient = new CrossbarClient(
    process.env.NEXT_PUBLIC_SWITCHBOARD_CROSSSBAR_API || "https://integrator-crossbar.prod.mrgn.app"
  );

  console.log(
    `[makeUpdateSwbFeedIx] crossbarClient URL: ${process.env.NEXT_PUBLIC_SWITCHBOARD_CROSSSBAR_API || "https://integrator-crossbar.prod.mrgn.app"}`
  );
  console.log(
    `[makeUpdateSwbFeedIx] SWB on-demand version: 2.14.4, common version: 4.1.0 (alpha.1)`
  );

  console.log(`[makeUpdateSwbFeedIx] Resolving gateway from feed's on-chain queue...`);
  const queue = await pullFeedInstances[0].fetchQueue();
  const gw = await queue.fetchGateway();
  const gateway = gw.gatewayUrl;
  console.log(`[makeUpdateSwbFeedIx] Resolved gateway: ${gateway}`);

  try {
    // Verify feed accounts exist before calling fetchUpdateManyIx
    for (const feed of pullFeedInstances) {
      try {
        const accountInfo = await props.connection.getAccountInfo(feed.pubkey);
        console.log(
          `[makeUpdateSwbFeedIx] Feed account ${feed.pubkey.toBase58()}: exists=${!!accountInfo}, owner=${accountInfo?.owner?.toBase58() ?? "N/A"}, dataLen=${accountInfo?.data?.length ?? 0}`
        );
        if (accountInfo?.data) {
          const discriminator = accountInfo.data.slice(0, 8);
          console.log(
            `[makeUpdateSwbFeedIx] Feed account ${feed.pubkey.toBase58()} discriminator: [${Array.from(discriminator).join(", ")}]`
          );
        }
      } catch (accErr) {
        console.error(
          `[makeUpdateSwbFeedIx] Failed to fetch account info for ${feed.pubkey.toBase58()}:`,
          accErr
        );
      }
    }

    console.log(`[makeUpdateSwbFeedIx] Calling PullFeed.fetchUpdateManyIx...`);
    const [pullIx, luts] = await PullFeed.fetchUpdateManyIx(swbProgram, {
      feeds: pullFeedInstances,
      gateway,
      numSignatures: 1,
      payer: props.feePayer,
      crossbarClient,
    });

    console.log(`[makeUpdateSwbFeedIx] Got ${pullIx.length} instructions, ${luts.length} LUTs`);

    return { instructions: pullIx, luts };
  } catch (err: any) {
    console.error(`[makeUpdateSwbFeedIx] fetchUpdateManyIx FAILED:`, err?.message || err);
    console.error(`[makeUpdateSwbFeedIx] Error name: ${err?.name}, code: ${err?.code}`);
    if (err?.logs) {
      console.error(`[makeUpdateSwbFeedIx] Error logs:`, err.logs);
    }
    if (err?.stack) {
      console.error(`[makeUpdateSwbFeedIx] Stack:`, err.stack);
    }
    throw err;
  }
}
