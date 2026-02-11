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

  // latest swb integration
  const dummyWallet = {
    publicKey: props.feePayer,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any[]) => txs,
  } as any;
  console.log(`[makeUpdateSwbFeedIx] Loading SWB program from connection...`);
  const swbProgram = await AnchorUtils.loadProgramFromConnection(props.connection, dummyWallet);
  console.log(
    `[makeUpdateSwbFeedIx] SWB program loaded - programId: ${swbProgram.programId.toBase58()}`
  );

  const pullFeedInstances: PullFeed[] = uniqueOracles.map((oracle) => {
    const pullFeed = new PullFeed(swbProgram, oracle.key);
    // if (oracle.price?.switchboardData) {
    //   const swbData = oracle.price?.switchboardData;
    //   console.log(`[makeUpdateSwbFeedIx] Setting configs for ${oracle.key.toBase58()}:`, {
    //     queue: swbData.queue,
    //     feedHash: swbData.feedHash,
    //     maxVariance: swbData.maxVariance,
    //     minResponses: swbData.minResponses,
    //   });

    //   pullFeed.configs = {
    //     queue: new PublicKey(swbData.queue),
    //     feedHash: Buffer.from(swbData.feedHash, "hex"),
    //     maxVariance: Number(swbData.maxVariance),
    //     minResponses: swbData.minResponses,
    //     minSampleSize: swbData.minResponses,
    //   };
    // } else {
    //   console.log(
    //     `[makeUpdateSwbFeedIx] No switchboardData for ${oracle.key.toBase58()} - feed will need on-chain fetch`
    //   );
    // }
    return pullFeed;
  });

  // No crank needed
  if (pullFeedInstances.length === 0) {
    console.log(`[makeUpdateSwbFeedIx] No pull feed instances, returning early`);
    return { instructions: [], luts: [] };
  }

  const crossbarClient = new CrossbarClient(
    process.env.NEXT_PUBLIC_SWITCHBOARD_CROSSSBAR_API || "https://integrator-crossbar.prod.mrgn.app"
  );

  console.log(`[makeUpdateSwbFeedIx] Fetching update ix for ${pullFeedInstances.length} feeds`);
  console.log(
    `[makeUpdateSwbFeedIx] pullFeedInstances:`,
    pullFeedInstances.map((f) => ({ key: f.pubkey.toBase58(), hasConfigs: !!f.configs }))
  );
  console.log(
    `[makeUpdateSwbFeedIx] crossbarClient URL: ${process.env.NEXT_PUBLIC_SWITCHBOARD_CROSSSBAR_API || "https://integrator-crossbar.prod.mrgn.app"}`
  );
  console.log(
    `[makeUpdateSwbFeedIx] SWB on-demand version: 3.9.0, common version: 5.7.0 (alpha.2)`
  );

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
      numSignatures: 1,
      crossbarClient,
    });

    console.log(`[makeUpdateSwbFeedIx] Got ${pullIx.length} instructions, ${luts.length} LUTs`);

    // Diagnostic: inspect the pullFeedSubmitResponseConsensus instruction accounts
    const DEFAULT_KEY = "11111111111111111111111111111111";
    for (let ixIdx = 0; ixIdx < pullIx.length; ixIdx++) {
      const ix = pullIx[ixIdx];
      console.log(
        `[makeUpdateSwbFeedIx] Instruction ${ixIdx}: programId=${ix.programId.toBase58()}, keys=${ix.keys.length}, dataLen=${ix.data.length}`
      );

      // The second instruction (idx=1) is pullFeedSubmitResponseConsensus
      if (ixIdx === 1) {
        console.log(
          `[makeUpdateSwbFeedIx] === pullFeedSubmitResponseConsensus account inspection ===`
        );
        const hasDefault = ix.keys.some((k) => k.pubkey.toBase58() === DEFAULT_KEY);
        console.log(
          `[makeUpdateSwbFeedIx] Contains PublicKey.default (System Program)? ${hasDefault}`
        );

        ix.keys.forEach((k, keyIdx) => {
          const addr = k.pubkey.toBase58();
          const flag = addr === DEFAULT_KEY ? " ⚠️ DEFAULT KEY" : "";
          console.log(
            `[makeUpdateSwbFeedIx]   key[${keyIdx}]: ${addr} (signer=${k.isSigner}, writable=${k.isWritable})${flag}`
          );
        });
      }
    }

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
