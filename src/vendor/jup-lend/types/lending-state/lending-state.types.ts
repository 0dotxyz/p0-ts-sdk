import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Curated Lending State used throughout the codebase.
 *
 * integration_acc_1 – holds cToken/fToken exchange rates.
 * Analogous to a Kamino Reserve or Drift SpotMarket.
 */
export interface JupLendingState {
  pubkey: PublicKey;
  mint: PublicKey;
  fTokenMint: PublicKey;
  lendingId: number;
  decimals: number;
  rewardsRateModel: PublicKey;
  /** Exchange price for the underlying asset in the liquidity protocol (without rewards) */
  liquidityExchangePrice: BN;
  /** Exchange price between fToken and the underlying asset (with rewards) */
  tokenExchangePrice: BN;
  lastUpdateTimestamp: BN;
  tokenReservesLiquidity: PublicKey;
  supplyPositionOnLiquidity: PublicKey;
}
