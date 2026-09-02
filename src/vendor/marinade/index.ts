import BigNumber from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

export const MARINADE_PROGRAM_ID = new PublicKey("MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD");

// sha256("account:State")[..8]
export const MARINADE_STATE_DISCRIMINATOR = Buffer.from([216, 146, 107, 94, 104, 75, 182, 177]);

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

export function decodeMarinadeState(data: Buffer): MarinadeState {
  if (data.length < MARINADE_STATE_MIN_SIZE) {
    throw new Error(`Invalid Marinade State account size: ${data.length}`);
  }
  if (!data.subarray(0, 8).equals(MARINADE_STATE_DISCRIMINATOR)) {
    throw new Error("Invalid Marinade State discriminator");
  }

  const delayedUnstakeCoolingDown = data.readBigUInt64LE(DELAYED_UNSTAKE_COOLING_DOWN_OFFSET);
  const totalActiveBalance = data.readBigUInt64LE(TOTAL_ACTIVE_BALANCE_OFFSET);
  const availableReserveBalance = data.readBigUInt64LE(AVAILABLE_RESERVE_BALANCE_OFFSET);
  const msolSupply = data.readBigUInt64LE(MSOL_SUPPLY_OFFSET);
  const circulatingTicketBalance = data.readBigUInt64LE(CIRCULATING_TICKET_BALANCE_OFFSET);
  const emergencyCoolingDown = data.readBigUInt64LE(EMERGENCY_COOLING_DOWN_OFFSET);

  if (msolSupply === 0n) {
    throw new Error("Marinade State has zero mSOL supply");
  }

  const underControl =
    totalActiveBalance + delayedUnstakeCoolingDown + emergencyCoolingDown + availableReserveBalance;
  if (underControl > U64_MAX) {
    throw new Error("Marinade virtual staked balance overflow");
  }

  // Marinade uses saturating subtraction for outstanding delayed-unstake tickets.
  const totalVirtualStakedLamports =
    underControl > circulatingTicketBalance ? underControl - circulatingTicketBalance : 0n;
  const msolPrice = new BigNumber(totalVirtualStakedLamports.toString()).div(msolSupply.toString());

  if (!msolPrice.gt(0) || msolPrice.gte(MAX_MSOL_SOL_RATE)) {
    throw new Error(`Marinade mSOL/SOL rate out of bounds: ${msolPrice.toString()}`);
  }

  return { msolPrice };
}
