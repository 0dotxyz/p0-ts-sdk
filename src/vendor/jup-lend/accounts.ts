import type { Address, ReadonlyUint8Array } from "@solana/kit";

import { decodeAccountData } from "../account-data";

import type { JupLendingState, JupTokenReserve } from "./types";

import {
  getLendingDecoder,
  getLendingRewardsRateModelDecoder,
  LENDING_DISCRIMINATOR,
  LENDING_REWARDS_RATE_MODEL_DISCRIMINATOR,
  type LendingRewardsRateModel,
} from "~/generated/jup-lend";
import {
  getRateModelDecoder,
  getTokenReserveDecoder,
  RATE_MODEL_DISCRIMINATOR,
  TOKEN_RESERVE_DISCRIMINATOR,
  type RateModel,
} from "~/generated/jup-lend-liquidity";

export { LENDING_PROGRAM_ADDRESS as JUP_LEND_PROGRAM_ADDRESS } from "~/generated/jup-lend";
export { LIQUIDITY_PROGRAM_ADDRESS as JUP_LIQUIDITY_PROGRAM_ADDRESS } from "~/generated/jup-lend-liquidity";

/**
 * Decodes a JupLend `Lending` account at `address`.
 * @throws if the discriminator doesn't match
 */
export function decodeJupLendingState(address: Address, data: ReadonlyUint8Array): JupLendingState {
  const lending = decodeAccountData(
    data,
    LENDING_DISCRIMINATOR,
    getLendingDecoder(),
    "JupLend Lending"
  );
  return {
    pubkey: address,
    mint: lending.mint,
    fTokenMint: lending.fTokenMint,
    lendingId: lending.lendingId,
    decimals: lending.decimals,
    rewardsRateModel: lending.rewardsRateModel,
    liquidityExchangePrice: lending.liquidityExchangePrice,
    tokenExchangePrice: lending.tokenExchangePrice,
    lastUpdateTimestamp: lending.lastUpdateTimestamp,
    tokenReservesLiquidity: lending.tokenReservesLiquidity,
    supplyPositionOnLiquidity: lending.supplyPositionOnLiquidity,
  };
}

/**
 * Decodes a JupLend liquidity-layer `TokenReserve` account at `address`.
 * @throws if the discriminator doesn't match
 */
export function decodeJupTokenReserve(address: Address, data: ReadonlyUint8Array): JupTokenReserve {
  const reserve = decodeAccountData(
    data,
    TOKEN_RESERVE_DISCRIMINATOR,
    getTokenReserveDecoder(),
    "JupLend TokenReserve"
  );
  return {
    pubkey: address,
    borrowRate: reserve.borrowRate,
    feeOnInterest: reserve.feeOnInterest,
    lastUtilization: reserve.lastUtilization,
    supplyExchangePrice: reserve.supplyExchangePrice,
    borrowExchangePrice: reserve.borrowExchangePrice,
    totalSupplyWithInterest: reserve.totalSupplyWithInterest,
    totalSupplyInterestFree: reserve.totalSupplyInterestFree,
    totalBorrowWithInterest: reserve.totalBorrowWithInterest,
    totalBorrowInterestFree: reserve.totalBorrowInterestFree,
  };
}

/**
 * Decodes a JupLend liquidity-layer `RateModel` account; the result satisfies `JupRateModel`.
 * @throws if the discriminator doesn't match
 */
export function decodeJupRateModel(data: ReadonlyUint8Array): RateModel {
  return decodeAccountData(
    data,
    RATE_MODEL_DISCRIMINATOR,
    getRateModelDecoder(),
    "JupLend RateModel"
  );
}

/**
 * Decodes a JupLend `LendingRewardsRateModel` account; the result satisfies
 * `JupLendingRewardsRateModel`.
 * @throws if the discriminator doesn't match
 */
export function decodeJupLendingRewardsRateModel(
  data: ReadonlyUint8Array
): LendingRewardsRateModel {
  return decodeAccountData(
    data,
    LENDING_REWARDS_RATE_MODEL_DISCRIMINATOR,
    getLendingRewardsRateModelDecoder(),
    "JupLend LendingRewardsRateModel"
  );
}
