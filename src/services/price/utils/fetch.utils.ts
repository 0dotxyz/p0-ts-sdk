import { PublicKey } from "@solana/web3.js";

import { BankRaw } from "~/services/bank";

/**
 * ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
 * ┃                                   ⚠️  DEPRECATED  ⚠️                                   ┃
 * ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
 * ┃                                                                                ┃
 * ┃  🚫 THIS FILE IS DEPRECATED AND SHOULD NOT BE IMPORTED OR USED ANYWHERE! 🚫   ┃
 * ┃                                                                                ┃
 * ┃  This utility file contains deprecated oracle fetching logic that should       ┃
 * ┃  no longer be used. Please use the new oracle implementation instead.         ┃
 * ┃                                                                                ┃
 * ┃  ❌ DO NOT:                                                                    ┃
 * ┃     - Import functions from this file                                         ┃
 * ┃     - Use any of the exported utilities                                       ┃
 * ┃     - Reference this file in new code                                         ┃
 * ┃                                                                                ┃
 * ┃  ✅ INSTEAD:                                                                   ┃
 * ┃     - Use the updated oracle service implementations                          ┃
 * ┃     - Refer to the new API documentation                                      ┃
 * ┃                                                                                ┃
 * ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
 */

/**
 * =============================================================================
 * PYTH ORACLE UTILS
 * =============================================================================
 *
 * Utility functions for fetching Pyth oracle data
 */

/**
 * Converts vote account coefficients to bank address coefficients
 */
const convertVoteAccCoeffsToBankCoeffs = (
  pythStakedCollateralBanks: { address: PublicKey; data: BankRaw }[],
  bankMetadataMap: { [address: string]: any },
  voteAccCoeffs: Record<string, number>
): Record<string, number> => {
  const priceCoeffByBank: Record<string, number> = {};

  pythStakedCollateralBanks.forEach((bank) => {
    const voteAccount = bankMetadataMap[bank.address.toBase58()]?.validatorVoteAccount;
    if (voteAccount && voteAccCoeffs[voteAccount] !== undefined) {
      priceCoeffByBank[bank.address.toBase58()] = voteAccCoeffs[voteAccount];
    }
  });

  return priceCoeffByBank;
};
