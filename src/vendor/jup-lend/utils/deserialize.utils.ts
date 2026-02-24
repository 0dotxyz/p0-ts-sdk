import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import {
  JupLendingState,
  JupLendingStateRaw,
  JupLendingStateJSON,
  JupLendingRewardsRateModel,
  JupLendingRewardsRateModelRaw,
  JupLendingRewardsRateModelJSON,
  JupTokenReserve,
  JupTokenReserveRaw,
  JupTokenReserveJSON,
  JupRateModel,
  JupRateModelRaw,
  JupRateModelJSON,
} from "../types";
import { JUP_LEND_IDL } from "../idl";

const JUP_LEND_ACCOUNTS_CODER = new BorshAccountsCoder(JUP_LEND_IDL);

const lendingDiscriminator = Buffer.from([135, 199, 82, 16, 249, 131, 182, 241]);
const lendingRewardsRateModelDiscriminator = Buffer.from([166, 72, 71, 131, 172, 74, 166, 181]);
const rateModelDiscriminator = Buffer.from([94, 3, 203, 219, 107, 137, 4, 162]);

// ============================================================================
// BUFFER → RAW DECODERS
// ============================================================================

export function decodeJupLendingStateData(data: Buffer, pubkey: PublicKey): JupLendingStateRaw {
  if (!data.slice(0, 8).equals(lendingDiscriminator)) {
    throw new Error("invalid Lending account discriminator");
  }

  const decoded = JUP_LEND_ACCOUNTS_CODER.decode("Lending", data) as any;

  return {
    pubkey,
    mint: decoded.mint,
    fTokenMint: decoded.f_token_mint ?? decoded.fTokenMint,
    lendingId: decoded.lending_id ?? decoded.lendingId,
    decimals: decoded.decimals,
    rewardsRateModel: decoded.rewards_rate_model ?? decoded.rewardsRateModel,
    liquidityExchangePrice: decoded.liquidity_exchange_price ?? decoded.liquidityExchangePrice,
    tokenExchangePrice: decoded.token_exchange_price ?? decoded.tokenExchangePrice,
    lastUpdateTimestamp: decoded.last_update_timestamp ?? decoded.lastUpdateTimestamp,
    tokenReservesLiquidity: decoded.token_reserves_liquidity ?? decoded.tokenReservesLiquidity,
    supplyPositionOnLiquidity:
      decoded.supply_position_on_liquidity ?? decoded.supplyPositionOnLiquidity,
    bump: decoded.bump,
  };
}

export function decodeJupLendingRewardsRateModelData(
  data: Buffer,
  pubkey: PublicKey
): JupLendingRewardsRateModelRaw {
  if (!data.slice(0, 8).equals(lendingRewardsRateModelDiscriminator)) {
    throw new Error("invalid LendingRewardsRateModel account discriminator");
  }

  const decoded = JUP_LEND_ACCOUNTS_CODER.decode("LendingRewardsRateModel", data) as any;

  return {
    pubkey,
    mint: decoded.mint,
    startTvl: decoded.start_tvl ?? decoded.startTvl,
    duration: decoded.duration,
    startTime: decoded.start_time ?? decoded.startTime,
    yearlyReward: decoded.yearly_reward ?? decoded.yearlyReward,
    nextDuration: decoded.next_duration ?? decoded.nextDuration,
    nextRewardAmount: decoded.next_reward_amount ?? decoded.nextRewardAmount,
    bump: decoded.bump,
  };
}

/**
 * Decode a TokenReserve account from raw buffer data.
 * TokenReserve uses bytemuck (packed C repr) — manual fixed-offset reads.
 * Layout (after 8-byte discriminator):
 *   mint[32] vault[32] borrow_rate[2] fee_on_interest[2] last_utilization[2]
 *   last_update_timestamp[8] supply_exchange_price[8] borrow_exchange_price[8]
 *   max_utilization[2] total_supply_with_interest[8] total_supply_interest_free[8]
 *   total_borrow_with_interest[8] total_borrow_interest_free[8] total_claim_amount[8]
 *   interacting_protocol[32] interacting_timestamp[8] interacting_balance[8]
 */
export function decodeJupTokenReserveData(data: Buffer, pubkey: PublicKey): JupTokenReserveRaw {
  let offset = 8; // skip 8-byte discriminator

  const mint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  const vault = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  const borrowRate = data.readUInt16LE(offset);
  offset += 2;
  const feeOnInterest = data.readUInt16LE(offset);
  offset += 2;
  const lastUtilization = data.readUInt16LE(offset);
  offset += 2;
  const lastUpdateTimestamp = new BN(data.slice(offset, offset + 8), "le");
  offset += 8;
  const supplyExchangePrice = new BN(data.slice(offset, offset + 8), "le");
  offset += 8;
  const borrowExchangePrice = new BN(data.slice(offset, offset + 8), "le");
  offset += 8;
  const maxUtilization = data.readUInt16LE(offset);
  offset += 2;
  const totalSupplyWithInterest = new BN(data.slice(offset, offset + 8), "le");
  offset += 8;
  const totalSupplyInterestFree = new BN(data.slice(offset, offset + 8), "le");
  offset += 8;
  const totalBorrowWithInterest = new BN(data.slice(offset, offset + 8), "le");
  offset += 8;
  const totalBorrowInterestFree = new BN(data.slice(offset, offset + 8), "le");
  offset += 8;
  const totalClaimAmount = new BN(data.slice(offset, offset + 8), "le");
  offset += 8;
  const interactingProtocol = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  const interactingTimestamp = new BN(data.slice(offset, offset + 8), "le");
  offset += 8;
  const interactingBalance = new BN(data.slice(offset, offset + 8), "le");

  return {
    pubkey,
    mint,
    vault,
    borrowRate,
    feeOnInterest,
    lastUtilization,
    lastUpdateTimestamp,
    supplyExchangePrice,
    borrowExchangePrice,
    maxUtilization,
    totalSupplyWithInterest,
    totalSupplyInterestFree,
    totalBorrowWithInterest,
    totalBorrowInterestFree,
    totalClaimAmount,
    interactingProtocol,
    interactingTimestamp,
    interactingBalance,
  };
}

/**
 * Decode a RateModel account from raw buffer data.
 * RateModel uses bytemuck (packed C repr) — manual fixed-offset reads.
 * Layout (after 8-byte discriminator):
 *   mint[32] version[1] rate_at_zero[2] kink1_utilization[2]
 *   rate_at_kink1[2] rate_at_max[2] kink2_utilization[2] rate_at_kink2[2]
 */
export function decodeJupRateModelData(data: Buffer, pubkey: PublicKey): JupRateModelRaw {
  if (!data.slice(0, 8).equals(rateModelDiscriminator)) {
    throw new Error("invalid RateModel account discriminator");
  }

  let offset = 8; // skip 8-byte discriminator

  const mint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  const version = data.readUInt8(offset);
  offset += 1;
  const rateAtZero = data.readUInt16LE(offset);
  offset += 2;
  const kink1Utilization = data.readUInt16LE(offset);
  offset += 2;
  const rateAtKink1 = data.readUInt16LE(offset);
  offset += 2;
  const rateAtMax = data.readUInt16LE(offset);
  offset += 2;
  const kink2Utilization = data.readUInt16LE(offset);
  offset += 2;
  const rateAtKink2 = data.readUInt16LE(offset);

  return {
    pubkey,
    mint,
    version,
    rateAtZero,
    kink1Utilization,
    rateAtKink1,
    rateAtMax,
    kink2Utilization,
    rateAtKink2,
  };
}

// ============================================================================
// DTO → RAW CONVERTERS
// ============================================================================

export function dtoToJupLendingStateRaw(dto: JupLendingStateJSON): JupLendingState {
  return {
    pubkey: new PublicKey(dto.pubkey),
    mint: new PublicKey(dto.mint),
    fTokenMint: new PublicKey(dto.fTokenMint),
    lendingId: dto.lendingId,
    decimals: dto.decimals,
    rewardsRateModel: new PublicKey(dto.rewardsRateModel),
    liquidityExchangePrice: new BN(dto.liquidityExchangePrice),
    tokenExchangePrice: new BN(dto.tokenExchangePrice),
    lastUpdateTimestamp: new BN(dto.lastUpdateTimestamp),
    tokenReservesLiquidity: new PublicKey(dto.tokenReservesLiquidity),
    supplyPositionOnLiquidity: new PublicKey(dto.supplyPositionOnLiquidity),
  };
}

export function dtoToJupTokenReserveRaw(dto: JupTokenReserveJSON): JupTokenReserve {
  return {
    pubkey: new PublicKey(dto.pubkey),
    mint: new PublicKey(dto.mint),
    vault: new PublicKey(dto.vault),
    borrowRate: dto.borrowRate,
    feeOnInterest: dto.feeOnInterest,
    lastUtilization: dto.lastUtilization,
    lastUpdateTimestamp: new BN(dto.lastUpdateTimestamp),
    supplyExchangePrice: new BN(dto.supplyExchangePrice),
    borrowExchangePrice: new BN(dto.borrowExchangePrice),
    maxUtilization: dto.maxUtilization,
    totalSupplyWithInterest: new BN(dto.totalSupplyWithInterest),
    totalSupplyInterestFree: new BN(dto.totalSupplyInterestFree),
    totalBorrowWithInterest: new BN(dto.totalBorrowWithInterest),
    totalBorrowInterestFree: new BN(dto.totalBorrowInterestFree),
    totalClaimAmount: new BN(dto.totalClaimAmount),
    interactingProtocol: new PublicKey(dto.interactingProtocol),
    interactingTimestamp: new BN(dto.interactingTimestamp),
    interactingBalance: new BN(dto.interactingBalance),
  };
}

export function dtoToJupLendingRewardsRateModelRaw(
  dto: JupLendingRewardsRateModelJSON
): JupLendingRewardsRateModel {
  return {
    pubkey: new PublicKey(dto.pubkey),
    mint: new PublicKey(dto.mint),
    startTvl: new BN(dto.startTvl),
    duration: new BN(dto.duration),
    startTime: new BN(dto.startTime),
    yearlyReward: new BN(dto.yearlyReward),
    nextDuration: new BN(dto.nextDuration),
    nextRewardAmount: new BN(dto.nextRewardAmount),
  };
}

export function dtoToJupRateModelRaw(dto: JupRateModelJSON): JupRateModel {
  return {
    pubkey: new PublicKey(dto.pubkey),
    mint: new PublicKey(dto.mint),
    version: dto.version,
    rateAtZero: dto.rateAtZero,
    kink1Utilization: dto.kink1Utilization,
    rateAtKink1: dto.rateAtKink1,
    rateAtMax: dto.rateAtMax,
    kink2Utilization: dto.kink2Utilization,
    rateAtKink2: dto.rateAtKink2,
  };
}
