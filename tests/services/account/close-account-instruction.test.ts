import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import instructions from "~/instructions";
import syncInstructions from "~/sync-instructions";
import type { MarginfiProgram } from "~/types";
import { deriveRebalanceFeePool } from "~/utils";

const publicKey = (fill: number) => new PublicKey(new Uint8Array(32).fill(fill));

describe("marginfi account close instruction", () => {
  it("passes the rebalance fee pool PDA, matching the Anchor builder", async () => {
    const programId = new PublicKey(MARGINFI_IDL.address);
    const marginfiAccount = publicKey(2);
    const authority = publicKey(3);
    const feePayer = publicKey(4);
    const program = new Program<MarginfiIdlType>(
      MARGINFI_IDL,
      new AnchorProvider(new Connection("http://127.0.0.1:1"), {} as Wallet, {})
    ) as unknown as MarginfiProgram;

    const anchorIx = await instructions.makeCloseAccountIx(program, {
      marginfiAccount,
      feePayer,
      authority,
    });
    const syncIx = syncInstructions.makeCloseAccountIx(programId, {
      marginfiAccount,
      authority,
      feePayer,
    });

    expect(syncIx.keys).toEqual(anchorIx.keys);
    expect(syncIx.data).toEqual(anchorIx.data);
    expect(syncIx.keys[3].pubkey.equals(deriveRebalanceFeePool(programId, marginfiAccount)[0])).toBe(
      true
    );
  });
});
