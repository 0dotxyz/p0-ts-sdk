import { PublicKey } from "@solana/web3.js";
import { SpotPosition, SpotPositionJSON } from "./internal";

export type DriftRewards = {
  oracle: PublicKey;
  marketIndex: number;
  spotMarket: PublicKey;
  mint: PublicKey;
  spotPosition: SpotPosition;
};

export type DriftRewardsJSON = {
  oracle: string;
  marketIndex: number;
  spotMarket: string;
  mint: string;
  spotPosition: SpotPositionJSON;
};
