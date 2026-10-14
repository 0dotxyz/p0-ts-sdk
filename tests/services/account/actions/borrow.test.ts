import { address, createNoopSigner, type Address, type Instruction } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { addr, LATEST_BLOCKHASH } from "../../../helpers/addresses";
import { makeAccount, makeBalance, makeBank } from "../../../helpers/factories";

import { TransactionBuildingErrorCode } from "~/errors";
import { makeBorrowIx, makeBorrowTx } from "~/services/account";
import { AssetTag, BankType, OracleSetup } from "~/services/bank";
import type { BankIntegrationMetadataMap } from "~/types";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const reserve = addr();
const obligation = addr();
const kamino = makeBank({
  kaminoIntegrationAccounts: { kaminoReserve: reserve, kaminoObligation: obligation },
  config: {
    oracleSetup: OracleSetup.KaminoPythPush,
    assetTag: AssetTag.KAMINO,
    oracleKeys: [addr(), reserve],
  },
});
const collateral = makeBank();
const debt = makeBank();
const bankMap = new Map<string, BankType>([kamino, collateral, debt].map((b) => [b.address, b]));
const bankMetadataMap = {
  [kamino.address]: { kaminoStates: { reserveState: { lendingMarket: addr() } } },
} as unknown as BankIntegrationMetadataMap;

const marginfiAccount = makeAccount([makeBalance(collateral, "asset", 1_000e6)]);

const borrow = (activeBanks?: Address[]) =>
  makeBorrowTx({
    programAddress,
    bank: debt,
    bankMap,
    tokenProgram,
    amount: 10,
    marginfiAccount,
    authority: createNoopSigner(marginfiAccount.authority),
    rpc: {} as never,
    txFormat: { version: 0, luts: {} },
    latestBlockhash: LATEST_BLOCKHASH,
    bankMetadataMap,
    opts: { activeBanks },
  });

// The borrow ix lists the reserve as a Kamino oracle key; only klend ixs come from another program
const touchesOutsideMarginfi = (ixs: readonly Instruction[], key: Address) =>
  ixs.some(
    (ix) =>
      ix.programAddress !== programAddress &&
      (ix.accounts ?? []).some((meta) => meta.address === key)
  );

describe("makeBorrowTx", () => {
  it("refreshes a Kamino bank that opts.activeBanks adds", async () => {
    const tx = await borrow([collateral.address, kamino.address]);
    expect(touchesOutsideMarginfi(tx.message.instructions, reserve)).toBe(true);
    expect(touchesOutsideMarginfi(tx.message.instructions, obligation)).toBe(true);
  });

  it("refreshes nothing for an account without integration banks", async () => {
    const tx = await borrow();
    expect(touchesOutsideMarginfi(tx.message.instructions, reserve)).toBe(false);
  });
});

describe("makeBorrowIx", () => {
  it("throws BANK_NOT_FOUND when bankMap misses an active bank", async () => {
    await expect(
      makeBorrowIx({
        programAddress,
        bank: debt,
        bankMap: new Map([[debt.address, debt]]),
        tokenProgram,
        amount: 10,
        marginfiAccount,
        authority: createNoopSigner(marginfiAccount.authority),
      })
    ).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.BANK_NOT_FOUND,
      details: { bankAddress: collateral.address },
    });
  });
});
