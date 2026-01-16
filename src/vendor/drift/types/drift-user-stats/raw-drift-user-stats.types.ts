import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export interface DriftUserStats {
  authority: PublicKey;
  referrer: PublicKey;
  fees: UserFeesFields;
  nextEpochTs: BN;
  makerVolume30d: BN;
  takerVolume30d: BN;
  fillerVolume30d: BN;
  lastMakerVolume30dTs: BN;
  lastTakerVolume30dTs: BN;
  lastFillerVolume30dTs: BN;
  ifStakedQuoteAssetAmount: BN;
  numberOfSubAccounts: number;
  numberOfSubAccountsCreated: number;
  referrerStatus: number;
  disableUpdatePerpBidAskTwap: boolean;
  padding1: Array<number>;
  fuelOverflowStatus: number;
  fuelInsurance: number;
  fuelDeposits: number;
  fuelBorrows: number;
  fuelPositions: number;
  fuelTaker: number;
  fuelMaker: number;
  ifStakedGovTokenAmount: BN;
  lastFuelIfBonusUpdateTs: number;
  padding: Array<number>;
}

export interface UserFeesFields {
  totalFeePaid: BN;
  totalFeeRebate: BN;
  totalTokenDiscount: BN;
  totalRefereeDiscount: BN;
  totalReferrerReward: BN;
  currentEpochReferrerReward: BN;
}
