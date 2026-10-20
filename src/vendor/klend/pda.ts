import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";

import { FARMS_PROGRAM_ADDRESS } from "~/generated/kfarms";
import { KAMINO_LENDING_PROGRAM_ADDRESS } from "~/generated/klend";

const DEFAULT_ADDRESS = "11111111111111111111111111111111" as Address;

/** Kamino lending market authority PDA. */
export function deriveLendingMarketAuthority(
  lendingMarket: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: KAMINO_LENDING_PROGRAM_ADDRESS,
    seeds: ["lma", getAddressEncoder().encode(lendingMarket)],
  });
}

/** Reserve liquidity supply vault PDA. */
export function deriveReserveLiquiditySupply(
  lendingMarket: Address,
  reserveLiquidityMint: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: KAMINO_LENDING_PROGRAM_ADDRESS,
    seeds: [
      "reserve_liq_supply",
      getAddressEncoder().encode(lendingMarket),
      getAddressEncoder().encode(reserveLiquidityMint),
    ],
  });
}

/** Reserve fee receiver PDA. */
export function deriveFeeReceiver(
  lendingMarket: Address,
  reserveLiquidityMint: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: KAMINO_LENDING_PROGRAM_ADDRESS,
    seeds: [
      "fee_receiver",
      getAddressEncoder().encode(lendingMarket),
      getAddressEncoder().encode(reserveLiquidityMint),
    ],
  });
}

/** Reserve collateral (cToken) mint PDA. */
export function deriveReserveCollateralMint(
  lendingMarket: Address,
  reserveLiquidityMint: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: KAMINO_LENDING_PROGRAM_ADDRESS,
    seeds: [
      "reserve_coll_mint",
      getAddressEncoder().encode(lendingMarket),
      getAddressEncoder().encode(reserveLiquidityMint),
    ],
  });
}

/** Reserve collateral (cToken) supply vault PDA. */
export function deriveReserveCollateralSupply(
  lendingMarket: Address,
  reserveLiquidityMint: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: KAMINO_LENDING_PROGRAM_ADDRESS,
    seeds: [
      "reserve_coll_supply",
      getAddressEncoder().encode(lendingMarket),
      getAddressEncoder().encode(reserveLiquidityMint),
    ],
  });
}

/**
 * Obligation PDA. Bank obligations use `tag` and `id` 0 with default seed accounts.
 */
export function deriveObligation({
  owner,
  lendingMarket,
  tag = 0,
  id = 0,
  seed1 = DEFAULT_ADDRESS,
  seed2 = DEFAULT_ADDRESS,
}: {
  owner: Address;
  lendingMarket: Address;
  tag?: number;
  id?: number;
  seed1?: Address;
  seed2?: Address;
}): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: KAMINO_LENDING_PROGRAM_ADDRESS,
    seeds: [
      new Uint8Array([tag]),
      new Uint8Array([id]),
      getAddressEncoder().encode(owner),
      getAddressEncoder().encode(lendingMarket),
      getAddressEncoder().encode(seed1),
      getAddressEncoder().encode(seed2),
    ],
  });
}

/**
 * Farms program user state PDA for `obligation` in `farmState`: the obligation's rewards
 * position, unrelated to marginfi users.
 */
export function deriveUserState(
  farmState: Address,
  obligation: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: FARMS_PROGRAM_ADDRESS,
    seeds: ["user", getAddressEncoder().encode(farmState), getAddressEncoder().encode(obligation)],
  });
}
