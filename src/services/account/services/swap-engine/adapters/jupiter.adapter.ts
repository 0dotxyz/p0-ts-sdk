import {
  address,
  fetchAddressesForLookupTables,
  fetchEncodedAccount,
  getAddressEncoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  type Address,
  type AddressesByLookupTableAddress,
  type GetAccountInfoApi,
  type Instruction,
  type Rpc,
} from "@solana/kit";

import { ProviderSwapRoute, SwapAdapter, SwapEngineRequest } from "../types";

import { ADDRESS_LOOKUP_TABLE_FOR_SWAP, MAX_ACCOUNT_LOCKS } from "~/constants";
import { SwapApiConfig, SwapProvider, SwapQuoteResult } from "~/services/account/types";
import { toAccountRole } from "~/utils";
import {
  createJupiterClient,
  type BuildResponse,
  type Instruction as JupiterInstruction,
  type JupiterClientConfig,
} from "~/vendor/jupiter";

// Even when an account count fits MAX_ACCOUNT_LOCKS, Jupiter routes that use all
// remaining slots tend to produce swap IXs large enough to blow the byte limit.
// Titan constrains bytes directly via its template, so this margin is Jupiter-only.
const JUPITER_MAX_ACCOUNTS_MARGIN = 4;
const JUPITER_MIN_MAX_ACCOUNTS = 16;

// Jupiter's `forJitoBundle` exclusion list currently misses GoonFi V2, whose
// pool accounts include a validator vote account (J1to1yuf...) — Jito rejects
// any bundle locking one ("bundles cannot lock any vote accounts"). Exclude it
// explicitly until Jupiter adds it to the flag's list.
const BUNDLE_INCOMPATIBLE_DEXES = ["GoonFi V2"];

const REFERRAL_PROGRAM_ID = address("REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3");
const REFERRAL_ACCOUNT_PUBKEY = address("6rQUBEfS3hASrBbviL7rXA5tRYmZmeFUgHgCYsjeDVBm");

async function checkJupiterFeeAccount(
  rpc: Rpc<GetAccountInfoApi>,
  mint: Address
): Promise<{ feeAccount: Address; hasFeeAccount: boolean }> {
  const [feeAccount] = await getProgramDerivedAddress({
    programAddress: REFERRAL_PROGRAM_ID,
    seeds: [
      "referral_ata",
      getAddressEncoder().encode(REFERRAL_ACCOUNT_PUBKEY),
      getAddressEncoder().encode(mint),
    ],
  });
  const hasFeeAccount = (await fetchEncodedAccount(rpc, feeAccount)).exists;
  return { feeAccount, hasFeeAccount };
}

function deserializeJupiterInstruction(instruction: JupiterInstruction): Instruction {
  return {
    programAddress: address(instruction.programId),
    accounts: instruction.accounts.map((key) => ({
      address: address(key.pubkey),
      role: toAccountRole(key.isSigner, key.isWritable),
    })),
    data: getBase64Encoder().encode(instruction.data),
  };
}

function toJupiterConfig(apiConfig?: SwapApiConfig): JupiterClientConfig | undefined {
  if (!apiConfig) return undefined;
  return {
    basePath: apiConfig.basePath,
    apiKey: apiConfig.apiKey,
    headers: apiConfig.headers,
  };
}

/** Lookup tables from the Router's inline `addressesByLookupTableAddress`. */
function lutsFromAddressMap(
  map: Record<string, string[]> | null | undefined
): AddressesByLookupTableAddress {
  return Object.fromEntries(
    Object.entries(map ?? {}).map(([key, addresses]) => [
      address(key),
      addresses.map((a) => address(a)),
    ])
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
    req.rpc,
    address(req.outputMint)
  );
  const useFee = hasFeeAccount && !!req.platformFeeBps;

  const project0Lut = await fetchAddressesForLookupTables([ADDRESS_LOOKUP_TABLE_FOR_SWAP], req.rpc);

  const ladder =
    req.jupiterMaxAccountsLadder ??
    defaultLadder(req.footprint?.maxSwapTotalAccounts ?? MAX_ACCOUNT_LOCKS);

  const settled = await Promise.allSettled(
    ladder.map(async (maxAccounts): Promise<ProviderSwapRoute> => {
      const build = await client.buildGet({
        inputMint: req.inputMint,
        outputMint: req.outputMint,
        amount: req.amountNative,
        taker: req.taker,
        slippageBps: req.slippageBps,
        mode: "fast",
        maxAccounts,
        wrapAndUnwrapSol: false,
        // The swap engine always executes inside a Jito bundle; without this
        // the Router may route through DEXes whose swaps lock vote accounts,
        // which Jito rejects ("bundles cannot lock any vote accounts").
        forJitoBundle: true,
        excludeDexes: BUNDLE_INCOMPATIBLE_DEXES,
        destinationTokenAccount: req.destinationTokenAccount,
        platformFeeBps: useFee ? req.platformFeeBps : undefined,
        feeAccount: useFee ? feeAccount : undefined,
      });

      const luts = { ...lutsFromAddressMap(build.addressesByLookupTableAddress), ...project0Lut };

      return {
        provider: SwapProvider.JUPITER,
        swapInstructions: [deserializeJupiterInstruction(build.swapInstruction)],
        setupInstructions: (build.setupInstructions ?? []).map(deserializeJupiterInstruction),
        luts,
        outAmountNative: BigInt(build.outAmount),
        otherAmountThresholdNative: BigInt(build.otherAmountThreshold),
        quoteResult: mapBuildToQuoteResult(build),
        label: `jupiter:maxAccounts=${maxAccounts}`,
      };
    })
  );

  const routes = settled
    .filter((r): r is PromiseFulfilledResult<ProviderSwapRoute> => r.status === "fulfilled")
    .map((r) => r.value);

  if (routes.length === 0) {
    const firstError = settled.find((r) => r.status === "rejected");
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
