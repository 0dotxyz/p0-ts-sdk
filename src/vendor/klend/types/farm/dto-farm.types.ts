export interface FarmStateJSON {
  farmAdmin: string;
  globalConfig: string;
  token: TokenInfoJSON;
  rewardInfos: Array<RewardInfoJSON>;
  numRewardTokens: string;
  /** Data used to calculate the rewards of the user */
  numUsers: string;
  /**
   * The number of token in the `farm_vault` staked (getting rewards and fees)
   * Set such as `farm_vault.amount = total_staked_amount + total_pending_amount`
   */
  totalStakedAmount: string;
  farmVault: string;
  farmVaultsAuthority: string;
  farmVaultsAuthorityBump: string;
  /**
   * Only used for delegate farms
   * Set to `default()` otherwise
   */
  delegateAuthority: string;
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
  withdrawAuthority: string;
  /**
   * Delay between a user deposit and the moment it is considered as staked
   * 0 if unused
   */
  depositWarmupPeriod: number;
  /** Delay between a user unstake and the ability to withdraw his deposit. */
  withdrawalCooldownPeriod: number;
  /** Total active stake of tokens in the farm (scaled from `Decimal` representation). */
  totalActiveStakeScaled: string;
  /**
   * Total pending stake of tokens in the farm (scaled from `Decimal` representation).
   * (can be used by `withdraw_authority` but don't get rewards or fees)
   */
  totalPendingStakeScaled: string;
  /** Total pending amount of tokens in the farm */
  totalPendingAmount: string;
  /** Slashed amounts from early withdrawal */
  slashedAmountCurrent: string;
  slashedAmountCumulative: string;
  slashedAmountSpillAddress: string;
  /** Locking stake */
  lockingMode: string;
  lockingStartTimestamp: string;
  lockingDuration: string;
  lockingEarlyWithdrawalPenaltyBps: string;
  depositCapAmount: string;
  scopePrices: string;
  scopeOraclePriceId: string;
  scopeOracleMaxAge: string;
  pendingFarmAdmin: string;
  strategyId: string;
  delegatedRpsAdmin: string;
  vaultId: string;
  secondDelegatedAuthority: string;
  padding: Array<string>;
}

interface TokenInfoJSON {
  mint: string;
  decimals: string;
  tokenProgram: string;
  padding: Array<string>;
}

interface RewardInfoJSON {
  token: TokenInfoJSON;
  rewardsVault: string;
  rewardsAvailable: string;
  rewardScheduleCurve: RewardScheduleCurveJSON;
  minClaimDurationSeconds: string;
  lastIssuanceTs: string;
  rewardsIssuedUnclaimed: string;
  rewardsIssuedCumulative: string;
  rewardPerShareScaled: string;
  placeholder0: string;
  rewardType: number;
  rewardsPerSecondDecimals: number;
  padding0: Array<number>;
  padding1: Array<string>;
}

export interface RewardScheduleCurveJSON {
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
  points: Array<RewardPerTimeUnitPointJSON>;
}

export interface RewardPerTimeUnitPointJSON {
  tsStart: string;
  rewardPerTimeUnit: string;
}
