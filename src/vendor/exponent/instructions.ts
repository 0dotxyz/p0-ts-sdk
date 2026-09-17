import {
  getProgramDerivedAddress,
  type AccountMeta,
  type Address,
  type Instruction,
} from "@solana/kit";

import {
  EXPONENT_CLMM_PROGRAM_ADDRESS,
  getTradePtInstruction,
  type TradePtInput,
} from "~/generated/exponent-clmm";
import {
  EXPONENT_CORE_PROGRAM_ADDRESS,
  getMergeInstruction,
  type MergeInput,
} from "~/generated/exponent-core";

// The IDLs predate Anchor's event-CPI annotations, so `event_authority` / `program` aren't derived
// by the generated builders.
async function eventAuthority(programAddress: Address): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress,
    seeds: ["__event_authority"],
  });
  return address;
}

/**
 * Redeems `amount` PT (native units, post-maturity, 1:1) into SY at `syDst` on the Exponent core
 * program. The transaction must carry the vault's address lookup table.
 * @param remainingAccounts - SY-program CPI accounts (`get_sy_state` ++ `withdraw_sy`).
 */
export async function makeExponentMergeIx(
  input: Omit<MergeInput, "eventAuthority" | "program">,
  remainingAccounts: AccountMeta[]
): Promise<Instruction> {
  const ix = getMergeInstruction({
    ...input,
    eventAuthority: await eventAuthority(EXPONENT_CORE_PROGRAM_ADDRESS),
    program: EXPONENT_CORE_PROGRAM_ADDRESS,
  });
  return { ...ix, accounts: [...ix.accounts, ...remainingAccounts] };
}

/**
 * Swaps on an Exponent CLMM (`MarketThree`) PT/SY pool. For a buy: `amountIn` SY (native),
 * `swapDirection` `SyToPt`, `amountOutConstraint` the minimum PT out. The transaction must carry the
 * market's address lookup table.
 * @param remainingAccounts - Deduplicated SY-program CPI accounts (`get_sy_state` ++
 * `get_position_state` ++ `deposit_sy` ++ `withdraw_sy`).
 */
export async function makeExponentClmmTradePtIx(
  input: Omit<TradePtInput, "eventAuthority" | "program">,
  remainingAccounts: AccountMeta[]
): Promise<Instruction> {
  const ix = getTradePtInstruction({
    ...input,
    eventAuthority: await eventAuthority(EXPONENT_CLMM_PROGRAM_ADDRESS),
    program: EXPONENT_CLMM_PROGRAM_ADDRESS,
  });
  return { ...ix, accounts: [...ix.accounts, ...remainingAccounts] };
}
