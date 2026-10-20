import {
  AccountRole,
  address,
  createNoopSigner,
  getU64Decoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";

import { addr } from "../../../helpers/addresses";
import { makeAccount, makeBalance, makeBank } from "../../../helpers/factories";
import { isMarginfiIx } from "../../../helpers/ix";
import { fakeRpc } from "../../../helpers/rpc";

import { MAX_ACCOUNT_LOCKS, MAX_BALANCES, WSOL_MINT } from "~/constants";
import { TransactionBuildingErrorCode } from "~/errors";
import instructions, { MarginfiInstruction } from "~/instructions";
import {
  makeBulkRepayTx,
  makeBulkWithdrawTx,
  makeWithdrawIx,
  MarginfiAccountType,
} from "~/services/account";
import { BankType } from "~/services/bank";
import {
  getTotalAccountKeys,
  SolanaTransaction,
  TransactionFormat,
  TransactionType,
} from "~/services/transaction";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const systemProgram = address("11111111111111111111111111111111");
const rpc = fakeRpc({ accountsExist: true });

const bank = (mint: Address = addr()) => makeBank({ mint, mintDecimals: 9 });
const balance = (b: BankType, side: "asset" | "liability", shares = 2e9) =>
  makeBalance(b, side, shares);

const sol = bank(WSOL_MINT);
const usdc = bank();
const positions = Array.from({ length: MAX_BALANCES }, () => bank());
const bankMap = new Map([sol, usdc, ...positions].map((b) => [b.address, b]));

function bulkRepay(marginfiAccount: MarginfiAccountType, targets: Address[]) {
  return makeBulkRepayTx({
    programAddress,
    authority: createNoopSigner(marginfiAccount.authority),
    rpc,
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
    rpc,
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

const premiumBank = (overrides: Parameters<typeof makeBank>[0] = {}) =>
  makeBank({ premiumTag: 1, premiumActive: true, ...overrides });
const premiumCollateral = premiumBank();
const premiumUsdc = premiumBank();
const premiumUsdt = premiumBank();
const inactiveUsdc = premiumBank({ premiumActive: false });
const premiumBankMap = new Map<string, BankType>(
  [premiumCollateral, premiumUsdc, premiumUsdt, inactiveUsdc].map((b) => [b.address, b])
);
// 1_000 of premium-bearing collateral against 100 of each debt
const premiumAccount = (debts: BankType[]) =>
  makeAccount([
    makeBalance(premiumCollateral, "asset", 1_000e6),
    ...debts.map((b) => makeBalance(b, "liability", 100e6)),
  ]);

function premiumBulkRepay(
  marginfiAccount: MarginfiAccountType,
  targets: BankType[],
  opts: { ordersToClose?: Address[]; skipPremiumRefresh?: boolean } = {}
) {
  return makeBulkRepayTx({
    programAddress,
    authority: createNoopSigner(marginfiAccount.authority),
    rpc,
    marginfiAccount,
    bankAddresses: targets.map((b) => b.address),
    bankMap: premiumBankMap,
    bankMetadataMap: {},
    tokenProgramsByBank: new Map(targets.map((b) => [b.address, tokenProgram])),
    txFormat: { version: 0, luts: {} },
    ...opts,
  });
}

const ixsOf = (tx: SolanaTransaction): readonly Instruction[] => tx.message.instructions;
const lastIx = (tx: SolanaTransaction): Instruction => ixsOf(tx)[ixsOf(tx).length - 1];
const keys = (ix: Instruction) => (ix.accounts ?? []).map((meta) => meta.address);
const isClose = isMarginfiIx(MarginfiInstruction.MarginfiAccountCloseOrder);
const isPulse = isMarginfiIx(MarginfiInstruction.LendingAccountPulseHealth);
const hasPulse = (tx: SolanaTransaction) => ixsOf(tx).some(isPulse);

const orders = (count: number) => Array.from({ length: count }, addr);

// Another program's instruction, so the flashloan projection skips it
const foreignIx = (keyCount = 0): Instruction => ({
  programAddress: addr(),
  accounts: Array.from({ length: keyCount }, () => ({
    address: addr(),
    role: AccountRole.WRITABLE,
  })),
  data: new Uint8Array(8),
});

describe("makeBulkRepayTx", () => {
  it("wraps a little over a SOL debt and closes the wSOL account after the repays", async () => {
    const { transactions } = await bulkRepay(makeAccount([balance(sol, "liability")]), [
      sol.address,
    ]);
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
    const marginfiAccount = makeAccount([balance(sol, "liability"), balance(usdc, "asset")]);
    await expect(bulkRepay(marginfiAccount, [sol.address, sol.address])).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.BULK_INVALID_SELECTION,
    });
    await expect(bulkRepay(marginfiAccount, [usdc.address])).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.BULK_INVALID_SELECTION,
      details: { bankAddresses: [usdc.address] },
    });
  });

  it("packs the closes in front of the repays, bundling a batch that splits", async () => {
    const twoDebts = premiumAccount([premiumUsdc, premiumUsdt]);
    const targets = [premiumUsdc, premiumUsdt];

    vi.spyOn(instructions, "makeRepayIx").mockImplementation(async () => foreignIx());
    const single = await premiumBulkRepay(twoDebts, targets, { ordersToClose: orders(1) });
    expect(single.transactions).toHaveLength(1);
    expect(single.mustBeAtomicBundle).toBe(false);
    expect(isClose(ixsOf(single.transactions[0])[0])).toBe(true);

    vi.spyOn(instructions, "makeRepayIx").mockImplementation(async () => foreignIx(16));
    const split = await premiumBulkRepay(twoDebts, targets, { ordersToClose: orders(1) });
    expect(split.transactions.length).toBeGreaterThan(1);
    expect(split.mustBeAtomicBundle).toBe(true);
    expect(
      (await premiumBulkRepay(twoDebts, targets, { ordersToClose: orders(0) })).mustBeAtomicBundle
    ).toBe(false);
  });

  it("adds one pulse after all repays, unless skipped", async () => {
    const twoDebts = premiumAccount([premiumUsdc, premiumUsdt]);

    const { transactions, mustBeAtomicBundle } = await premiumBulkRepay(twoDebts, [premiumUsdc]);
    expect(transactions).toHaveLength(1);
    expect(mustBeAtomicBundle).toBe(false);
    const last = lastIx(transactions[transactions.length - 1]);
    expect(isPulse(last)).toBe(true);
    expect(keys(last)).not.toContain(premiumUsdc.address);

    const skipped = await premiumBulkRepay(twoDebts, [premiumUsdc], { skipPremiumRefresh: true });
    expect(skipped.transactions.some(hasPulse)).toBe(false);
  });

  it("bundles a batch that splits with the premium refresh in it", async () => {
    vi.spyOn(instructions, "makeRepayIx").mockImplementation(async () => ({
      programAddress,
      accounts: Array.from({ length: 16 }, () => ({
        address: addr(),
        role: AccountRole.WRITABLE,
      })),
      data: new Uint8Array(8),
    }));
    const threeDebts = premiumAccount([premiumUsdc, inactiveUsdc, premiumUsdt]);

    const split = await premiumBulkRepay(threeDebts, [premiumUsdc, inactiveUsdc]);
    expect(split.transactions.length).toBeGreaterThan(1);
    expect(split.mustBeAtomicBundle).toBe(true);

    const skipped = await premiumBulkRepay(threeDebts, [premiumUsdc, inactiveUsdc], {
      skipPremiumRefresh: true,
    });
    expect(skipped.transactions.length).toBeGreaterThan(1);
    expect(skipped.mustBeAtomicBundle).toBe(false);
  });
});

describe("makeBulkWithdrawTx", () => {
  it("drops the closed bank's rate-limiter accounts when the limiter is off", async () => {
    const marginfiAccount = makeAccount([balance(usdc, "asset")]);
    const keyCount = async (enabled?: boolean) =>
      ixs(
        (await bulkWithdraw(marginfiAccount, [usdc.address], { groupRateLimiterEnabled: enabled }))
          .transactions
      ).reduce((n, ix) => n + (ix.accounts?.length ?? 0), 0);
    expect(await keyCount(false)).toBeLessThan(await keyCount());
  });

  it("leaves room for the send pipeline's locks in every transaction", async () => {
    const marginfiAccount = makeAccount(positions.map((b) => balance(b, "asset")));
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
    const txFormat = { version: 0 as const, luts: { [addr()]: [...new Set(keys)] } };
    const { transactions } = await bulkWithdraw(marginfiAccount, targets, { txFormat });
    const withdrawTxs = transactions.filter((tx) => tx.type === TransactionType.WITHDRAW);
    expect(withdrawTxs.length).toBeGreaterThan(1);
    for (const tx of withdrawTxs) {
      expect(getTotalAccountKeys(tx.message)).toBeLessThanOrEqual(MAX_ACCOUNT_LOCKS - 3);
    }
  });
});
