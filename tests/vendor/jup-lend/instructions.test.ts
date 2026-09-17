import { address, getAddressDecoder, isSignerRole, isWritableRole } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { getAllDerivedJupLendAccounts, makeUpdateJupLendRateIx } from "~/vendor/jup-lend";

// Recorded from the web3.js builders and derivations these replaced; never update with `-u`.

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));

describe("jup-lend instruction wire format", () => {
  it("update_rate", () => {
    const ix = makeUpdateJupLendRateIx({
      pubkey: key(1),
      mint: key(2),
      fTokenMint: key(3),
      tokenReservesLiquidity: key(4),
      rewardsRateModel: key(5),
      lendingId: 0,
      decimals: 6,
      liquidityExchangePrice: 0n,
      tokenExchangePrice: 0n,
      lastUpdateTimestamp: 0n,
      supplyPositionOnLiquidity: key(6),
    });
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

  it.each([
    ["token", undefined],
    ["token-2022", address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")],
  ])("derived accounts (%s)", async (_, tokenProgram) => {
    expect(await getAllDerivedJupLendAccounts(key(9), tokenProgram)).toMatchSnapshot();
  });
});
