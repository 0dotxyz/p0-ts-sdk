import type { ReadonlyUint8Array } from "@solana/kit";

import { decodeAccountData } from "../account-data";

import { FARM_STATE_DISCRIMINATOR, getFarmStateDecoder, type FarmState } from "~/generated/kfarms";
import {
  getObligationDecoder,
  getReserveDecoder,
  OBLIGATION_DISCRIMINATOR,
  RESERVE_DISCRIMINATOR,
  type Obligation,
  type Reserve,
} from "~/generated/klend";

export { FARMS_PROGRAM_ADDRESS } from "~/generated/kfarms";
export { KAMINO_LENDING_PROGRAM_ADDRESS } from "~/generated/klend";

/**
 * Decodes a Kamino `Reserve` account; the result satisfies `KaminoReserve`.
 * @throws if the discriminator doesn't match
 */
export function decodeKlendReserve(data: ReadonlyUint8Array): Reserve {
  return decodeAccountData(data, RESERVE_DISCRIMINATOR, getReserveDecoder(), "Kamino Reserve");
}

/**
 * Decodes a Kamino `Obligation` account; the result satisfies `KaminoObligation`.
 * @throws if the discriminator doesn't match
 */
export function decodeKlendObligation(data: ReadonlyUint8Array): Obligation {
  return decodeAccountData(
    data,
    OBLIGATION_DISCRIMINATOR,
    getObligationDecoder(),
    "Kamino Obligation"
  );
}

/**
 * Decodes a Kamino farms `FarmState` account; the result satisfies `KaminoFarmState`.
 * @throws if the discriminator doesn't match
 */
export function decodeKaminoFarmState(data: ReadonlyUint8Array): FarmState {
  return decodeAccountData(
    data,
    FARM_STATE_DISCRIMINATOR,
    getFarmStateDecoder(),
    "Kamino FarmState"
  );
}
