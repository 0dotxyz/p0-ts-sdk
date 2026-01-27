export interface DriftSpotMarketJSON {
  pubkey: string;
  oracle: string;
  mint: string;
  decimals: number;
  cumulativeDepositInterest: string;
  marketIndex: number;

  // Additional fields needed for APY calculation
  depositBalance: string;
  borrowBalance: string;
  cumulativeBorrowInterest: string;
  optimalUtilization: number;
  optimalBorrowRate: number;
  maxBorrowRate: number;
  minBorrowRate: number;
  insuranceFund: {
    totalFactor: number;
  };

  // Pool identifier for market labeling (Main Market, JLP Market, LST Market, etc.)
  poolId: number;
}
