import {
  address,
  blockhash,
  createNoopSigner,
  getAddressDecoder,
  getU64Decoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { MAX_ACCOUNT_LOCKS, MAX_BALANCES, WSOL_MINT } from "~/constants";
import { TransactionBuildingErrorCode } from "~/errors";
import {
  BalanceType,
  createEmptyBalance,
  makeBulkRepayTx,
  makeBulkWithdrawTx,
  makeWithdrawIx,
  MarginfiAccountType,
} from "~/services/account";
import { AssetTag, BankType, OracleSetup } from "~/services/bank";
import { getTotalAccountKeys, TransactionFormat, TransactionType } from "~/services/transaction";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const systemProgram = address("11111111111111111111111111111111");
const latestBlockhash = {
  blockhash: blockhash("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"),
  lastValidBlockHeight: 1n,
};
const rpc = {
  getLatestBlockhash: () => ({ send: async () => ({ value: latestBlockhash }) }),
  // Every ATA already exists
  getMultipleAccounts: (addresses: Address[]) => ({
    send: async () => ({ value: addresses.map(() => ({ data: ["", "base64"] })) }),
  }),
};

let addressCount = 0;
const uniqueAddress = (): Address => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, ++addressCount);
  return getAddressDecoder().decode(bytes);
};

function bank(mint: Address = uniqueAddress()): BankType {
  const oracle = uniqueAddress();
  return {
    address: uniqueAddress(),
    mint,
    mintDecimals: 9,
    assetShareValue: new BigNumber(1),
    liabilityShareValue: new BigNumber(1),
    group: uniqueAddress(),
    liquidityVault: uniqueAddress(),
    oracleKey: oracle,
    premiumActive: false,
    config: {
      oracleSetup: OracleSetup.PythPushOracle,
      assetTag: AssetTag.DEFAULT,
      oracleKeys: [oracle],
    },
  } as unknown as BankType;
}

function balance(b: BankType, side: "asset" | "liability", shares = 2e9): BalanceType {
  return {
    ...createEmptyBalance(b.address),
    active: true,
    assetShares: new BigNumber(side === "asset" ? shares : 0),
    liabilityShares: new BigNumber(side === "liability" ? shares : 0),
  };
}

function account(active: BalanceType[]): MarginfiAccountType {
  return {
    address: uniqueAddress(),
    group: uniqueAddress(),
    authority: uniqueAddress(),
    balances: [
      ...active,
      ...Array.from({ length: 16 - active.length }, () => createEmptyBalance(systemProgram)),
    ],
    accountFlags: [],
  } as unknown as MarginfiAccountType;
}

const sol = bank(WSOL_MINT);
const usdc = bank();
const positions = Array.from({ length: MAX_BALANCES }, () => bank());
const bankMap = new Map([sol, usdc, ...positions].map((b) => [b.address, b]));

function bulkRepay(marginfiAccount: MarginfiAccountType, targets: Address[]) {
  return makeBulkRepayTx({
    programAddress,
    authority: createNoopSigner(marginfiAccount.authority),
    rpc: rpc as never,
    marginfiAccount,
    bankAddresses: targets,
    bankMap,
    bankMetadataMap: {},
    tokenProgramsByBank: new Map(targets.map((b) => [b, tokenProgram])),
    txFormat: { version: 0, luts: {} },
  });
}

function bulkWithdraw(
  marginfiAccount: MarginfiAccountType,
  targets: Address[],
  opts: { groupRateLimiterEnabled?: boolean; txFormat?: TransactionFormat } = {}
) {
  return makeBulkWithdrawTx({
    programAddress,
    authority: createNoopSigner(marginfiAccount.authority),
    rpc: rpc as never,
    marginfiAccount,
    bankAddresses: targets,
    bankMap,
    bankMetadataMap: {},
    tokenProgramsByBank: new Map(targets.map((b) => [b, tokenProgram])),
    txFormat: opts.txFormat ?? { version: 0, luts: {} },
    groupRateLimiterEnabled: opts.groupRateLimiterEnabled,
  });
}

const ixs = (txs: { message: { instructions: readonly Instruction[] } }[]) =>
  txs.flatMap((tx) => tx.message.instructions);

describe("makeBulkRepayTx", () => {
  it("wraps a little over a SOL debt and closes the wSOL account after the repays", async () => {
    const { transactions } = await bulkRepay(account([balance(sol, "liability")]), [sol.address]);
    const all = ixs(transactions);

    const transfer = all.find((ix) => ix.programAddress === systemProgram);
    const lamports = getU64Decoder().decode(transfer?.data ?? new Uint8Array(12), 4);
    // 2 SOL debt + 0.1%, plus the fixed 10_000 lamports every wrap adds
    expect(lamports).toBe(2_002_000_000n + 10_000n);

    const last = all[all.length - 1];
    expect(last.programAddress).toBe(tokenProgram);
    expect(last.data?.[0]).toBe(9); // CloseAccount
  });

  it("rejects a repeated bank or one without debt", async () => {
    const marginfiAccount = account([balance(sol, "liability"), balance(usdc, "asset")]);
    await expect(bulkRepay(marginfiAccount, [sol.address, sol.address])).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.BULK_INVALID_SELECTION,
    });
    await expect(bulkRepay(marginfiAccount, [usdc.address])).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.BULK_INVALID_SELECTION,
      details: { bankAddresses: [usdc.address] },
    });
  });
});

describe("makeBulkWithdrawTx", () => {
  it("drops the closed bank's rate-limiter accounts when the limiter is off", async () => {
    const marginfiAccount = account([balance(usdc, "asset")]);
    const keyCount = async (enabled?: boolean) =>
      ixs(
        (await bulkWithdraw(marginfiAccount, [usdc.address], { groupRateLimiterEnabled: enabled }))
          .transactions
      ).reduce((n, ix) => n + (ix.accounts?.length ?? 0), 0);
    expect(await keyCount(false)).toBeLessThan(await keyCount());
  });

  it("leaves room for the send pipeline's locks in every transaction", async () => {
    const marginfiAccount = account(positions.map((b) => balance(b, "asset")));
    const targets = positions.map((b) => b.address);
    // With every account in a lookup table, locks bind before bytes do
    const withdrawIxs = await Promise.all(
      positions.map((bank) =>
        makeWithdrawIx({
          programAddress,
          bank,
          bankMap,
          tokenProgram,
          amount: 0,
          marginfiAccount,
          authority: createNoopSigner(marginfiAccount.authority),
          withdrawAll: true,
        })
      )
    );
    const keys = withdrawIxs
      .flat()
      .flatMap((ix) => (ix.accounts ?? []).map((meta) => meta.address));
    const txFormat = { version: 0 as const, luts: { [uniqueAddress()]: [...new Set(keys)] } };
    const { transactions } = await bulkWithdraw(marginfiAccount, targets, { txFormat });
    const withdrawTxs = transactions.filter((tx) => tx.type === TransactionType.WITHDRAW);
    expect(withdrawTxs.length).toBeGreaterThan(1);
    for (const tx of withdrawTxs) {
      expect(getTotalAccountKeys(tx.message)).toBeLessThanOrEqual(MAX_ACCOUNT_LOCKS - 3);
    }
  });
});
