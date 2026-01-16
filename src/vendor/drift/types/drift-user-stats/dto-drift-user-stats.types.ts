export interface DriftUserStatsJSON {
  /** The authority for all of a users sub accounts */
  authority: string;
  /** The address that referred this user */
  referrer: string;
  /** Stats on the fees paid by the user */
  fees: UserFeesJSON;
  /**
   * The timestamp of the next epoch
   * Epoch is used to limit referrer rewards earned in single epoch
   */
  nextEpochTs: string;
  /**
   * Rolling 30day maker volume for user
   * precision: QUOTE_PRECISION
   */
  makerVolume30d: string;
  /**
   * Rolling 30day taker volume for user
   * precision: QUOTE_PRECISION
   */
  takerVolume30d: string;
  /**
   * Rolling 30day filler volume for user
   * precision: QUOTE_PRECISION
   */
  fillerVolume30d: string;
  /** last time the maker volume was updated */
  lastMakerVolume30dTs: string;
  /** last time the taker volume was updated */
  lastTakerVolume30dTs: string;
  /** last time the filler volume was updated */
  lastFillerVolume30dTs: string;
  /** The amount of tokens staked in the quote spot markets if */
  ifStakedQuoteAssetAmount: string;
  /** The current number of sub accounts */
  numberOfSubAccounts: number;
  /**
   * The number of sub accounts created. Can be greater than the number of sub accounts if user
   * has deleted sub accounts
   */
  numberOfSubAccountsCreated: number;
  /**
   * Flags for referrer status:
   * First bit (LSB): 1 if user is a referrer, 0 otherwise
   * Second bit: 1 if user was referred, 0 otherwise
   */
  referrerStatus: number;
  disableUpdatePerpBidAskTwap: boolean;
  padding1: Array<number>;
  /** whether the user has a FuelOverflow account */
  fuelOverflowStatus: number;
  /** accumulated fuel for token amounts of insurance */
  fuelInsurance: number;
  /** accumulated fuel for notional of deposits */
  fuelDeposits: number;
  /** accumulate fuel bonus for notional of borrows */
  fuelBorrows: number;
  /** accumulated fuel for perp open interest */
  fuelPositions: number;
  /** accumulate fuel bonus for taker volume */
  fuelTaker: number;
  /** accumulate fuel bonus for maker volume */
  fuelMaker: number;
  /** The amount of tokens staked in the governance spot markets if */
  ifStakedGovTokenAmount: string;
  /**
   * last unix ts user stats data was used to update if fuel (u32 to save space)
   */
  lastFuelIfBonusUpdateTs: number;
  padding: Array<number>;
}

export interface UserFeesJSON {
  /**
   * Total taker fee paid
   * precision: QUOTE_PRECISION
   */
  totalFeePaid: string;
  /**
   * Total maker fee rebate
   * precision: QUOTE_PRECISION
   */
  totalFeeRebate: string;
  /**
   * Total discount from holding token
   * precision: QUOTE_PRECISION
   */
  totalTokenDiscount: string;
  /**
   * Total discount from being referred
   * precision: QUOTE_PRECISION
   */
  totalRefereeDiscount: string;
  /**
   * Total reward to referrer
   * precision: QUOTE_PRECISION
   */
  totalReferrerReward: string;
  /**
   * Total reward to referrer this epoch
   * precision: QUOTE_PRECISION
   */
  currentEpochReferrerReward: string;
}
