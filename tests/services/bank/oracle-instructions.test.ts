import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import instructions from "~/instructions";
import { configureScopeOracleIx } from "~/services/bank";
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
    const accountsPartial = vi.fn().mockReturnValue({ instruction });
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
    expect(wrapper).toEqual({ instructions: [expectedIx], keys: [] });
  });

  it("keeps the low-level async builder available", () => {
    expect(instructions.makeLendingPoolConfigureBankOracleScopeIx).toBeTypeOf("function");
  });
});
