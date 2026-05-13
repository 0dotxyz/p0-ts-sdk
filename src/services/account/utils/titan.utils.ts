import {
  V1Client,
  type Instruction as TitanInstruction,
  type SwapQuotes as TitanSwapQuotes,
  type TitanProxySwapQuoteResponse,
  type TitanProxyExactOutResponse,
  deserializeSerializedInstruction,
  selectBestRoute,
  buildSwapQuoteResult,
  resolveLookupTables,
  SwapMode,
} from "~/vendor/titan";
import { getAssociatedTokenAddressSync } from "~/vendor/spl";

import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";

import { SwapApiConfig, SwapIxsResult, SwapProvider, SwapQuoteResult } from "../types";

// --- Constants ---

const TITAN_FEE_WALLET = new PublicKey("FEES6XLN7dMz2iBwKab9Hri9Kwc4WJ6TmDAiT4BNhyej");

// --- Fee account helpers ---

const getTitanFeeAccount = (mint: PublicKey): PublicKey => {
  return getAssociatedTokenAddressSync(mint, TITAN_FEE_WALLET, true);
};

const checkTitanFeeAccount = async (
  connection: Connection,
  mint: PublicKey
): Promise<{ feeAccount: PublicKey; hasFeeAccount: boolean; feeWallet: PublicKey }> => {
  const feeAccount = getTitanFeeAccount(mint);
  const hasFeeAccount = !!(await connection.getAccountInfo(feeAccount));
  return { feeAccount, hasFeeAccount, feeWallet: TITAN_FEE_WALLET };
};

// --- Instruction deserializer ---

function deserializeTitanInstruction(ix: TitanInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.p),
    keys: ix.a.map((account) => ({
      pubkey: new PublicKey(account.p),
      isSigner: account.s,
      isWritable: account.w,
    })),
    data: Buffer.from(ix.d),
  });
}

// --- Params types ---

export type TitanQuoteParams = {
  inputMint: string;
  outputMint: string;
  amount: number;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps?: number;
  platformFeeBps?: number;
  directRoutesOnly?: boolean;
  sizeConstraint?: number;
  maxSwapAccounts?: number;
  maxSwapTotalAccounts?: number;
};

export type GetTitanSwapIxsParams = {
  quoteParams: TitanQuoteParams;
  authority: PublicKey;
  connection: Connection;
  destinationTokenAccount: PublicKey;
  apiConfig?: SwapApiConfig;
};

export type GetTitanExactOutEstimateParams = {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps?: number;
  apiConfig?: SwapApiConfig;
};

export const getTitanSwapIxsForFlashloan = async ({
  quoteParams,
  authority,
  connection,
  destinationTokenAccount,
  apiConfig,
}: GetTitanSwapIxsParams): Promise<SwapIxsResult> => {
  const basePath = apiConfig?.basePath ?? "";

  // Only attach a platform fee / feeAccount when both:
  //   1. the on-chain referral ATA exists, AND
  //   2. the caller actually requested a non-zero platformFeeBps.
  // Mirrors the Jupiter path so callers get consistent behaviour and Titan
  // never receives a `feeAccount` paired with a 0/undefined `feeBps`.
  const feeMint = new PublicKey(
    quoteParams.swapMode === "ExactIn" ? quoteParams.outputMint : quoteParams.inputMint
  );
  const { feeAccount, hasFeeAccount } = await checkTitanFeeAccount(connection, feeMint);
  const useFeeAccount = hasFeeAccount && !!quoteParams.platformFeeBps;

  let finalQuoteParams = quoteParams;
  if (!useFeeAccount) {
    if (!hasFeeAccount) {
      console.warn("Warning: Titan fee account ATA does not exist, disabling platform fee");
    }
    finalQuoteParams = {
      ...quoteParams,
      platformFeeBps: undefined,
    };
  }

  const effectiveFeeAccount = useFeeAccount ? feeAccount : undefined;

  if (basePath.startsWith("wss://") || basePath.startsWith("ws://")) {
    return getTitanSwapIxsViaWebSocket(
      { quoteParams: finalQuoteParams, authority, connection, destinationTokenAccount, apiConfig },
      effectiveFeeAccount
    );
  } else {
    return getTitanSwapIxsViaHttpProxy(
      { quoteParams: finalQuoteParams, authority, connection, destinationTokenAccount, apiConfig },
      effectiveFeeAccount
    );
  }
};

// --- Swap IXs: WebSocket path ---

async function getTitanSwapIxsViaWebSocket(
  params: GetTitanSwapIxsParams,
  feeAccount?: PublicKey
): Promise<SwapIxsResult> {
  const { quoteParams, authority, connection, destinationTokenAccount, apiConfig } = params;
  const {
    inputMint,
    outputMint,
    amount,
    swapMode,
    slippageBps,
    platformFeeBps,
    directRoutesOnly,
    sizeConstraint,
    maxSwapAccounts,
    maxSwapTotalAccounts,
  } = quoteParams;

  const wsUrl = apiConfig?.basePath;
  if (!wsUrl) {
    throw new Error("Titan WebSocket URL is required (apiConfig.basePath)");
  }

  const txParams: Record<string, unknown> = {
    userPublicKey: authority.toBytes(),
    outputAccount: destinationTokenAccount.toBytes(),
  };
  if (feeAccount && platformFeeBps) {
    txParams.feeBps = platformFeeBps;
    txParams.feeAccount = feeAccount.toBytes();
  }

  const client = await V1Client.connect(wsUrl);

  try {
    const { stream } = await client.newSwapQuoteStream({
      swap: {
        inputMint: new PublicKey(inputMint).toBytes(),
        outputMint: new PublicKey(outputMint).toBytes(),
        amount,
        swapMode,
        slippageBps,
        onlyDirectRoutes: directRoutesOnly,
        addSizeConstraint: sizeConstraint !== undefined,
        sizeConstraint,
        accountsLimitWritable: maxSwapAccounts,
        accountsLimitTotal: maxSwapTotalAccounts,
      },
      transaction: txParams,
      update: {
        num_quotes: 3,
      },
    } as unknown as Parameters<typeof client.newSwapQuoteStream>[0]);

    const reader = stream.getReader();
    const { value: swapQuotes, done } = await reader.read();
    reader.releaseLock();

    if (done || !swapQuotes) {
      throw new Error("Titan swap quote stream ended without data");
    }

    const quotes = swapQuotes as unknown as TitanSwapQuotes;
    const bestRoute = selectBestRoute(quotes.quotes, swapMode);
    if (!bestRoute) {
      throw new Error(`No Titan swap routes found for ${inputMint} -> ${outputMint}`);
    }

    // Deserialize instructions
    const swapInstructions = bestRoute.instructions.map(deserializeTitanInstruction);

    // Resolve LUTs
    const lutPubkeys = bestRoute.addressLookupTables.map((lutBytes) => new PublicKey(lutBytes));
    const addressLookupTableAddresses = await resolveLookupTables(connection, lutPubkeys);

    // Build quote result
    const quoteResponse = {
      ...buildSwapQuoteResult(bestRoute, swapMode),
      provider: SwapProvider.TITAN,
    };

    return {
      swapInstructions,
      setupInstructions: [],
      addressLookupTableAddresses,
      quoteResponse,
    };
  } finally {
    if (!client.closed) {
      await client.close();
    }
  }
}

// --- Swap IXs: HTTP proxy path ---

async function getTitanSwapIxsViaHttpProxy(
  params: GetTitanSwapIxsParams,
  feeAccount?: PublicKey
): Promise<SwapIxsResult> {
  const { quoteParams, authority, connection, destinationTokenAccount, apiConfig } = params;
  const {
    inputMint,
    outputMint,
    amount,
    swapMode,
    slippageBps,
    platformFeeBps,
    directRoutesOnly,
    sizeConstraint,
    maxSwapAccounts,
    maxSwapTotalAccounts,
  } = quoteParams;

  const basePath = apiConfig?.basePath;
  if (!basePath) {
    throw new Error("Titan proxy URL is required (apiConfig.basePath)");
  }

  const txBody: Record<string, unknown> = {
    userPublicKey: authority.toBase58(),
    outputAccount: destinationTokenAccount.toBase58(),
  };
  if (feeAccount && platformFeeBps) {
    txBody.feeBps = platformFeeBps;
    txBody.feeAccount = feeAccount.toBase58();
  }

  const response = await fetch(`${basePath}/swap-quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiConfig?.headers ?? {}),
    },
    body: JSON.stringify({
      swap: {
        inputMint,
        outputMint,
        amount,
        swapMode,
        slippageBps,
        onlyDirectRoutes: directRoutesOnly,
        addSizeConstraint: sizeConstraint !== undefined,
        sizeConstraint,
        accountsLimitWritable: maxSwapAccounts,
        accountsLimitTotal: maxSwapTotalAccounts,
      },
      transaction: txBody,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Titan proxy error (${response.status}): ${(errorData as { message?: string }).message ?? response.statusText}`
    );
  }

  const data = (await response.json()) as TitanProxySwapQuoteResponse;

  const bestRoute = selectBestRoute(data.quotes, swapMode);
  if (!bestRoute) {
    throw new Error(`No Titan swap routes found for ${inputMint} -> ${outputMint}`);
  }

  // Deserialize instructions from base64
  const swapInstructions = bestRoute.instructions.map(deserializeSerializedInstruction);

  // Resolve LUTs from base64 pubkeys
  const lutPubkeys = bestRoute.addressLookupTables.map(
    (b64) => new PublicKey(Buffer.from(b64, "base64"))
  );
  const addressLookupTableAddresses = await resolveLookupTables(connection, lutPubkeys);

  const quoteResponse = {
    ...buildSwapQuoteResult(bestRoute, swapMode),
    provider: SwapProvider.TITAN,
  };

  return {
    swapInstructions,
    setupInstructions: [],
    addressLookupTableAddresses,
    quoteResponse,
  };
}

// --- ExactOut estimate: public API ---

export const getTitanExactOutEstimate = async (
  params: GetTitanExactOutEstimateParams
): Promise<{ otherAmountThreshold: string; quoteResult: SwapQuoteResult }> => {
  const basePath = params.apiConfig?.basePath ?? "";

  if (basePath.startsWith("wss://") || basePath.startsWith("ws://")) {
    return getTitanExactOutViaWebSocket(params);
  } else {
    return getTitanExactOutViaHttpProxy(params);
  }
};

// --- ExactOut estimate: WebSocket path ---

async function getTitanExactOutViaWebSocket(
  params: GetTitanExactOutEstimateParams
): Promise<{ otherAmountThreshold: string; quoteResult: SwapQuoteResult }> {
  const { inputMint, outputMint, amount, slippageBps, apiConfig } = params;

  const wsUrl = apiConfig?.basePath;
  if (!wsUrl) {
    throw new Error("Titan WebSocket URL is required (apiConfig.basePath)");
  }

  const client = await V1Client.connect(wsUrl);

  try {
    const { stream } = await client.newSwapQuoteStream({
      swap: {
        inputMint: new PublicKey(inputMint).toBytes(),
        outputMint: new PublicKey(outputMint).toBytes(),
        amount,
        swapMode: SwapMode.ExactOut,
        slippageBps,
      },
      transaction: {
        userPublicKey: new Uint8Array(32), // placeholder, not executing
      },
      update: {
        num_quotes: 1,
      },
    });

    const reader = stream.getReader();
    const { value: swapQuotes, done } = await reader.read();
    reader.releaseLock();

    if (done || !swapQuotes) {
      throw new Error("Titan ExactOut estimate stream ended without data");
    }

    const quotes = swapQuotes as unknown as TitanSwapQuotes;
    const bestRoute = selectBestRoute(quotes.quotes, "ExactOut");
    if (!bestRoute) {
      throw new Error(`No Titan ExactOut routes found for ${inputMint} -> ${outputMint}`);
    }

    const quoteResult = {
      ...buildSwapQuoteResult(bestRoute, "ExactOut"),
      provider: SwapProvider.TITAN,
    };

    return {
      otherAmountThreshold: quoteResult.otherAmountThreshold,
      quoteResult,
    };
  } finally {
    if (!client.closed) {
      await client.close();
    }
  }
}

// --- ExactOut estimate: HTTP proxy path ---

async function getTitanExactOutViaHttpProxy(
  params: GetTitanExactOutEstimateParams
): Promise<{ otherAmountThreshold: string; quoteResult: SwapQuoteResult }> {
  const { inputMint, outputMint, amount, slippageBps, apiConfig } = params;

  const basePath = apiConfig?.basePath;
  if (!basePath) {
    throw new Error("Titan proxy URL is required (apiConfig.basePath)");
  }

  const response = await fetch(`${basePath}/exact-out-estimate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiConfig?.headers ?? {}),
    },
    body: JSON.stringify({
      inputMint,
      outputMint,
      amount,
      slippageBps,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Titan proxy error (${response.status}): ${(errorData as { message?: string }).message ?? response.statusText}`
    );
  }

  const data = (await response.json()) as TitanProxyExactOutResponse;

  const quoteResult: SwapQuoteResult = {
    inAmount: String(data.inAmount),
    outAmount: String(data.outAmount),
    otherAmountThreshold: data.otherAmountThreshold,
    slippageBps: data.slippageBps,
    provider: SwapProvider.TITAN,
  };

  return {
    otherAmountThreshold: data.otherAmountThreshold,
    quoteResult,
  };
}
