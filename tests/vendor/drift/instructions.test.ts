import { getAddressDecoder, isSignerRole, isWritableRole } from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  deriveDriftUser,
  deriveDriftUserStats,
  getAllDerivedDriftAccounts,
  makeUpdateSpotMarketCumulativeInterestIx,
  type DriftSpotMarket,
} from "~/vendor/drift";

// Recorded from the web3.js implementation this replaced; never update with `-u`.

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));

describe("drift wire format", () => {
  it.each([0, 7])("derived accounts (market %i)", async (marketIndex) => {
    expect({
      ...(await getAllDerivedDriftAccounts(marketIndex)),
      user: (await deriveDriftUser(key(1), 0))[0],
      userSubAccount3: (await deriveDriftUser(key(1), 3))[0],
      userStats: (await deriveDriftUserStats(key(1)))[0],
    }).toMatchSnapshot();
  });

  it("update_spot_market_cumulative_interest", async () => {
    const ix = await makeUpdateSpotMarketCumulativeInterestIx({
      pubkey: key(2),
      oracle: key(3),
      marketIndex: 7,
    } as DriftSpotMarket);
    expect({
      programId: ix.programAddress,
      keys: (ix.accounts ?? []).map((a) => [
        a.address,
        isSignerRole(a.role),
        isWritableRole(a.role),
      ]),
      data: Buffer.from(ix.data ?? []).toString("hex"),
    }).toMatchSnapshot();
  });
});
