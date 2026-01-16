import { FeeStructureJSON, OracleGuardRailsJSON } from "../internal";

export interface DriftStateJSON {
  admin: string;
  whitelistMint: string;
  discountMint: string;
  signer: string;
  srmVault: string;
  perpFeeStructure: FeeStructureJSON;
  spotFeeStructure: FeeStructureJSON;
  oracleGuardRails: OracleGuardRailsJSON;
  numberOfAuthorities: string;
  numberOfSubAccounts: string;
  lpCooldownTime: string;
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
