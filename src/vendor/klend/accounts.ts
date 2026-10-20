import type { ReadonlyUint8Array } from "@solana/kit";

import { decodeAccountData } from "../account-data";

import type { KaminoFarmState, KaminoObligation, KaminoReserve } from "./types";

import { FARM_STATE_DISCRIMINATOR, getFarmStateDecoder } from "~/generated/kfarms";
import {
  getObligationDecoder,
  getReserveDecoder,
  OBLIGATION_DISCRIMINATOR,
  RESERVE_DISCRIMINATOR,
} from "~/generated/klend";

export { FARMS_PROGRAM_ADDRESS } from "~/generated/kfarms";
export { KAMINO_LENDING_PROGRAM_ADDRESS } from "~/generated/klend";

/**
 * Decodes a Kamino `Reserve` account.
 * @throws if the discriminator doesn't match
 */
export function decodeKlendReserve(data: ReadonlyUint8Array): KaminoReserve {
  return decodeAccountData(data, RESERVE_DISCRIMINATOR, getReserveDecoder(), "Kamino Reserve");
}

/**
 * Decodes a Kamino `Obligation` account.
 * @throws if the discriminator doesn't match
 */
export function decodeKlendObligation(data: ReadonlyUint8Array): KaminoObligation {
  return decodeAccountData(
    data,
    OBLIGATION_DISCRIMINATOR,
    getObligationDecoder(),
    "Kamino Obligation"
  );
}

/**
 * Decodes a Kamino farms `FarmState` account.
 * @throws if the discriminator doesn't match
 */
export function decodeKaminoFarmState(data: ReadonlyUint8Array): KaminoFarmState {
  return decodeAccountData(
    data,
    FARM_STATE_DISCRIMINATOR,
    getFarmStateDecoder(),
    "Kamino FarmState"
  );
}
