import { address, type ReadonlyUint8Array } from "@solana/kit";
import BigNumber from "bignumber.js";

export const MARINADE_PROGRAM_ADDRESS = address("MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD");

/** sha256("account:State")[..8] */
export const MARINADE_STATE_DISCRIMINATOR = new Uint8Array([216, 146, 107, 94, 104, 75, 182, 177]);

// Absolute byte offsets in Marinade's State account, including the 8-byte Anchor discriminator.
// These are the fields used by Marinade's `total_virtual_staked_lamports` calculation and by the
// marginfi program's canonical mSOL/SOL multiplier.
const DELAYED_UNSTAKE_COOLING_DOWN_OFFSET = 226;
const TOTAL_ACTIVE_BALANCE_OFFSET = 376;
const AVAILABLE_RESERVE_BALANCE_OFFSET = 496;
const MSOL_SUPPLY_OFFSET = 504;
const CIRCULATING_TICKET_BALANCE_OFFSET = 528;
const EMERGENCY_COOLING_DOWN_OFFSET = 568;
export const MARINADE_STATE_MIN_SIZE = EMERGENCY_COOLING_DOWN_OFFSET + 8;
const U64_MAX = (1n << 64n) - 1n;

// Same sanity ceiling as the program's MAX_LST_SOL_RATE
const MAX_MSOL_SOL_RATE = 3;

export interface MarinadeState {
  /** mSOL/SOL exchange rate */
  msolPrice: BigNumber;
}

/**
 * Decodes the mSOL/SOL rate from a Marinade `State` account.
 * @throws if the account is undersized, has a wrong discriminator, has no mSOL supply, or yields a
 * rate outside (0, 3)
 */
export function decodeMarinadeState(data: ReadonlyUint8Array): MarinadeState {
  if (data.length < MARINADE_STATE_MIN_SIZE) {
    throw new Error(`Invalid Marinade State account size: ${data.length}`);
  }
  if (MARINADE_STATE_DISCRIMINATOR.some((byte, i) => data[i] !== byte)) {
    throw new Error("Invalid Marinade State discriminator");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u64 = (offset: number) => view.getBigUint64(offset, true);

  const msolSupply = u64(MSOL_SUPPLY_OFFSET);
  if (msolSupply === 0n) {
    throw new Error("Marinade State has zero mSOL supply");
  }

  const underControl =
    u64(TOTAL_ACTIVE_BALANCE_OFFSET) +
    u64(DELAYED_UNSTAKE_COOLING_DOWN_OFFSET) +
    u64(EMERGENCY_COOLING_DOWN_OFFSET) +
    u64(AVAILABLE_RESERVE_BALANCE_OFFSET);
  if (underControl > U64_MAX) {
    throw new Error("Marinade virtual staked balance overflow");
  }

  // Marinade uses saturating subtraction for outstanding delayed-unstake tickets.
  const circulatingTicketBalance = u64(CIRCULATING_TICKET_BALANCE_OFFSET);
  const totalVirtualStakedLamports =
    underControl > circulatingTicketBalance ? underControl - circulatingTicketBalance : 0n;
  const msolPrice = new BigNumber(totalVirtualStakedLamports.toString()).div(msolSupply.toString());

  if (!msolPrice.gt(0) || msolPrice.gte(MAX_MSOL_SOL_RATE)) {
    throw new Error(`Marinade mSOL/SOL rate out of bounds: ${msolPrice.toString()}`);
  }

  return { msolPrice };
}
