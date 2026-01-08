import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export interface FarmStateRaw {
  farmAdmin: PublicKey;
  globalConfig: PublicKey;
  token: TokenInfoFields;
  rewardInfos: Array<RewardInfoFields>;
  numRewardTokens: BN;
  /** Data used to calculate the rewards of the user */
  numUsers: BN;
  /**
   * The number of token in the `farm_vault` staked (getting rewards and fees)
   * Set such as `farm_vault.amount = total_staked_amount + total_pending_amount`
   */
  totalStakedAmount: BN;
  farmVault: PublicKey;
  farmVaultsAuthority: PublicKey;
  farmVaultsAuthorityBump: BN;
  /**
   * Only used for delegate farms
   * Set to `default()` otherwise
   */
  delegateAuthority: PublicKey;
  /**
   * Raw representation of a `TimeUnit`
   * Seconds = 0, Slots = 1
   */
  timeUnit: number;
  /**
   * Automatically set to true in case of a full authority withdrawal
   * If true, the farm is frozen and no more deposits are allowed
   */
  isFarmFrozen: number;
  /**
   * Indicates if the farm is a delegate farm
   * If true, the farm is a delegate farm and the `delegate_authority` is set*
   */
  isFarmDelegated: number;
  padding0: Array<number>;
  /**
   * Withdraw authority for the farm, allowed to lock deposited funds and withdraw them
   * Set to `default()` if unused (only the depositors can withdraw their funds)
   */
  withdrawAuthority: PublicKey;
  /**
   * Delay between a user deposit and the moment it is considered as staked
   * 0 if unused
   */
  depositWarmupPeriod: number;
  /** Delay between a user unstake and the ability to withdraw his deposit. */
  withdrawalCooldownPeriod: number;
  /** Total active stake of tokens in the farm (scaled from `Decimal` representation). */
  totalActiveStakeScaled: BN;
  /**
   * Total pending stake of tokens in the farm (scaled from `Decimal` representation).
   * (can be used by `withdraw_authority` but don't get rewards or fees)
   */
  totalPendingStakeScaled: BN;
  /** Total pending amount of tokens in the farm */
  totalPendingAmount: BN;
  /** Slashed amounts from early withdrawal */
  slashedAmountCurrent: BN;
  slashedAmountCumulative: BN;
  slashedAmountSpillAddress: PublicKey;
  /** Locking stake */
  lockingMode: BN;
  lockingStartTimestamp: BN;
  lockingDuration: BN;
  lockingEarlyWithdrawalPenaltyBps: BN;
  depositCapAmount: BN;
  scopePrices: PublicKey;
  scopeOraclePriceId: BN;
  scopeOracleMaxAge: BN;
  pendingFarmAdmin: PublicKey;
  strategyId: PublicKey;
  delegatedRpsAdmin: PublicKey;
  vaultId: PublicKey;
  secondDelegatedAuthority: PublicKey;
  padding: Array<BN>;
}

interface TokenInfoFields {
  mint: PublicKey;
  decimals: BN;
  tokenProgram: PublicKey;
  padding: Array<BN>;
}

export interface RewardInfoFields {
  token: TokenInfoFields;
  rewardsVault: PublicKey;
  rewardsAvailable: BN;
  rewardScheduleCurve: RewardScheduleCurveFields;
  minClaimDurationSeconds: BN;
  lastIssuanceTs: BN;
  rewardsIssuedUnclaimed: BN;
  rewardsIssuedCumulative: BN;
  rewardPerShareScaled: BN;
  placeholder0: BN;
  rewardType: number;
  rewardsPerSecondDecimals: number;
  padding0: Array<number>;
  padding1: Array<BN>;
}

export interface RewardPerTimeUnitPointFields {
  tsStart: BN;
  rewardPerTimeUnit: BN;
}

export interface RewardScheduleCurveFields {
  /**
   * This is a stepwise function, meaning that each point represents
   * how many rewards are issued per time unit since the beginning
   * of that point until the beginning of the next point.
   * This is not a linear curve, there is no interpolation going on.
   * A curve can be [[t0, 100], [t1, 50], [t2, 0]]
   * meaning that from t0 to t1, 100 rewards are issued per time unit,
   * from t1 to t2, 50 rewards are issued per time unit, and after t2 it stops
   * Another curve, can be [[t0, 100], [u64::max, 0]]
   * meaning that from t0 to u64::max, 100 rewards are issued per time unit
   */
  points: Array<RewardPerTimeUnitPointFields>;
}
