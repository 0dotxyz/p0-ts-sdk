import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { SpotPosition } from "../internal";

export interface DriftUserRaw {
  authority: PublicKey;
  delegate: PublicKey;
  name: Array<number>;
  spotPositions: Array<SpotPosition>;
  perpPositions: Array<any>; // PerpPosition[]
  orders: Array<any>; // Order[]
  lastAddPerpLpSharesTs: BN;
  totalDeposits: BN;
  totalWithdraws: BN;
  totalSocialLoss: BN;
  settledPerpPnl: BN;
  cumulativeSpotFees: BN;
  cumulativePerpFunding: BN;
  liquidationMarginFreed: BN;
  lastActiveSlot: BN;
  nextOrderId: number;
  maxMarginRatio: number;
  nextLiquidationId: number;
  subAccountId: number;
  status: number;
  isMarginTradingEnabled: boolean;
  idle: boolean;
  openOrders: number;
  hasOpenOrder: boolean;
  openAuctions: number;
  hasOpenAuction: boolean;
  marginMode: any; // MarginMode enum
  poolId: number;
  padding1: Array<number>;
  lastFuelBonusUpdateTs: number;
  padding: Array<number>;
}
