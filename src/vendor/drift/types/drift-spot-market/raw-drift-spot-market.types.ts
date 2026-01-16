import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  HistoricalOracleData,
  HistoricalIndexData,
  PoolBalance,
  InsuranceFund,
} from "../internal";

export interface DriftSpotMarketRaw {
  pubkey: PublicKey;
  oracle: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  name: Array<number>;
  historicalOracleData: HistoricalOracleData;
  historicalIndexData: HistoricalIndexData;
  revenuePool: PoolBalance;
  spotFeePool: PoolBalance;
  insuranceFund: InsuranceFund;
  totalSpotFee: BN;
  depositBalance: BN;
  borrowBalance: BN;
  cumulativeDepositInterest: BN;
  cumulativeBorrowInterest: BN;
  totalSocialLoss: BN;
  totalQuoteSocialLoss: BN;
  withdrawGuardThreshold: BN;
  maxTokenDeposits: BN;
  depositTokenTwap: BN;
  borrowTokenTwap: BN;
  utilizationTwap: BN;
  lastInterestTs: BN;
  lastTwapTs: BN;
  expiryTs: BN;
  orderStepSize: BN;
  orderTickSize: BN;
  minOrderSize: BN;
  maxPositionSize: BN;
  nextFillRecordId: BN;
  nextDepositRecordId: BN;
  initialAssetWeight: number;
  maintenanceAssetWeight: number;
  initialLiabilityWeight: number;
  maintenanceLiabilityWeight: number;
  imfFactor: number;
  liquidatorFee: number;
  ifLiquidationFee: number;
  optimalUtilization: number;
  optimalBorrowRate: number;
  maxBorrowRate: number;
  decimals: number;
  marketIndex: number;
  ordersEnabled: boolean;
  oracleSource: any; // OracleSource enum
  status: any; // MarketStatus enum
  assetTier: any; // AssetTier enum
  pausedOperations: number;
  ifPausedOperations: number;
  feeAdjustment: number;
  maxTokenBorrowsFraction: number;
  flashLoanAmount: BN;
  flashLoanInitialTokenAmount: BN;
  totalSwapFee: BN;
  scaleInitialAssetWeightStart: BN;
  minBorrowRate: number;
  fuelBoostDeposits: number;
  fuelBoostBorrows: number;
  fuelBoostTaker: number;
  fuelBoostMaker: number;
  fuelBoostInsurance: number;
  tokenProgram: number;
  poolId: number;
  padding: Array<number>;
}
