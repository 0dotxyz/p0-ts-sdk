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
  makeWithdrawIx,
  makeWithdrawTx,
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
const bankMap = new Map<string, BankType>([kamino, collateral].map((b) => [b.address, b]));
const bankMetadataMap = {
  [kamino.address]: {
    kaminoStates: {
      reserveState: {
        lendingMarket: uniqueAddress(),
        farmCollateral: DEFAULT_ADDRESS,
        liquidity: { supplyVault: uniqueAddress() },
        collateral: { mintPubkey: uniqueAddress(), supplyVault: uniqueAddress() },
      },
    },
  },
} as unknown as BankIntegrationMetadataMap;

const asset = (b: BankType): BalanceType => ({
  ...createEmptyBalance(b.address),
  active: true,
  assetShares: new BigNumber(1_000e6),
});
const account = (balances: BalanceType[]) =>
  ({
    address: uniqueAddress(),
    group: uniqueAddress(),
    authority: uniqueAddress(),
    balances: [
      ...balances,
      ...Array.from({ length: 16 - balances.length }, () => createEmptyBalance(DEFAULT_ADDRESS)),
    ],
    accountFlags: [],
  }) as unknown as MarginfiAccountType;

const withdrawIx = (
  target: BankType,
  marginfiAccount: MarginfiAccountType,
  overrides: Partial<Parameters<typeof makeWithdrawIx>[0]> = {}
) =>
  makeWithdrawIx({
    programAddress,
    bank: target,
    bankMap,
    tokenProgram,
    amount: 10,
    marginfiAccount,
    authority: createNoopSigner(marginfiAccount.authority),
    bankMetadataMap,
    ...overrides,
  });

// The withdraw ix lists the reserve as a Kamino oracle key; only klend ixs come from another program
const touchesOutsideMarginfi = (ixs: readonly Instruction[], key: Address) =>
  ixs.some(
    (ix) =>
      ix.programAddress !== programAddress &&
      (ix.accounts ?? []).some((meta) => meta.address === key)
  );

describe("makeWithdrawTx", () => {
  it("refreshes a Kamino bank that opts.activeBanks adds", async () => {
    const marginfiAccount = account([asset(collateral)]);
    const tx = await makeWithdrawTx({
      programAddress,
      bank: collateral,
      bankMap,
      tokenProgram,
      amount: 10,
      marginfiAccount,
      authority: createNoopSigner(marginfiAccount.authority),
      rpc: {} as never,
      txFormat: { version: 0, luts: {} },
      latestBlockhash,
      bankMetadataMap,
      opts: { activeBanks: [collateral.address, kamino.address] },
    });
    expect(touchesOutsideMarginfi(tx.message.instructions, reserve)).toBe(true);
    expect(touchesOutsideMarginfi(tx.message.instructions, obligation)).toBe(true);
  });
});

describe("makeWithdrawIx", () => {
  it("needs the Kamino multiplier for a partial UI withdraw, not for a withdraw-all", async () => {
    const marginfiAccount = account([asset(kamino)]);
    await expect(withdrawIx(kamino, marginfiAccount)).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.INVALID_AMOUNT,
    });
    await expect(withdrawIx(kamino, marginfiAccount, { withdrawAll: true })).resolves.toBeDefined();
  });

  it("rejects a cToken amount on a non-Kamino bank", async () => {
    await expect(
      withdrawIx(collateral, account([asset(collateral)]), {
        amount: { value: 10, type: "cToken" },
      })
    ).rejects.toMatchObject({ code: TransactionBuildingErrorCode.INVALID_AMOUNT });
  });
});
