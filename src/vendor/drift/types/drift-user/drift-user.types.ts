import { PublicKey } from "@solana/web3.js";
import { SpotPosition } from "../internal";

export interface DriftUser {
  authority: PublicKey;
  spotPositions: Array<SpotPosition>;
}
