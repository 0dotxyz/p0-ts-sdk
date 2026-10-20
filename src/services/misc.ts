/**
 * Temporary Module for Functions Pending Refactoring
 *
 * This file serves as a temporary staging area for utility functions that need proper
 * categorization and relocation to their appropriate service modules. All functions
 * placed here should include:
 *
 * IMPORTANT: Do not add new features to functions in this file. Instead, refactor
 * them to their proper location first, then implement new functionality.
 */

import type { Address, GetMultipleAccountsApi, Rpc } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { TOKEN_2022_PROGRAM_ID } from "~/constants";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/utils";

export async function fetchProgramForMints(
  rpc: Rpc<GetMultipleAccountsApi>,
  mintAddresses: Address[]
) {
  const mintData: {
    mint: Address;
    program: Address;
  }[] = [];

  const accounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(rpc, mintAddresses);
  for (const account of accounts) {
    if (
      account &&
      (account.programAddress === TOKEN_PROGRAM_ADDRESS ||
        account.programAddress === TOKEN_2022_PROGRAM_ID)
    ) {
      mintData.push({ mint: account.address, program: account.programAddress });
    }
  }

  return mintData;
}
