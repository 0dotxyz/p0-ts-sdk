import {
  AccountRole,
  address,
  createNoopSigner,
  getAddressDecoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import {
  addOracleToBanksIx,
  configureScopeOracleIx,
  freezeBankConfigIx,
  setOraclePriceIx,
} from "~/services/bank/bank.service";
import { AssetTag, BankType, OracleSetup } from "~/services/bank/types";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));

const programAddress = key(1);
const groupAddress = key(2);
const governanceAdmin = createNoopSigner(key(3));
const bankAddress = key(4);
const accounts = { programAddress, bankAddress, groupAddress, governanceAdmin };
const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");

// group, governance admin, bank, instructions sysvar, then the oracle accounts
const remaining = (ix: Instruction) => ix.accounts?.slice(4).map((meta) => meta.address);
const readonly = (address: Address) => ({ address, role: AccountRole.READONLY });
const scopeBank = (assetTag: AssetTag, integrationAccount: Address) =>
  ({
    address: bankAddress,
    config: { assetTag, oracleKeys: [key(8), integrationAccount] },
  }) as unknown as BankType;

describe("bank oracle admin instructions", () => {
  it.each([
    [AssetTag.DEFAULT, false],
    [AssetTag.KAMINO, true],
    [AssetTag.JUPLEND, true],
  ])(
    "encodes the 0.1.12 Scope wire format for asset tag %s, adding oracleKeys[1] for venue banks: %s",
    async (assetTag, withIntegrationAccount) => {
      const oracle = key(5);
      const integrationAccount = key(6);

      const ix = await configureScopeOracleIx({
        programAddress,
        groupAddress,
        governanceAdmin,
        bank: scopeBank(assetTag, integrationAccount),
        oracle,
        entryIndex: 511,
      });

      expect(ix.programAddress).toBe(programAddress);
      expect(ix.accounts).toEqual([
        readonly(groupAddress),
        {
          address: governanceAdmin.address,
          role: AccountRole.READONLY_SIGNER,
          signer: governanceAdmin,
        },
        { address: bankAddress, role: AccountRole.WRITABLE },
        readonly(INSTRUCTIONS_SYSVAR),
        readonly(oracle),
        ...(withIntegrationAccount ? [readonly(integrationAccount)] : []),
      ]);
      const data = Uint8Array.from(ix.data ?? []);
      expect([...data.subarray(0, 8)]).toEqual([134, 228, 127, 3, 117, 132, 85, 146]);
      expect(getAddressDecoder().decode(data.subarray(8, 40))).toBe(oracle);
      expect(new DataView(data.buffer).getUint16(40, true)).toBe(511);
    }
  );

  it("routes every Scope setup away from configure-bank-oracle", async () => {
    for (const setup of [OracleSetup.Scope, OracleSetup.ScopeKamino, OracleSetup.ScopeJuplend]) {
      await expect(addOracleToBanksIx({ ...accounts, feedId: key(5), setup })).rejects.toThrow(
        "configureScopeOracleIx"
      );
    }
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
    expect(ix.accounts?.slice(4)).toEqual([readonly(feedId), readonly(marinadeState)]);
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

  it("routes PT setup through the set-oracle-price instruction", async () => {
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

  it("freezes settings through configure-bank-gov without touching any other field", async () => {
    const ix = await freezeBankConfigIx(accounts);

    // 8-byte discriminator, then every gov Option<T> is None (0) except the last,
    // freezeSettings = Some(true)
    const options = [...(ix.data ?? [])].slice(8);
    expect(options).toEqual([...Array(10).fill(0), 1, 1]);
  });
});
