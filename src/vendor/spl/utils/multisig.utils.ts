import { struct, u8 } from "@solana/buffer-layout";
import { bool, publicKey } from "@solana/buffer-layout-utils";

import { Multisig } from "../types";

/** Multisig as stored by the program */
export type RawMultisig = Omit<Multisig, "address">;

/** Buffer layout for de/serializing a multisig */
export const MultisigLayout = struct<RawMultisig>([
  u8("m"),
  u8("n"),
  bool("isInitialized"),
  publicKey("signer1"),
  publicKey("signer2"),
  publicKey("signer3"),
  publicKey("signer4"),
  publicKey("signer5"),
  publicKey("signer6"),
  publicKey("signer7"),
  publicKey("signer8"),
  publicKey("signer9"),
  publicKey("signer10"),
  publicKey("signer11"),
]);

/** Byte length of a multisig */
export const MULTISIG_SIZE = MultisigLayout.span;
