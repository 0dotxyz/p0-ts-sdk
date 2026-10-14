import {
  AccountRole,
  address,
  blockhash,
  createNoopSigner,
  getAddressDecoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TransactionBuildingError, TransactionBuildingErrorCode } from "~/errors";
import instructions from "~/instructions";
import {
  BalanceType,
  createEmptyBalance,
  HealthCacheStatus,
  makeBorrowTx,
  makeBulkRepayTx,
  makeDepositTx,
  makeOrderChangesTx,
  makeRepayTx,
  makeRepayWithCollatTx,
  MarginfiAccountType,
} from "~/services/account";
import { AssetTag, BankType, OracleSetup } from "~/services/bank";
import { SolanaTransaction, TransactionFormat, TransactionType } from "~/services/transaction";
import { deriveOrderPda } from "~/utils";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const DEFAULT_ADDRESS = address("11111111111111111111111111111111");
const latestBlockhash = {
  blockhash: blockhash("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"),
  lastValidBlockHeight: 1n,
};
const rpc = {
  getLatestBlockhash: () => ({ send: async () => ({ value: latestBlockhash }) }),
  // Every ATA exists, so no setup transactions
  getMultipleAccounts: (keys: Address[]) => ({
    send: async () => ({ value: keys.map(() => ({})) }),
  }),
};
const noLuts: TransactionFormat = { version: 0, luts: {} };

const CLOSE_ORDER_DISCRIMINATOR = [212, 223, 79, 182, 172, 183, 205, 237];
const PLACE_ORDER_DISCRIMINATOR = [244, 112, 75, 138, 143, 108, 7, 186];
const PULSE_DISCRIMINATOR = [186, 52, 117, 97, 34, 74, 39, 253];

let addressCount = 0;
const uniqueAddress = (): Address => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, ++addressCount);
  return getAddressDecoder().decode(bytes);
};

function bank(opts: { mint?: Address } = {}): BankType {
  const oracle = uniqueAddress();
  return {
    address: uniqueAddress(),
    mint: opts.mint ?? uniqueAddress(),
    mintDecimals: 6,
    assetShareValue: new BigNumber(1),
    liabilityShareValue: new BigNumber(1),
    group: uniqueAddress(),
    liquidityVault: uniqueAddress(),
    oracleKey: oracle,
    premiumTag: 1,
    premiumActive: true,
    premiumActivatedAt: 0,
    config: {
      oracleSetup: OracleSetup.PythPushOracle,
      assetTag: AssetTag.DEFAULT,
      oracleKeys: [oracle],
    },
  } as unknown as BankType;
}

function balance(b: BankType, side: "asset" | "liability"): BalanceType {
  return {
    ...createEmptyBalance(b.address),
    active: true,
    assetShares: new BigNumber(side === "asset" ? 1_000e6 : 0),
    liabilityShares: new BigNumber(side === "liability" ? 100e6 : 0),
  };
}

function account(active: BalanceType[]): MarginfiAccountType {
  const empty = Array.from({ length: 16 - active.length }, () =>
    createEmptyBalance(DEFAULT_ADDRESS)
  );
  return {
    address: uniqueAddress(),
    group: uniqueAddress(),
    authority: uniqueAddress(),
    balances: [...active, ...empty],
    accountFlags: [],
    emissionsDestinationAccount: DEFAULT_ADDRESS,
    healthCache: { simulationStatus: HealthCacheStatus.UNSET },
  } as unknown as MarginfiAccountType;
}

const orders = (count: number) => Array.from({ length: count }, uniqueAddress);

const ixsOf = (tx: SolanaTransaction | undefined): readonly Instruction[] =>
  tx?.message.instructions ?? [];
const keys = (ix: Instruction) => (ix.accounts ?? []).map((meta) => meta.address);
const startsWith = (discriminator: number[]) => (ix: Instruction) =>
  discriminator.every((byte, i) => ix.data?.[i] === byte);
const isClose = startsWith(CLOSE_ORDER_DISCRIMINATOR);
const isPlace = startsWith(PLACE_ORDER_DISCRIMINATOR);
const isPulse = startsWith(PULSE_DISCRIMINATOR);

// Another program's instruction, so the flashloan projection skips it
const foreignIx = (keyCount = 0): Instruction => ({
  programAddress: uniqueAddress(),
  accounts: Array.from({ length: keyCount }, () => ({
    address: uniqueAddress(),
    role: AccountRole.WRITABLE,
  })),
  data: new Uint8Array(8),
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sol = bank();
const usdc = bank();
const usdt = bank();
const usdcCollateral = bank({ mint: usdc.mint });
const bankMap = new Map<string, BankType>(
  [sol, usdc, usdt, usdcCollateral].map((b) => [b.address, b])
);

const holder = account([balance(sol, "asset"), balance(usdc, "liability")]);
const authorityOf = (marginfiAccount: MarginfiAccountType) =>
  createNoopSigner(marginfiAccount.authority);

function deposit(
  marginfiAccount: MarginfiAccountType,
  target: BankType,
  ordersToClose?: Address[]
) {
  return makeDepositTx({
    programAddress,
    bank: target,
    tokenProgram,
    amount: 10,
    marginfiAccount,
    authority: authorityOf(marginfiAccount),
    rpc: rpc as never,
    txFormat: noLuts,
    latestBlockhash,
    bankMap,
    bankMetadataMap: {},
    ordersToClose,
  });
}

describe("single-transaction builders", () => {
  it("close the orders in front of a deposit, with the rent back to the authority", async () => {
    const toClose = orders(2);
    const [first, second, ...rest] = ixsOf(await deposit(holder, sol, toClose));

    expect([first, second].every(isClose)).toBe(true);
    // close_order accounts: group, marginfi_account, authority, order, fee_recipient
    expect([first, second].map((ix) => keys(ix)[3])).toEqual(toClose);
    expect(keys(first)[4]).toBe(holder.authority);
    expect(rest.some(isClose)).toBe(false);
  });

  it("leave a deposit as it is without orders to close", async () => {
    expect(ixsOf(await deposit(holder, sol)).some(isClose)).toBe(false);
  });

  it("keep the premium refresh after the closes while both fit", async () => {
    const ixs = ixsOf(await deposit(holder, sol, orders(1)));

    expect(isClose(ixs[0])).toBe(true);
    expect(isPulse(ixs[ixs.length - 1])).toBe(true);
  });

  it("drop the premium refresh, never a close, once both don't fit", async () => {
    let count = 0;
    let ixs: readonly Instruction[];
    do {
      count++;
      ixs = ixsOf(await deposit(holder, sol, orders(count)));
    } while (ixs.some(isPulse));

    expect(ixs.filter(isClose)).toHaveLength(count);
  });

  it("throw ORDER_CLOSES_DONT_FIT when the closes don't fit next to the action", async () => {
    const toClose = orders(30);

    await expect(deposit(holder, sol, toClose)).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.ORDER_CLOSES_DONT_FIT,
      details: { orderAddresses: toClose },
    });
  });

  it("close the orders in front of a repay and a borrow too", async () => {
    const repayTx = await makeRepayTx({
      programAddress,
      bank: usdc,
      tokenProgram,
      amount: 5,
      marginfiAccount: holder,
      authority: authorityOf(holder),
      rpc: rpc as never,
      txFormat: noLuts,
      latestBlockhash,
      bankMap,
      bankMetadataMap: {},
      ordersToClose: orders(1),
    });
    const borrowTx = await makeBorrowTx({
      programAddress,
      bank: usdc,
      bankMap,
      tokenProgram,
      amount: 1,
      marginfiAccount: holder,
      authority: authorityOf(holder),
      rpc: rpc as never,
      txFormat: noLuts,
      latestBlockhash,
      bankMetadataMap: {},
      ordersToClose: orders(1),
    });

    expect(isClose(ixsOf(repayTx)[0])).toBe(true);
    expect(isClose(ixsOf(borrowTx)[0])).toBe(true);
  });
});

describe("multi-transaction builders", () => {
  function bulkRepay(marginfiAccount: MarginfiAccountType, targets: BankType[], count: number) {
    return makeBulkRepayTx({
      programAddress,
      authority: authorityOf(marginfiAccount),
      rpc: rpc as never,
      marginfiAccount,
      bankAddresses: targets.map((b) => b.address),
      bankMap,
      bankMetadataMap: {},
      tokenProgramsByBank: new Map(targets.map((b) => [b.address, tokenProgram])),
      txFormat: noLuts,
      ordersToClose: orders(count),
    });
  }

  it("bulk: pack the closes in front of the repays, bundling a batch that splits", async () => {
    const twoDebts = account([
      balance(sol, "asset"),
      balance(usdc, "liability"),
      balance(usdt, "liability"),
    ]);

    vi.spyOn(instructions, "makeRepayIx").mockImplementation(async () => foreignIx());
    const single = await bulkRepay(twoDebts, [usdc, usdt], 1);
    expect(single.transactions).toHaveLength(1);
    expect(single.mustBeAtomicBundle).toBe(false);
    expect(isClose(ixsOf(single.transactions[0])[0])).toBe(true);

    vi.spyOn(instructions, "makeRepayIx").mockImplementation(async () => foreignIx(16));
    const split = await bulkRepay(twoDebts, [usdc, usdt], 1);
    expect(split.transactions.length).toBeGreaterThan(1);
    expect(split.mustBeAtomicBundle).toBe(true);
    expect((await bulkRepay(twoDebts, [usdc, usdt], 0)).mustBeAtomicBundle).toBe(false);
  });

  it("flashloans: close the orders in a transaction after the action, as one bundle", async () => {
    vi.spyOn(instructions, "makeWithdrawIx").mockImplementation(async () => foreignIx());
    vi.spyOn(instructions, "makeRepayIx").mockImplementation(async () => foreignIx());
    const collateralized = account([balance(usdcCollateral, "asset"), balance(usdc, "liability")]);
    const repayWithCollateral = (ordersToClose?: Address[]) =>
      makeRepayWithCollatTx({
        programAddress,
        marginfiAccount: collateralized,
        authority: authorityOf(collateralized),
        rpc: rpc as never,
        bankMap,
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

describe("makeOrderChangesTx", () => {
  const pair = { collateralBank: sol.address, debtBank: usdc.address };
  const placeOrder = {
    ...pair,
    trigger: { stopLossUsd: new BigNumber(50), maxSlippagePercent: 1 },
    globalFeeWallet: uniqueAddress(),
  };
  const changes = (params: { ordersToClose?: Address[]; place?: boolean }) =>
    makeOrderChangesTx({
      programAddress,
      marginfiAccount: holder,
      authority: authorityOf(holder),
      ordersToClose: params.ordersToClose,
      placeOrder: params.place ? placeOrder : undefined,
      rpc: rpc as never,
      txFormat: noLuts,
    });

  it("builds nothing, and fetches nothing, without changes", async () => {
    const offline = { getLatestBlockhash: vi.fn(), getAccountInfo: vi.fn() };
    const tx = await makeOrderChangesTx({
      programAddress,
      marginfiAccount: holder,
      authority: authorityOf(holder),
      ordersToClose: [],
      rpc: offline as never,
      txFormat: noLuts,
    });

    expect(tx).toBeUndefined();
    expect(offline.getLatestBlockhash).not.toHaveBeenCalled();
  });

  it("closes, then places, as an update when the pair's own order is among the closes", async () => {
    const [pairOrder] = await deriveOrderPda(programAddress, holder.address, [
      pair.collateralBank,
      pair.debtBank,
    ]);
    const tx = await changes({ ordersToClose: [uniqueAddress(), pairOrder], place: true });
    const ixs = ixsOf(tx);

    expect(tx?.type).toBe(TransactionType.UPDATE_ORDER);
    expect(ixs.slice(0, 2).every(isClose)).toBe(true);
    expect(isPlace(ixs[2])).toBe(true);
  });

  it("tags a placement on a new pair and closes alone by what they do", async () => {
    const placed = await changes({ ordersToClose: [uniqueAddress()], place: true });
    const closed = await changes({ ordersToClose: [uniqueAddress()] });

    expect(placed?.type).toBe(TransactionType.PLACE_ORDER);
    expect(closed?.type).toBe(TransactionType.CLOSE_ORDER);
  });

  it("throws ORDER_CLOSES_DONT_FIT rather than spill into a second transaction", async () => {
    const error = await changes({ ordersToClose: orders(30), place: true }).catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(TransactionBuildingError);
    expect((error as TransactionBuildingError).code).toBe(
      TransactionBuildingErrorCode.ORDER_CLOSES_DONT_FIT
    );
  });
});
