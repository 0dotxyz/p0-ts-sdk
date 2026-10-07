import {
  address,
  blockhash,
  createNoopSigner,
  getAddressDecoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { TransactionBuildingErrorCode } from "~/errors";
import {
  BalanceType,
  createEmptyBalance,
  makeBorrowIx,
  makeBorrowTx,
  MarginfiAccountType,
} from "~/services/account";
import { AssetTag, BankType, OracleSetup } from "~/services/bank";
import type { BankIntegrationMetadataMap } from "~/types";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const DEFAULT_ADDRESS = address("11111111111111111111111111111111");
const latestBlockhash = {
  blockhash: blockhash("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"),
  lastValidBlockHeight: 1n,
};

let addressCount = 0;
const uniqueAddress = (): Address => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, ++addressCount);
  return getAddressDecoder().decode(bytes);
};

function bank(): BankType {
  const oracle = uniqueAddress();
  return {
    address: uniqueAddress(),
    mint: uniqueAddress(),
    mintDecimals: 6,
    group: uniqueAddress(),
    liquidityVault: uniqueAddress(),
    oracleKey: oracle,
    config: {
      oracleSetup: OracleSetup.PythPushOracle,
      assetTag: AssetTag.DEFAULT,
      oracleKeys: [oracle],
    },
  } as unknown as BankType;
}

const reserve = uniqueAddress();
const obligation = uniqueAddress();
const kamino = {
  ...bank(),
  kaminoIntegrationAccounts: { kaminoReserve: reserve, kaminoObligation: obligation },
  config: {
    oracleSetup: OracleSetup.KaminoPythPush,
    assetTag: AssetTag.KAMINO,
    oracleKeys: [uniqueAddress(), reserve],
  },
} as unknown as BankType;
const collateral = bank();
const debt = bank();
const bankMap = new Map<string, BankType>([kamino, collateral, debt].map((b) => [b.address, b]));
const bankMetadataMap = {
  [kamino.address]: { kaminoStates: { reserveState: { lendingMarket: uniqueAddress() } } },
} as unknown as BankIntegrationMetadataMap;

const deposit: BalanceType = {
  ...createEmptyBalance(collateral.address),
  active: true,
  assetShares: new BigNumber(1_000e6),
};
const marginfiAccount = {
  address: uniqueAddress(),
  group: uniqueAddress(),
  authority: uniqueAddress(),
  balances: [deposit, ...Array.from({ length: 15 }, () => createEmptyBalance(DEFAULT_ADDRESS))],
  accountFlags: [],
} as unknown as MarginfiAccountType;

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
    latestBlockhash,
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
