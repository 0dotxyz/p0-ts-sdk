import { SpotPositionJSON } from "../internal";

export interface DriftUserJSON {
  authority: string;
  spotPositions: Array<SpotPositionJSON>;
}
