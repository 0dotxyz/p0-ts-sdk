import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import { describe, expect, it, vi } from "vitest";

import instructions from "~/instructions";
import {
  addOracleToBanksIx,
  configureScopeOracleIx,
  OracleSetup,
  setOraclePriceIx,
} from "~/services/bank";
import syncInstructions from "~/sync-instructions";
import type { MarginfiProgram } from "~/types";

const publicKey = (fill: number) => new PublicKey(new Uint8Array(32).fill(fill));

describe("Scope oracle configuration instruction", () => {
  it("encodes the 0.1.11 wire format", () => {
    const programId = publicKey(1);
    const group = publicKey(2);
    const admin = publicKey(3);
    const bank = publicKey(4);
    const oracle = publicKey(5);

    const ix = syncInstructions.makeLendingPoolConfigureBankOracleScopeIx(
      programId,
      { group, admin, bank },
      { oracle, entryIndex: 511 }
    );

    expect(ix.programId.equals(programId)).toBe(true);
    expect(ix.keys).toEqual([
      { pubkey: group, isSigner: false, isWritable: false },
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: bank, isSigner: false, isWritable: true },
      { pubkey: oracle, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.subarray(0, 8)).toEqual(Buffer.from([134, 228, 127, 3, 117, 132, 85, 146]));
    expect(ix.data.subarray(8, 40)).toEqual(oracle.toBuffer());
    expect(ix.data.readUInt16LE(40)).toBe(511);
  });

  it("exposes the typed Anchor builder through the bank service", async () => {
    const bank = publicKey(4);
    const group = publicKey(2);
    const admin = publicKey(3);
    const oracle = publicKey(5);
    const expectedIx = new TransactionInstruction({
      programId: publicKey(1),
      keys: [],
      data: Buffer.alloc(0),
    });
    const instruction = vi.fn().mockResolvedValue(expectedIx);
    const remainingAccounts = vi.fn().mockReturnValue({ instruction });
    const accountsPartial = vi.fn().mockReturnValue({ remainingAccounts });
    const accounts = vi.fn().mockReturnValue({ accountsPartial });
    const lendingPoolConfigureBankOracleScope = vi.fn().mockReturnValue({ accounts });
    const program = {
      methods: { lendingPoolConfigureBankOracleScope },
    } as unknown as MarginfiProgram;

    const wrapper = await configureScopeOracleIx({
      program,
      bankAddress: bank,
      oracle,
      entryIndex: 37,
      groupAddress: group,
      adminAddress: admin,
    });

    expect(lendingPoolConfigureBankOracleScope).toHaveBeenCalledWith(oracle, 37);
    expect(accounts).toHaveBeenCalledWith({ bank });
    expect(accountsPartial).toHaveBeenCalledWith({ group, admin });
    expect(remainingAccounts).toHaveBeenCalledWith([
      { pubkey: oracle, isSigner: false, isWritable: false },
    ]);
    expect(wrapper).toEqual({ instructions: [expectedIx], keys: [] });
  });

  it("keeps the low-level async builder available", () => {
    expect(instructions.makeLendingPoolConfigureBankOracleScopeIx).toBeTypeOf("function");
  });

  it("forwards every validation account required by multiplier setups", async () => {
    const bank = publicKey(4);
    const feedId = publicKey(5);
    const pyth = publicKey(6);
    const marinadeState = publicKey(7);
    const expectedIx = new TransactionInstruction({
      programId: publicKey(1),
      keys: [],
      data: Buffer.alloc(0),
    });
    const instruction = vi.fn().mockResolvedValue(expectedIx);
    const remainingAccounts = vi.fn().mockReturnValue({ instruction });
    const accountsPartial = vi.fn().mockReturnValue({ remainingAccounts });
    const accounts = vi.fn().mockReturnValue({ accountsPartial });
    const lendingPoolConfigureBankOracle = vi.fn().mockReturnValue({ accounts });
    const program = {
      methods: { lendingPoolConfigureBankOracle },
    } as unknown as MarginfiProgram;

    await addOracleToBanksIx({
      program,
      bankAddress: bank,
      feedId,
      setup: OracleSetup.PythMSOL,
      oracleAccounts: [pyth, marinadeState],
    });

    expect(lendingPoolConfigureBankOracle).toHaveBeenCalledWith(19, feedId);
    expect(remainingAccounts).toHaveBeenCalledWith([
      { pubkey: pyth, isSigner: false, isWritable: false },
      { pubkey: marinadeState, isSigner: false, isWritable: false },
    ]);
  });

  it("routes PT setup through the 0.1.11 set-oracle-price instruction", async () => {
    const bank = publicKey(4);
    const pyth = publicKey(6);
    const vault = publicKey(7);
    const expectedIx = new TransactionInstruction({
      programId: publicKey(1),
      keys: [],
      data: Buffer.alloc(0),
    });
    const instruction = vi.fn().mockResolvedValue(expectedIx);
    const remainingAccounts = vi.fn().mockReturnValue({ instruction });
    const accountsPartial = vi.fn().mockReturnValue({ remainingAccounts });
    const accounts = vi.fn().mockReturnValue({ accountsPartial });
    const lendingPoolSetOraclePrice = vi.fn().mockReturnValue({ accounts });
    const program = {
      methods: { lendingPoolSetOraclePrice },
    } as unknown as MarginfiProgram;

    await setOraclePriceIx({
      program,
      bankAddress: bank,
      price: new BigNumber(0.8),
      setup: OracleSetup.PTPyth,
      oracleAccounts: [pyth, vault],
    });

    expect(lendingPoolSetOraclePrice).toHaveBeenCalledWith(expect.anything(), 25);
    expect(remainingAccounts).toHaveBeenCalledWith([
      { pubkey: pyth, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: false },
    ]);

    await expect(
      setOraclePriceIx({
        program,
        bankAddress: bank,
        price: new BigNumber(0.8),
        setup: OracleSetup.PTFixed,
        oracleAccounts: [],
      })
    ).rejects.toThrow("PTFixed requires 1 ordered oracle accounts");
  });
});
