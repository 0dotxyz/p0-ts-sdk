import { PublicKey } from "@solana/web3.js";

/**
 * General LUT set per group: covers all banks except native-stake/isolated/reduce-only.
 * Used for any transaction that touches a non-(STAKED|SOL) bank.
 */
export const ADDRESS_LOOKUP_TABLE_FOR_GROUP: { [key: string]: PublicKey[] } = {
  "4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8": [
    new PublicKey("8dk6oxKXC4iMLMa8Q4AVtPJPkEfitZuHSB4JqUsLLV2R"),
    new PublicKey("43xneYSZYLFkaksMcfBMJANibRiKsWgxkPbsrmcYjqF6"),
    new PublicKey("67cS6yqmAy5D1QRJwAXcFv9GLvrMbe88GFGDJcntkL7C"),
  ], // Main pool — general group
  FCPfpHA69EbS8f9KKSreTRkXbzFpunsKuYf5qNmnJjpo: [
    new PublicKey("9p1CwvXMYNEY9CqSwuWySVXsG37NGb36nua94ea5KsiQ"),
  ], // staging
  Diu1q9gniR1qR4Daaej3rcHd6949HMmxLGsnQ94Z3rLz: [
    new PublicKey("5ggm1hB8yPF5dKWJ3W7n1txztDrU4zf2RQk3TLrFvvRn"),
  ], // staging
};

/**
 * Native-stake LUT set per group: native-stake banks + the canonical wSOL bank.
 * Used for transactions that only touch STAKED/SOL banks (native-stake accounts can
 * only supply native-stake positions and borrow SOL). Groups without an entry fall
 * back to the general set.
 */
export const ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE: {
  [key: string]: PublicKey[];
} = {
  "4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8": [
    new PublicKey("FhVyrX2gfHmxKHq8wWWBJB3ZvHZcAQ6UAcjWxUyfyXuE"),
    new PublicKey("GYEJ3BcgwHfNSL2BAuDcth3KKKt9eiK14EHwLCjU9Eoo"),
  ], // Main pool — native-stake group
};

export const ADDRESS_LOOKUP_TABLE_FOR_SWAP = new PublicKey(
  "5X5gDr8Bp9BpizTeZ3VJhxMw4z3q2rwoexJvwttmATs5"
);

export const JUP_SWAP_LUT_PROGRAM_AUTHORITY_INDEX = 5;
