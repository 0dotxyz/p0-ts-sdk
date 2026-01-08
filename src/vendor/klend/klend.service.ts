import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { KlendIdlType } from "./idl";
import klendInstructions from "./instructions";
import { ReserveRaw } from "./types";

type MakeRefreshingIxsParams = {
  klendProgram: Program<KlendIdlType>;
  // A "bank" in Kamino parlance
  reserve: ReserveRaw;
  reserveKey: PublicKey;
  obligationKey: PublicKey;
  program: Program<KlendIdlType>;
};

export async function makeRefreshingIxs({
  klendProgram,
  reserve,
  reserveKey,
  obligationKey,
  program,
}: MakeRefreshingIxsParams) {
  const tokenInfo = reserve.config.tokenInfo;
  const lendingMarket = reserve.lendingMarket;
  const refreshReserveIx = await klendInstructions.makeRefreshReserveIx({
    program: klendProgram,
    reserve: reserveKey,
    market: lendingMarket,
    pythOracle: tokenInfo.pythConfiguration.price,
    switchboardPriceOracle: tokenInfo.switchboardConfiguration.priceAggregator,
    switchboardTwapOracle: tokenInfo.switchboardConfiguration.twapAggregator,
    scopePrices: tokenInfo.scopeConfiguration.priceFeed,
  });

  const refreshObligationIx = klendInstructions.makeRefreshObligationIx(
    lendingMarket,
    obligationKey,
    reserveKey
  );

  return [refreshReserveIx, refreshObligationIx];
}
