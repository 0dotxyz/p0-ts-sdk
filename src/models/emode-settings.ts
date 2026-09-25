import { EmodeEntry, EmodeFlags, EmodeSettingsType, EmodeTag } from "../services";
import type { EmodeSettingsRaw } from "../services/bank/types/raw-bank.types";
import { parseEmodeSettingsRaw } from "../services/bank/utils/deserialize.utils";

export class EmodeSettings implements EmodeSettingsType {
  constructor(
    public emodeTag: EmodeTag,
    public timestamp: number,
    public flags: EmodeFlags[],
    public emodeEntries: EmodeEntry[]
  ) {
    this.emodeTag = emodeTag;
    this.timestamp = timestamp;
    this.flags = flags;
    this.emodeEntries = emodeEntries;
  }

  static fromEmodeSettingsType(emodeSettingsType: EmodeSettingsType): EmodeSettings {
    return new EmodeSettings(
      emodeSettingsType.emodeTag,
      emodeSettingsType.timestamp,
      emodeSettingsType.flags,
      emodeSettingsType.emodeEntries
    );
  }

  static from(emodeSettingsRaw: EmodeSettingsRaw): EmodeSettings {
    const emodeSettingsType = parseEmodeSettingsRaw(emodeSettingsRaw);
    return EmodeSettings.fromEmodeSettingsType(emodeSettingsType);
  }
}
