import {
  AccountRole,
  createNoopSigner,
  getAddressDecoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import {
  addOracleToBanksIx,
  configureScopeOracleIx,
  freezeBankConfigIx,
  setOraclePriceIx,
} from "~/services/bank/bank.service";
import { OracleSetup } from "~/services/bank/types";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));

const programAddress = key(1);
const groupAddress = key(2);
const admin = createNoopSigner(key(3));
const bankAddress = key(4);
const accounts = { programAddress, bankAddress, groupAddress, admin };

const remaining = (ix: Instruction) => ix.accounts?.slice(3).map((meta) => meta.address);
const readonly = (address: Address) => ({ address, role: AccountRole.READONLY });

describe("bank oracle admin instructions", () => {
  it("encodes the 0.1.11 Scope wire format", async () => {
    const oracle = key(5);

    const ix = await configureScopeOracleIx({ ...accounts, oracle, entryIndex: 511 });

    expect(ix.programAddress).toBe(programAddress);
    expect(ix.accounts).toEqual([
      readonly(groupAddress),
      { address: admin.address, role: AccountRole.READONLY_SIGNER, signer: admin },
      { address: bankAddress, role: AccountRole.WRITABLE },
      readonly(oracle),
    ]);
    const data = Uint8Array.from(ix.data ?? []);
    expect([...data.subarray(0, 8)]).toEqual([134, 228, 127, 3, 117, 132, 85, 146]);
    expect(getAddressDecoder().decode(data.subarray(8, 40))).toBe(oracle);
    expect(new DataView(data.buffer).getUint16(40, true)).toBe(511);
  });

  it("forwards every validation account required by multiplier setups", async () => {
    const feedId = key(5);
    const marinadeState = key(7);

    const ix = await addOracleToBanksIx({
      ...accounts,
      feedId,
      setup: OracleSetup.PythMSOL,
      oracleAccounts: [feedId, marinadeState],
    });

    expect(ix.data?.[8]).toBe(19);
    expect(ix.accounts?.slice(3)).toEqual([readonly(feedId), readonly(marinadeState)]);
  });

  it("rejects multiplier setups whose first oracle account is not the primary feed", async () => {
    await expect(
      addOracleToBanksIx({
        ...accounts,
        feedId: key(5),
        setup: OracleSetup.PythMSOL,
        oracleAccounts: [key(6), key(7)],
      })
    ).rejects.toThrow("oracleAccounts[0]");
  });

  it("routes every fixed setup away from configure-bank-oracle", async () => {
    for (const setup of [
      OracleSetup.Fixed,
      OracleSetup.FixedKamino,
      OracleSetup.FixedDrift,
      OracleSetup.FixedJuplend,
    ]) {
      await expect(addOracleToBanksIx({ ...accounts, feedId: key(5), setup })).rejects.toThrow(
        "setOraclePriceIx"
      );
    }
  });

  it("routes PT setup through the 0.1.11 set-oracle-price instruction", async () => {
    const pyth = key(6);
    const vault = key(7);

    const ix = await setOraclePriceIx({
      ...accounts,
      price: new BigNumber(0.8),
      setup: OracleSetup.PTPyth,
      oracleAccounts: [pyth, vault],
    });

    expect(ix.data?.[8 + 16]).toBe(25);
    expect(remaining(ix)).toEqual([pyth, vault]);

    await expect(
      setOraclePriceIx({
        ...accounts,
        price: new BigNumber(0.8),
        setup: OracleSetup.PTFixed,
        oracleAccounts: [],
      })
    ).rejects.toThrow("PTFixed requires 1 ordered oracle accounts");
  });

  it("freezes settings without touching any other config field", async () => {
    const ix = await freezeBankConfigIx(accounts);

    // 8-byte discriminator, then every Option<T> is None (0) except freezeSettings = Some(true)
    const options = [...(ix.data ?? [])].slice(8);
    expect(options).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, ...Array(11).fill(0)]);
  });
});
