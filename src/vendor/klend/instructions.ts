import { AccountRole, type Address, type Instruction } from "@solana/kit";

import type { KaminoReserve } from "./types";

import {
  getRefreshObligationInstruction,
  getRefreshReserveInstruction,
  getRefreshReservesBatchInstruction,
} from "~/generated/klend";

const DISABLED_ORACLES = new Set([
  "11111111111111111111111111111111",
  "nu11111111111111111111111111111111111111111",
]);

function enabledOracle(oracle: Address): Address | undefined {
  return DISABLED_ORACLES.has(oracle) ? undefined : oracle;
}

/** Refreshes `reserve` with whichever of its configured oracles are enabled. */
export function makeRefreshReserveIx(reserveAddress: Address, reserve: KaminoReserve): Instruction {
  const { tokenInfo } = reserve.config;
  return getRefreshReserveInstruction({
    reserve: reserveAddress,
    lendingMarket: reserve.lendingMarket,
    pythOracle: enabledOracle(tokenInfo.pythConfiguration.price),
    switchboardPriceOracle: enabledOracle(tokenInfo.switchboardConfiguration.priceAggregator),
    switchboardTwapOracle: enabledOracle(tokenInfo.switchboardConfiguration.twapAggregator),
    scopePrices: enabledOracle(tokenInfo.scopeConfiguration.priceFeed),
  });
}

/** Refreshes an obligation holding a single position in `reserve`. */
export function makeRefreshObligationIx(
  lendingMarket: Address,
  obligation: Address,
  reserve: Address
): Instruction {
  const ix = getRefreshObligationInstruction({ lendingMarket, obligation });
  return { ...ix, accounts: [...ix.accounts, { address: reserve, role: AccountRole.READONLY }] };
}

/** Refreshes many reserves in one instruction without updating prices. */
export function makeRefreshReservesBatchIx(
  reserves: { reserve: Address; lendingMarket: Address }[]
): Instruction {
  return {
    ...getRefreshReservesBatchInstruction({ skipPriceUpdates: true }),
    accounts: reserves.flatMap(({ reserve, lendingMarket }) => [
      { address: reserve, role: AccountRole.WRITABLE },
      { address: lendingMarket, role: AccountRole.READONLY },
    ]),
  };
}

/** Refresh reserve then refresh obligation, as required before a Kamino deposit/withdraw CPI. */
export function makeRefreshingIxs(
  reserveAddress: Address,
  reserve: KaminoReserve,
  obligation: Address
): Instruction[] {
  return [
    makeRefreshReserveIx(reserveAddress, reserve),
    makeRefreshObligationIx(reserve.lendingMarket, obligation, reserveAddress),
  ];
}
