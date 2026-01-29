import {
  createJupiterApiClient,
  QuoteGetRequest,
  Instruction as JupiterInstruction,
  QuoteResponse,
  ConfigurationParameters,
  SwapApi,
  Configuration,
} from "@jup-ag/api";
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

import { ADDRESS_LOOKUP_TABLE_FOR_SWAP, JUP_SWAP_LUT_PROGRAM_AUTHORITY_INDEX } from "~/constants";

const REFERRAL_PROGRAM_ID = new PublicKey("REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3");
const REFERRAL_ACCOUNT_PUBKEY = new PublicKey("Mm7HcujSK2JzPW4eX7g4oqTXbWYDuFxapNMHXe8yp1B");

const getFeeAccount = (mint: PublicKey) => {
  const referralProgramPubkey = REFERRAL_PROGRAM_ID;
  const referralAccountPubkey = REFERRAL_ACCOUNT_PUBKEY;

  const [feeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("referral_ata"), referralAccountPubkey.toBuffer(), mint.toBuffer()],
    referralProgramPubkey
  );
  return feeAccount.toBase58();
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

type GetJupiterSwapIxsForFlashloanParams = {
  quoteParams: QuoteGetRequest;
  authority: PublicKey;
  connection: Connection;
  destinationTokenAccount: PublicKey;
  configParams?: ConfigurationParameters;
};

export const getJupiterSwapIxsForFlashloan = async ({
  quoteParams,
  authority,
  connection,
  destinationTokenAccount,
  configParams,
}: GetJupiterSwapIxsForFlashloanParams): Promise<
  {
    swapInstruction: TransactionInstruction;
    addressLookupTableAddresses: AddressLookupTableAccount[];
    quoteResponse: QuoteResponse;
    setupInstructions: TransactionInstruction[];
  }[]
> => {
  // Create SwapApi directly to respect custom basePath
  // createJupiterApiClient ignores basePath and hardcodes it to jup.ag URLs
  const jupiterApiClient = configParams?.basePath
    ? new SwapApi(new Configuration(configParams))
    : createJupiterApiClient(configParams);

  const feeMint =
    quoteParams.swapMode === "ExactIn" ? quoteParams.outputMint : quoteParams.inputMint;
  const feeAccount = getFeeAccount(new PublicKey(feeMint));
  const hasFeeAccount = !!(await connection.getAccountInfo(new PublicKey(feeAccount)));
  const project0JupiterLut = (await connection.getAddressLookupTable(ADDRESS_LOOKUP_TABLE_FOR_SWAP))
    ?.value;

  let finalQuoteParams: QuoteGetRequest = quoteParams;
  // Ideally we shouldn't be checking this, slows the entire flow down by a rpc call
  if (!hasFeeAccount) {
    // TODO: setup logging if a fee account has not been created
    console.warn("Warning: feeAccountInfo is undefined");
    // removes platformFeeBps from quoteParams to avoid errors
    finalQuoteParams = {
      ...quoteParams,
      platformFeeBps: undefined,
    };
  }

  // fetch quotes for maxAccounts 40 and 30
  const maxAccountsArr = [40, 30];
  const swapQuotes = await Promise.all(
    maxAccountsArr.map((maxAccounts) => {
      return jupiterApiClient.quoteGet({
        ...finalQuoteParams,
        maxAccounts,
      });
    })
  );

  const swapInstructionResponses = await Promise.all(
    swapQuotes.map((quote) =>
      jupiterApiClient.swapInstructionsPost({
        swapRequest: {
          quoteResponse: quote,
          userPublicKey: authority.toBase58(),
          feeAccount: hasFeeAccount ? feeAccount : undefined,
          wrapAndUnwrapSol: false,
          destinationTokenAccount: destinationTokenAccount.toBase58(),
        },
      })
    )
  );

  const lutAddresses = swapInstructionResponses.map(
    (swapInstructionResponse) => swapInstructionResponse.addressLookupTableAddresses
  );

  const lutAccountsRaw = await connection.getMultipleAccountsInfo(
    lutAddresses.flat().map((address) => new PublicKey(address))
  );

  let currentIndex = 0;
  const jupiterSwapIxs: {
    swapInstruction: TransactionInstruction;
    setupInstructions: TransactionInstruction[];
    addressLookupTableAddresses: AddressLookupTableAccount[];
    quoteResponse: QuoteResponse;
  }[] = [];

  for (let i = 0; i < swapInstructionResponses.length; i++) {
    const response = swapInstructionResponses[i];
    const quote = swapQuotes[i];
    const isLast = i === swapInstructionResponses.length - 1;

    if (!response || !quote) continue;

    const address = response.addressLookupTableAddresses;
    const addressesLength = address.length;
    const addressesStartIndex = currentIndex;
    const addressesEndIndex = addressesStartIndex + addressesLength;
    currentIndex = addressesEndIndex;

    const lutAccounts = lutAccountsRaw.slice(addressesStartIndex, addressesEndIndex);

    const addressLookupTableAccounts = lutAccounts
      .map((accountInfo, index) => {
        const addressLookupTableAddress = address[index];

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

    const instruction = deserializeJupiterInstruction(response.swapInstruction);
    const setupInstructions = response.setupInstructions.map(deserializeJupiterInstruction);

    jupiterSwapIxs.push({
      swapInstruction: instruction,
      setupInstructions,
      addressLookupTableAddresses: addressLookupTableAccounts,
      quoteResponse: quote,
    });
  }

  return jupiterSwapIxs;
};
