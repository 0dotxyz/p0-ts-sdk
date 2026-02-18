import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import {
  JupLendingStateRaw,
  JupLendingStateJSON,
  JupLendingAdminRaw,
  JupLendingAdminJSON,
  JupLendingRewardsRateModelRaw,
  JupLendingRewardsRateModelJSON,
} from "../types";
import { JUP_LEND_IDL } from "../idl";

const JUP_LEND_ACCOUNTS_CODER = new BorshAccountsCoder(JUP_LEND_IDL);

const lendingDiscriminator = Buffer.from([135, 199, 82, 16, 249, 131, 182, 241]);
const lendingAdminDiscriminator = Buffer.from([42, 8, 33, 220, 163, 40, 210, 5]);
const lendingRewardsRateModelDiscriminator = Buffer.from([166, 72, 71, 131, 172, 74, 166, 181]);

// ============================================================================
// BUFFER → RAW DECODERS
// ============================================================================

export function decodeJupLendingStateData(
  data: Buffer,
  pubkey: PublicKey
): JupLendingStateRaw {
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
    supplyPositionOnLiquidity: decoded.supply_position_on_liquidity ?? decoded.supplyPositionOnLiquidity,
    bump: decoded.bump,
  };
}

export function decodeJupLendingAdminData(
  data: Buffer,
  pubkey: PublicKey
): JupLendingAdminRaw {
  if (!data.slice(0, 8).equals(lendingAdminDiscriminator)) {
    throw new Error("invalid LendingAdmin account discriminator");
  }

  const decoded = JUP_LEND_ACCOUNTS_CODER.decode("LendingAdmin", data) as any;

  return {
    pubkey,
    authority: decoded.authority,
    liquidityProgram: decoded.liquidity_program ?? decoded.liquidityProgram,
    rebalancer: decoded.rebalancer,
    nextLendingId: decoded.next_lending_id ?? decoded.nextLendingId,
    auths: decoded.auths,
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

// ============================================================================
// DTO → RAW CONVERTERS
// ============================================================================

export function dtoToJupLendingStateRaw(
  dto: JupLendingStateJSON
): JupLendingStateRaw {
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
    bump: dto.bump,
  };
}

export function dtoToJupLendingAdminRaw(
  dto: JupLendingAdminJSON
): JupLendingAdminRaw {
  return {
    pubkey: new PublicKey(dto.pubkey),
    authority: new PublicKey(dto.authority),
    liquidityProgram: new PublicKey(dto.liquidityProgram),
    rebalancer: new PublicKey(dto.rebalancer),
    nextLendingId: dto.nextLendingId,
    auths: dto.auths.map((a) => new PublicKey(a)),
    bump: dto.bump,
  };
}

export function dtoToJupLendingRewardsRateModelRaw(
  dto: JupLendingRewardsRateModelJSON
): JupLendingRewardsRateModelRaw {
  return {
    pubkey: new PublicKey(dto.pubkey),
    mint: new PublicKey(dto.mint),
    startTvl: new BN(dto.startTvl),
    duration: new BN(dto.duration),
    startTime: new BN(dto.startTime),
    yearlyReward: new BN(dto.yearlyReward),
    nextDuration: new BN(dto.nextDuration),
    nextRewardAmount: new BN(dto.nextRewardAmount),
    bump: dto.bump,
  };
}
