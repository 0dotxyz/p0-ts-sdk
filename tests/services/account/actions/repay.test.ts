import {
  address,
  createNoopSigner,
  unwrapOption,
  type Address,
  type Instruction,
} from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addr, key, LATEST_BLOCKHASH } from "../../../helpers/addresses";
import { makeAccount, makeBalance, makeBank } from "../../../helpers/factories";
import { findMarginfiIxs, isMarginfiIx } from "../../../helpers/ix";
import { mainnetAccount, mainnetBanks } from "../../../helpers/mainnet";
import { depositParams, toWire, v283Cases } from "../../../helpers/parity";
import { fakeRpc, stubRpcFetch, stubbedRpc } from "../../../helpers/rpc";

import instructions, { MarginfiInstruction } from "~/instructions";
import { makeRepayIx, makeRepayTx, makeRepayWithCollatTx } from "~/services/account/actions/repay";
import { SwapProvider, type MarginfiAccountType } from "~/services/account/types";
import { AssetTag, BankType } from "~/services/bank";
import { SolanaTransaction, TransactionFormat } from "~/services/transaction";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const swapProgram = address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

// The account's SOL debt is repaid from a deposit in a copy of the SOL bank
const copyOfSol = (fill: number, mint: BankType["mint"]): BankType => ({
  ...mainnetBanks.sol,
  address: key(fill),
  mint,
});
const solCollateralBank = copyOfSol(7, mainnetBanks.sol.mint);
const usdcCollateralBank = {
  ...copyOfSol(8, key(9)),
  mintDecimals: 6,
};
const bankMap = new Map(
  [...Object.values(mainnetBanks), solCollateralBank, usdcCollateralBank].map((bank) => [
    bank.address,
    bank,
  ])
);

function withDepositIn(bank: BankType): MarginfiAccountType {
  const account = mainnetAccount(bankMap);
  const firstFree = account.balances.findIndex((balance) => !balance.active);
  return {
    ...account,
    balances: account.balances.map((balance, index) =>
      index === firstFree
        ? {
            ...balance,
            active: true,
            bankPk: bank.address,
            assetShares: new BigNumber(10e9),
            liabilityShares: new BigNumber(0),
          }
        : balance
    ),
  };
}

// 0.123456789123 SOL: whole native units round it down to 0.123456789 and up to 0.12345679
const DEBT = 0.123456789123;

function repayWithCollat(opts: {
  withdrawBank: BankType;
  withdrawAmount: number;
  quote?: { outAmount: string; otherAmountThreshold: string };
}) {
  const {
    withdrawBank,
    withdrawAmount,
    quote = { outAmount: "0", otherAmountThreshold: "0" },
  } = opts;
  const marginfiAccount = withDepositIn(withdrawBank);
  return makeRepayWithCollatTx({
    programAddress,
    marginfiAccount,
    authority: createNoopSigner(marginfiAccount.authority),
    rpc: stubbedRpc,
    bankMap,
    bankMetadataMap: {},
    assetShareValueMultiplierByBank: new Map(),
    withdrawOpts: { withdrawBank, tokenProgram, withdrawAmount, totalPositionAmount: 10 },
    repayOpts: { repayBank: mainnetBanks.sol, tokenProgram, totalPositionAmount: DEBT },
    swapOpts: {},
    txFormat: { version: 0, luts: {} },
    swapEngineRunner: async () => ({
      swapInstructions: [{ programAddress: swapProgram, accounts: [], data: new Uint8Array([1]) }],
      setupInstructions: [],
      swapLuts: {},
      quoteResponse: { inAmount: "1", slippageBps: 50, ...quote },
      outputAmountNative: BigInt(quote.otherAmountThreshold),
      provider: SwapProvider.JUPITER,
    }),
  });
}

function repayIxOf(result: Awaited<ReturnType<typeof makeRepayWithCollatTx>>) {
  const [repay] = findMarginfiIxs(MarginfiInstruction.LendingAccountRepay, ...result.transactions);
  return { repayAll: unwrapOption(repay.data.repayAll), amount: repay.data.amount };
}

const premiumBank = (overrides: Parameters<typeof makeBank>[0] = {}) =>
  makeBank({ premiumTag: 1, premiumActive: true, ...overrides });
const asset = (bank: BankType) => makeBalance(bank, "asset", 1_000e6);
const debt = (bank: BankType) => makeBalance(bank, "liability", 100e6);

const sol = premiumBank();
const usdc = premiumBank();
const usdt = premiumBank();
const kamino = premiumBank({ config: { assetTag: AssetTag.KAMINO } });
const usdcCollateral = premiumBank({ mint: usdc.mint });
const premiumBankMap = new Map<string, BankType>(
  [sol, usdc, usdt, kamino, usdcCollateral].map((b) => [b.address, b])
);
const rpc = fakeRpc({ accountsExist: true });
const noLuts: TransactionFormat = { version: 0, luts: {} };

const ixsOf = (tx: SolanaTransaction | undefined): readonly Instruction[] =>
  tx?.message.instructions ?? [];
const lastIx = (tx: SolanaTransaction): Instruction => ixsOf(tx)[ixsOf(tx).length - 1];
const keys = (ix: Instruction) => (ix.accounts ?? []).map((meta) => meta.address);
const isClose = isMarginfiIx(MarginfiInstruction.MarginfiAccountCloseOrder);
const isPulse = isMarginfiIx(MarginfiInstruction.LendingAccountPulseHealth);
const hasPulse = (tx: SolanaTransaction) => ixsOf(tx).some(isPulse);

const orders = (count: number) => Array.from({ length: count }, addr);

// Another program's instruction, so the flashloan projection skips it
const foreignIx = (): Instruction => ({
  programAddress: addr(),
  accounts: [],
  data: new Uint8Array(8),
});

function repayTx(
  marginfiAccount: MarginfiAccountType,
  target: BankType,
  opts: { amount: number; repayAll?: boolean; ordersToClose?: Address[] }
) {
  return makeRepayTx({
    programAddress,
    bank: target,
    tokenProgram,
    amount: opts.amount,
    marginfiAccount,
    authority: createNoopSigner(marginfiAccount.authority),
    repayAll: opts.repayAll,
    rpc,
    txFormat: noLuts,
    latestBlockhash: LATEST_BLOCKHASH,
    bankMap: premiumBankMap,
    bankMetadataMap: {},
    ordersToClose: opts.ordersToClose,
  });
}

describe("makeRepayTx", () => {
  it("closes the orders in front of the repay", async () => {
    const borrower = makeAccount([asset(sol), debt(usdc)]);
    const tx = await repayTx(borrower, usdc, { amount: 5, ordersToClose: orders(1) });

    expect(isClose(ixsOf(tx)[0])).toBe(true);
  });

  it("adds pulse_health while premium-bearing debt remains, without a fully repaid bank", async () => {
    const twoDebts = makeAccount([asset(sol), debt(usdc), debt(usdt)]);
    const pulse = lastIx(await repayTx(twoDebts, usdc, { amount: 100, repayAll: true }));

    expect(isPulse(pulse)).toBe(true);
    expect(keys(pulse)).toContain(usdt.address);
    expect(keys(pulse)).not.toContain(usdc.address);
  });

  it("adds the pulse after a partial repay of the only premium debt, but not after repaying it in full", async () => {
    const borrower = makeAccount([asset(sol), debt(usdc)]);
    expect(isPulse(lastIx(await repayTx(borrower, usdc, { amount: 100, repayAll: false })))).toBe(
      true
    );
    expect(hasPulse(await repayTx(borrower, usdc, { amount: 100, repayAll: true }))).toBe(false);
  });

  it("drops the pulse instead of throwing when a held bank has no venue state", async () => {
    const kaminoCollateral = makeAccount([asset(kamino), debt(usdc)]);
    const tx = await repayTx(kaminoCollateral, usdc, { amount: 100, repayAll: false });

    expect(hasPulse(tx)).toBe(false);
  });
});

describe("makeRepayIx", () => {
  it("matches the v2.8.3 instructions for a SOL repay-all", async () => {
    const ixs = await makeRepayIx({
      ...depositParams,
      bank: mainnetBanks.sol,
      amount: 0.75,
      repayAll: true,
    });
    expect(toWire(ixs)).toEqual(v283Cases.repaySolAll);
  });
});

describe("makeRepayWithCollatTx", () => {
  beforeEach(stubRpcFetch);

  it("repays all of the debt when the withdrawal covers it in whole native units", async () => {
    const result = await repayWithCollat({
      withdrawBank: solCollateralBank,
      withdrawAmount: 0.12345679,
    });
    expect(repayIxOf(result).repayAll).toBe(true);
  });

  it("doesn't repay all when the withdrawal is the debt rounded down", async () => {
    const result = await repayWithCollat({
      withdrawBank: solCollateralBank,
      withdrawAmount: 0.123456789,
    });
    expect(repayIxOf(result).repayAll).toBe(false);
  });

  it("repays all of the debt when the quoted output exceeds it", async () => {
    const result = await repayWithCollat({
      withdrawBank: usdcCollateralBank,
      withdrawAmount: 20,
      quote: { outAmount: "124000000", otherAmountThreshold: "123400000" },
    });
    expect(repayIxOf(result).repayAll).toBe(true);
  });

  it("repays the minimum output, not all, when the quote falls short of the debt", async () => {
    const result = await repayWithCollat({
      withdrawBank: usdcCollateralBank,
      withdrawAmount: 20,
      quote: { outAmount: "123456789", otherAmountThreshold: "123456789" },
    });
    const repay = repayIxOf(result);
    expect(repay.repayAll).toBe(false);
    expect(repay.amount).toBe(123_456_789n);
  });

  it("closes the orders in a transaction after the flashloan, as one bundle", async () => {
    vi.spyOn(instructions, "makeWithdrawIx").mockImplementation(async () => foreignIx());
    vi.spyOn(instructions, "makeRepayIx").mockImplementation(async () => foreignIx());
    const collateralized = makeAccount([asset(usdcCollateral), debt(usdc)]);
    const repayWithCollateral = (ordersToClose?: Address[]) =>
      makeRepayWithCollatTx({
        programAddress,
        marginfiAccount: collateralized,
        authority: createNoopSigner(collateralized.authority),
        rpc,
        bankMap: premiumBankMap,
        bankMetadataMap: {},
        assetShareValueMultiplierByBank: new Map(),
        swapOpts: {},
        txFormat: noLuts,
        withdrawOpts: {
          totalPositionAmount: 1_000,
          withdrawAmount: 10,
          withdrawBank: usdcCollateral,
          tokenProgram,
        },
        repayOpts: { repayBank: usdc, tokenProgram, totalPositionAmount: 100 },
        ordersToClose,
      });

    const plain = await repayWithCollateral();
    expect(plain.transactions).toHaveLength(1);
    expect(plain.mustBeAtomicBundle).toBe(false);

    const toClose = orders(2);
    const withCloses = await repayWithCollateral(toClose);
    const [flashloanTx, ordersTx] = withCloses.transactions;
    expect(withCloses.transactions).toHaveLength(2);
    expect(withCloses.mustBeAtomicBundle).toBe(true);
    expect(ixsOf(flashloanTx).some(isClose)).toBe(false);
    expect(ixsOf(ordersTx).every(isClose)).toBe(true);
    expect(ixsOf(ordersTx)).toHaveLength(toClose.length);
  });
});
