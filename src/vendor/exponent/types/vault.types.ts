import { BigNumber } from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

/** The subset of Exponent's `Vault` account that `merge` / the roll needs. */
export interface ExponentVault {
  /** Vault signer authority (`merge.authority`, via `has_one = authority`). */
  authority: PublicKey;
  syProgram: PublicKey;
  mintSy: PublicKey;
  mintYt: PublicKey;
  mintPt: PublicKey;
  escrowSy: PublicKey;
  yieldPosition: PublicKey;
  addressLookupTable: PublicKey;
  /** Final (maturity) SY exchange rate, already scaled by 1e12 → BigNumber. */
  finalSyExchangeRate: BigNumber;
  /** Raw status byte. */
  status: number;
}
