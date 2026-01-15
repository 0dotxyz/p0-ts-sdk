import { PublicKey } from "@solana/web3.js";

/** Information about a multisig */
export interface Multisig {
  /** Address of the multisig */
  address: PublicKey;
  /** Number of signers required */
  m: number;
  /** Number of possible signers, corresponds to the number of `signers` that are valid */
  n: number;
  /** Is this mint initialized */
  isInitialized: boolean;
  /** Full set of signers, of which `n` are valid */
  signer1: PublicKey;
  signer2: PublicKey;
  signer3: PublicKey;
  signer4: PublicKey;
  signer5: PublicKey;
  signer6: PublicKey;
  signer7: PublicKey;
  signer8: PublicKey;
  signer9: PublicKey;
  signer10: PublicKey;
  signer11: PublicKey;
}
