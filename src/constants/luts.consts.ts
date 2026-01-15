import { PublicKey } from "@solana/web3.js";

export const ADDRESS_LOOKUP_TABLE_FOR_GROUP: { [key: string]: PublicKey[] } = {
  "4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8": [
    new PublicKey("BrWF8J3CEuHaXsWk3kqGZ6VHvRp4SJuG9AzvB6ei2kbV"),
    new PublicKey("8GLUprtyzv6HGrgox7F43EQM5GqE2uKrAHLs69r8DgRj"),
    new PublicKey("Eg4WY6fmrbhDGfdgSrrTUe6peoUeVhkdXAWT6uvcGKjs"),
  ], // Main pool
  FCPfpHA69EbS8f9KKSreTRkXbzFpunsKuYf5qNmnJjpo: [
    new PublicKey("HxPy7b58KLKSU7w4LUW9xwYQ1NPyRNQkYYk2f7SmYAip"),
  ], // staging
};

export const ADDRESS_LOOKUP_TABLE_FOR_SWAP = new PublicKey(
  "5X5gDr8Bp9BpizTeZ3VJhxMw4z3q2rwoexJvwttmATs5"
);

export const JUP_SWAP_LUT_PROGRAM_AUTHORITY_INDEX = 5;
