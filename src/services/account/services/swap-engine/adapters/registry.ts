import { SwapAdapter } from "../types";

import { jupiterAdapter } from "./jupiter.adapter";
import { titanAdapter } from "./titan.adapter";

import { SwapProvider } from "~/services/account/types";

/**
 * Registry of swap providers. To add a provider: implement a `SwapAdapter` and
 * add one entry here — the engine picks it up automatically for any request that
 * lists the provider in `providers`.
 */
export const SWAP_ADAPTERS: Partial<Record<SwapProvider, SwapAdapter>> = {
  [SwapProvider.TITAN]: titanAdapter,
  [SwapProvider.JUPITER]: jupiterAdapter,
};

export function getSwapAdapter(provider: SwapProvider): SwapAdapter | undefined {
  return SWAP_ADAPTERS[provider];
}
