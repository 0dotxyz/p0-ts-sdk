import { blockhash, getAddressDecoder, type Address } from "@solana/kit";

const addressDecoder = getAddressDecoder();

let addressCount = 0;

// A different address on every call, and the same sequence on every run
export function addr(): Address {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, ++addressCount);
  return addressDecoder.decode(bytes);
}

// The address of 32 `fill` bytes, for an address a test refers to more than once
export const key = (fill: number): Address => addressDecoder.decode(new Uint8Array(32).fill(fill));

export const LATEST_BLOCKHASH = {
  blockhash: blockhash("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"),
  lastValidBlockHeight: 1n,
};
