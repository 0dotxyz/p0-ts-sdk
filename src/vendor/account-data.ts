import { containsBytes, type Decoder, type ReadonlyUint8Array } from "@solana/kit";

// Generated decoders don't check the discriminator; wrappers use this so a wrong account fails loudly.
export function decodeAccountData<T>(
  data: ReadonlyUint8Array,
  discriminator: ReadonlyUint8Array,
  decoder: Decoder<T>,
  accountName: string
): T {
  if (!containsBytes(data, discriminator, 0)) {
    throw new Error(`Invalid ${accountName} account discriminator`);
  }
  return decoder.decode(data);
}
