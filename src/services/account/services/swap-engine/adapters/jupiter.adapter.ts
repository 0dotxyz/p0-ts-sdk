import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

import { createJupiterClient, type BuildResponse, type Instruction } from "~/vendor/jupiter";
import { ADDRESS_LOOKUP_TABLE_FOR_SWAP, MAX_ACCOUNT_LOCKS } from "~/constants";

import { SwapApiConfig, SwapProvider, SwapQuoteResult } from "~/services/account/types";
import { checkJupiterFeeAccount, toJupiterConfig } from "~/services/account/utils/jupiter.utils";
import { ProviderSwapRoute, SwapAdapter, SwapEngineRequest } from "../types";

// Even when an account count fits MAX_ACCOUNT_LOCKS, Jupiter routes that use all
// remaining slots tend to produce swap IXs large enough to blow the byte limit.
// Titan constrains bytes directly via its template, so this margin is Jupiter-only.
const JUPITER_MAX_ACCOUNTS_MARGIN = 4;
const JUPITER_MIN_MAX_ACCOUNTS = 16;

function deserializeJupiterInstruction(ix: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

/** Build ALT accounts from the Router's inline `addressesByLookupTableAddress`. */
function lutsFromAddressMap(
  map: Record<string, string[]> | null | undefined
): AddressLookupTableAccount[] {
  if (!map) return [];
  return Object.entries(map).map(
    ([key, addresses]) =>
      new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: {
          deactivationSlot: BigInt("18446744073709551615"), // u64 max = active
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          addresses: addresses.map((a) => new PublicKey(a)),
        },
      })
  );
}

function mapBuildToQuoteResult(build: BuildResponse): SwapQuoteResult {
  return {
    inAmount: build.inAmount,
    outAmount: build.outAmount,
    otherAmountThreshold: build.otherAmountThreshold,
    slippageBps: build.slippageBps,
    // /build does not return priceImpactPct; leave undefined.
    provider: SwapProvider.JUPITER,
  };
}

/** Default maxAccounts ladder derived from the remaining account budget. */
function defaultLadder(maxSwapTotalAccounts: number): number[] {
  const top = maxSwapTotalAccounts - JUPITER_MAX_ACCOUNTS_MARGIN;
  const rungs = [top, top - 6, top - 12]
    .map((n) => Math.max(JUPITER_MIN_MAX_ACCOUNTS, n))
    .filter((n) => n > 0);
  return [...new Set(rungs)];
}

async function buildCandidates(
  req: SwapEngineRequest,
  apiConfig?: SwapApiConfig
): Promise<ProviderSwapRoute[]> {
  const client = createJupiterClient(toJupiterConfig(apiConfig));

  // ExactIn: fee taken on the output mint.
  const { feeAccount, hasFeeAccount } = await checkJupiterFeeAccount(
    req.connection,
    new PublicKey(req.outputMint)
  );
  const useFee = hasFeeAccount && !!req.platformFeeBps;

  const project0Lut = (await req.connection.getAddressLookupTable(ADDRESS_LOOKUP_TABLE_FOR_SWAP))
    ?.value;

  const ladder =
    req.jupiterMaxAccountsLadder ??
    defaultLadder(req.footprint?.maxSwapTotalAccounts ?? MAX_ACCOUNT_LOCKS);

  const settled = await Promise.allSettled(
    ladder.map(async (maxAccounts): Promise<ProviderSwapRoute> => {
      const build = await client.buildGet({
        inputMint: req.inputMint,
        outputMint: req.outputMint,
        amount: req.amountNative,
        taker: req.taker.toBase58(),
        slippageBps: req.slippageBps,
        mode: "fast",
        maxAccounts,
        wrapAndUnwrapSol: false,
        destinationTokenAccount: req.destinationTokenAccount.toBase58(),
        platformFeeBps: useFee ? req.platformFeeBps : undefined,
        feeAccount: useFee ? feeAccount : undefined,
      });

      const luts = lutsFromAddressMap(build.addressesByLookupTableAddress);
      if (project0Lut) luts.push(project0Lut);

      return {
        provider: SwapProvider.JUPITER,
        swapInstructions: [deserializeJupiterInstruction(build.swapInstruction)],
        setupInstructions: (build.setupInstructions ?? []).map(deserializeJupiterInstruction),
        luts,
        outAmountNative: new BN(build.outAmount),
        otherAmountThresholdNative: new BN(build.otherAmountThreshold),
        quoteResult: mapBuildToQuoteResult(build),
        label: `jupiter:maxAccounts=${maxAccounts}`,
      };
    })
  );

  const routes = settled
    .filter((r): r is PromiseFulfilledResult<ProviderSwapRoute> => r.status === "fulfilled")
    .map((r) => r.value);

  if (routes.length === 0) {
    const firstError = settled.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    throw firstError?.reason instanceof Error
      ? firstError.reason
      : new Error("Jupiter Router returned no routes");
  }

  return routes;
}

export const jupiterAdapter: SwapAdapter = {
  name: SwapProvider.JUPITER,
  supportsBuild: true,
  buildCandidates,
};
