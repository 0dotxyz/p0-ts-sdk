import { getAddressDecoder, isSignerRole, isWritableRole, type Instruction } from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  findPoolAddress,
  findPoolMintAddress,
  findPoolMintAuthorityAddress,
  findPoolOnRampAddress,
  findPoolStakeAddress,
  findPoolStakeAuthorityAddress,
  makeSinglePoolDepositStakeIx,
  makeSinglePoolWithdrawStakeIx,
} from "~/vendor/single-spl-pool";

// Recorded from the web3.js implementation this replaced; never update with `-u`.

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const toWire = (ix: Instruction) => ({
  programId: ix.programAddress,
  keys: (ix.accounts ?? []).map((a) => [a.address, isSignerRole(a.role), isWritableRole(a.role)]),
  data: Buffer.from(ix.data ?? []).toString("hex"),
});

const voteAccount = key(1);

describe("single-spl-pool wire format", () => {
  it("pool addresses", async () => {
    const pool = await findPoolAddress(voteAccount);
    expect({
      pool,
      stake: await findPoolStakeAddress(pool),
      mint: await findPoolMintAddress(pool),
      onRamp: await findPoolOnRampAddress(pool),
      stakeAuthority: await findPoolStakeAuthorityAddress(pool),
      mintAuthority: await findPoolMintAuthorityAddress(pool),
    }).toMatchSnapshot();
  });

  it("depositStake", async () => {
    const pool = await findPoolAddress(voteAccount);
    expect(
      toWire(await makeSinglePoolDepositStakeIx(pool, key(2), key(3), key(4)))
    ).toMatchSnapshot();
  });

  it("withdrawStake", async () => {
    const pool = await findPoolAddress(voteAccount);
    expect(
      toWire(await makeSinglePoolWithdrawStakeIx(pool, key(2), key(5), key(3), 12_345_678_901n))
    ).toMatchSnapshot();
  });
});
