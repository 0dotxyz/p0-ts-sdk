import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { FeeStructure, OracleGuardRails } from "../internal";

export interface DriftState {
  admin: PublicKey;
  whitelistMint: PublicKey;
  discountMint: PublicKey;
  signer: PublicKey;
  srmVault: PublicKey;
  perpFeeStructure: FeeStructure;
  spotFeeStructure: FeeStructure;
  oracleGuardRails: OracleGuardRails;
  numberOfAuthorities: BN;
  numberOfSubAccounts: BN;
  lpCooldownTime: BN;
  liquidationMarginBufferRatio: number;
  settlementDuration: number;
  numberOfMarkets: number;
  numberOfSpotMarkets: number;
  signerNonce: number;
  minPerpAuctionDuration: number;
  defaultMarketOrderTimeInForce: number;
  defaultSpotAuctionDuration: number;
  exchangeStatus: number;
  liquidationDuration: number;
  initialPctToLiquidate: number;
  maxNumberOfSubAccounts: number;
  maxInitializeUserFee: number;
  padding: Array<number>;
}
