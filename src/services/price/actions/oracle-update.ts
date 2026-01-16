import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { BN } from "bn.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { AnchorUtils, Gateway, PullFeed, PullFeedAccountData } from "@switchboard-xyz/on-demand";
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
  // Deduplicate oracles by address
  const seen = new Set<string>();
  const uniqueOracles = props.swbPullOracles.filter((oracle) => {
    const key = oracle.key.toBase58();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // latest swb intergation
  const swbProgram = await AnchorUtils.loadProgramFromConnection(props.connection);

  const pullFeedInstances: PullFeed[] = uniqueOracles.map((oracle) => {
    const pullFeed = new PullFeed(swbProgram, oracle.key);
    if (oracle.price?.switchboardData) {
      const swbData = oracle.price?.switchboardData;

      pullFeed.data = {
        queue: new PublicKey(swbData.queue),
        feedHash: new Uint8Array(Buffer.from(swbData.feedHash, "hex")),
        maxVariance: new BN(swbData.maxVariance),
        minResponses: swbData.minResponses,
      } as PullFeedAccountData;
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

  const gatewayUrls = await crossbarClient.fetchGateways("mainnet");
  if (!gatewayUrls || gatewayUrls.length === 0) {
    throw new Error(`No gateways available for mainnet`);
  }

  const gatewayUrl = gatewayUrls[0];
  if (!gatewayUrl) {
    throw new Error(`Invalid gateway URL received formainnet`);
  }

  const gateway = new Gateway(swbProgram, gatewayUrl);

  const [pullIx, luts] = await PullFeed.fetchUpdateManyIx(swbProgram, {
    feeds: pullFeedInstances,
    gateway: gateway.gatewayUrl,
    numSignatures: 1,
    payer: props.feePayer,
    crossbarClient,
  });

  return { instructions: pullIx, luts };
}
