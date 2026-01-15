import { PublicKey } from "@solana/web3.js";
import type { Environment, Project0Config } from "./types";
import { array, assert, enums, object, string } from "superstruct";
import type { Infer } from "superstruct";
import configs from "./configs.json";

const Project0ConfigRaw = object({
  label: enums([
    "production",
    "staging",
    "staging-mainnet-clone",
    "staging-alt",
  ]),
  program: string(),
  group: string(),
});
const ConfigRaw = array(Project0ConfigRaw);

export type Project0ConfigRaw = Infer<typeof Project0ConfigRaw>;
export type ConfigRaw = Infer<typeof ConfigRaw>;

function parseConfig(configRaw: Project0ConfigRaw): Project0Config {
  return {
    environment: configRaw.label,
    programId: new PublicKey(configRaw.program),
    groupPk: new PublicKey(configRaw.group),
  };
}

function parseConfigs(configRaw: ConfigRaw): {
  [label: string]: Project0Config;
} {
  return configRaw.reduce(
    (config, current, _) => ({
      [current.label]: parseConfig(current),
      ...config,
    }),
    {} as {
      [label: string]: Project0Config;
    }
  );
}

function loadDefaultConfig(): {
  [label: string]: Project0Config;
} {
  assert(configs, ConfigRaw);
  return parseConfigs(configs);
}

/**
 * Define marginfi-specific config per profile
 *
 * @internal
 */
function getProject0Config(
  environment: Environment,
  overrides?: Partial<Omit<Project0Config, "environment">>
): Project0Config {
  const defaultConfigs = loadDefaultConfig();

  const defaultConfig = defaultConfigs[environment]!;
  return {
    environment,
    programId: overrides?.programId || defaultConfig.programId,
    groupPk: overrides?.groupPk || defaultConfig.groupPk,
  };
}

/**
 * Retrieve config per environment
 */
export function getConfig(
  environment: Environment = "production",
  overrides?: Partial<Omit<Project0Config, "environment">>
): Project0Config {
  return {
    ...getProject0Config(environment, overrides),
  };
}
