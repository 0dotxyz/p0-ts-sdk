import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

import { SwapApiConfig, SwapIxsResult } from "../types";

import { mapJupiterQuoteToSwapQuoteResult } from "./swap.utils";

import { ADDRESS_LOOKUP_TABLE_FOR_SWAP } from "~/constants";
import {
  createJupiterClient,
  type JupiterClientConfig,
  type QuoteGetRequest,
  type Instruction as JupiterInstruction,
} from "~/vendor/jupiter";

const REFERRAL_PROGRAM_ID = new PublicKey("REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3");
const REFERRAL_ACCOUNT_PUBKEY = new PublicKey("6rQUBEfS3hASrBbviL7rXA5tRYmZmeFUgHgCYsjeDVBm");

export const getJupiterReferralFeeAccount = (mint: PublicKey): string => {
  const [feeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("referral_ata"), REFERRAL_ACCOUNT_PUBKEY.toBuffer(), mint.toBuffer()],
    REFERRAL_PROGRAM_ID
  );
  return feeAccount.toBase58();
};

export const checkJupiterFeeAccount = async (
  connection: Connection,
  mint: PublicKey
): Promise<{ feeAccount: string; hasFeeAccount: boolean }> => {
  const feeAccount = getJupiterReferralFeeAccount(mint);
  const hasFeeAccount = !!(await connection.getAccountInfo(new PublicKey(feeAccount)));
  return { feeAccount, hasFeeAccount };
};

function deserializeJupiterInstruction(instruction: JupiterInstruction) {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((key) => ({
      pubkey: new PublicKey(key.pubkey),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: Buffer.from(instruction.data, "base64"),
  });
}

export function toJupiterConfig(apiConfig?: SwapApiConfig): JupiterClientConfig | undefined {
  if (!apiConfig) return undefined;
  return {
    basePath: apiConfig.basePath,
    apiKey: apiConfig.apiKey,
    headers: apiConfig.headers,
  };
}

type GetJupiterSwapIxsForFlashloanParams = {
  quoteParams: QuoteGetRequest;
  authority: PublicKey;
  connection: Connection;
  destinationTokenAccount: PublicKey;
  apiConfig?: SwapApiConfig;
  maxSwapAccounts?: number;
};

export const getJupiterSwapIxsForFlashloan = async ({
  quoteParams,
  authority,
  connection,
  destinationTokenAccount,
  apiConfig,
  maxSwapAccounts,
}: GetJupiterSwapIxsForFlashloanParams): Promise<SwapIxsResult> => {
  const jupiterApiClient = createJupiterClient(toJupiterConfig(apiConfig));

  const feeMint =
    quoteParams.swapMode === "ExactIn" ? quoteParams.outputMint : quoteParams.inputMint;
  const { feeAccount, hasFeeAccount } = await checkJupiterFeeAccount(
    connection,
    new PublicKey(feeMint)
  );
  const project0JupiterLut = (await connection.getAddressLookupTable(ADDRESS_LOOKUP_TABLE_FOR_SWAP))
    ?.value;

  // Only attach a platform fee / feeAccount when both:
  //   1. the on-chain referral ATA exists, AND
  //   2. the caller actually requested a non-zero platformFeeBps.
  // Jupiter rejects swap requests with a `feeAccount` when the resulting
  // quote has no `platformFee` ("platformFee must be greater than 0 when
  // feeAccount is set"), so we must strip both together.
  const useFeeAccount = hasFeeAccount && !!quoteParams.platformFeeBps;

  let finalQuoteParams: QuoteGetRequest = quoteParams;
  // Ideally we shouldn't be checking this, slows the entire flow down by a rpc call
  if (!useFeeAccount) {
    if (!hasFeeAccount) {
      // TODO: setup logging if a fee account has not been created
      console.warn("Warning: feeAccountInfo is undefined");
    }
    // removes platformFeeBps from quoteParams to avoid errors
    finalQuoteParams = {
      ...quoteParams,
      platformFeeBps: undefined,
    };
  }

  // Apply a Jupiter-specific safety margin on top of the shared flashloan
  // account budget: even when accounts fit MAX_ACCOUNT_LOCKS, Jupiter routes
  // that consume all remaining slots tend to produce swap IXs large enough to
  // blow the 1232-byte TX size limit. Titan lets us constrain IX bytes
  // directly via `sizeConstraint`, so the margin is only needed here.
  const JUPITER_MAX_ACCOUNTS_MARGIN = 4;
  const maxAccounts =
    maxSwapAccounts !== undefined ? maxSwapAccounts - JUPITER_MAX_ACCOUNTS_MARGIN : 40;

  const swapQuote = await jupiterApiClient.quoteGet({
    ...finalQuoteParams,
    maxAccounts,
    // Flashloan swaps are landed via a Jito bundle, so restrict routing to
    // bundle-compatible DEXes (excludes e.g. HumidiFi).
    forJitoBundle: true,
  });

  const swapInstructionResponse = await jupiterApiClient.swapInstructionsPost({
    swapRequest: {
      quoteResponse: swapQuote,
      userPublicKey: authority.toBase58(),
      feeAccount: useFeeAccount ? feeAccount : undefined,
      wrapAndUnwrapSol: false,
      destinationTokenAccount: destinationTokenAccount.toBase58(),
    },
  });

  const lutAddresses = swapInstructionResponse.addressLookupTableAddresses;

  const lutAccountsRaw = await connection.getMultipleAccountsInfo(
    lutAddresses.map((address) => new PublicKey(address))
  );

  const addressLookupTableAccounts = lutAccountsRaw
    .map((accountInfo, index) => {
      const addressLookupTableAddress = lutAddresses[index];

      if (!accountInfo || !addressLookupTableAddress) {
        return null;
      }

      return new AddressLookupTableAccount({
        key: new PublicKey(addressLookupTableAddress),
        state: AddressLookupTableAccount.deserialize(accountInfo.data),
      });
    })
    .filter((account) => account !== null)
    .concat(project0JupiterLut ? [project0JupiterLut] : []);

  const instruction = deserializeJupiterInstruction(swapInstructionResponse.swapInstruction);
  const setupInstructions = swapInstructionResponse.setupInstructions.map(
    deserializeJupiterInstruction
  );

  return {
    swapInstructions: [instruction],
    setupInstructions,
    addressLookupTableAddresses: addressLookupTableAccounts,
    quoteResponse: mapJupiterQuoteToSwapQuoteResult(swapQuote),
  };
};
