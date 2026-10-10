import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BigNumber from "bignumber.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TransactionBuildingError, TransactionBuildingErrorCode } from "~/errors";
import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import instructions from "~/instructions";
import {
  BalanceType,
  composeBridgedSwap,
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
import { addTransactionMetadata, SolanaTransaction, TransactionType } from "~/services/transaction";
import type { MarginfiProgram } from "~/types";
import { deriveOrderPda } from "~/utils";
import { TOKEN_PROGRAM_ID } from "~/vendor/spl";

const CLOSE_ORDER_DISCRIMINATOR = Buffer.from([212, 223, 79, 182, 172, 183, 205, 237]);
const PLACE_ORDER_DISCRIMINATOR = Buffer.from([244, 112, 75, 138, 143, 108, 7, 186]);
const PULSE_DISCRIMINATOR = Buffer.from([186, 52, 117, 97, 34, 74, 39, 253]);

const program = new Program<MarginfiIdlType>(
  MARGINFI_IDL,
  new AnchorProvider(new Connection("http://127.0.0.1:1"), {} as Wallet, {})
) as unknown as MarginfiProgram;

const BLOCKHASH = PublicKey.default.toBase58();
const connection = {
  getLatestBlockhash: async () => ({ blockhash: BLOCKHASH }),
  getLatestBlockhashAndContext: async () => ({ value: { blockhash: BLOCKHASH } }),
  // Every ATA exists, so no setup transactions
  getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(() => ({})),
} as unknown as Connection;

function bank(opts: { mint?: PublicKey } = {}): BankType {
  const oracle = PublicKey.unique();
  return {
    address: PublicKey.unique(),
    mint: opts.mint ?? PublicKey.unique(),
    mintDecimals: 6,
    assetShareValue: new BigNumber(1),
    liabilityShareValue: new BigNumber(1),
    group: PublicKey.unique(),
    liquidityVault: PublicKey.unique(),
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
    createEmptyBalance(PublicKey.default)
  );
  return {
    address: PublicKey.unique(),
    group: PublicKey.unique(),
    authority: PublicKey.unique(),
    balances: [...active, ...empty],
    accountFlags: [],
    emissionsDestinationAccount: PublicKey.default,
    healthCache: { simulationStatus: HealthCacheStatus.UNSET },
  } as unknown as MarginfiAccountType;
}

// Anchor resolves the group and liquidity vault relations over RPC unless they are passed.
const overrides = (a: { group: PublicKey }, b: BankType) => ({
  overrideInferAccounts: { group: a.group, liquidityVault: b.liquidityVault },
});

const orders = (count: number) => Array.from({ length: count }, () => PublicKey.unique());
const base58 = (keys: PublicKey[]) => keys.map((key) => key.toBase58());

const startsWith = (discriminator: Buffer) => (data: Uint8Array) =>
  Buffer.from(data.subarray(0, 8)).equals(discriminator);
const isClose = startsWith(CLOSE_ORDER_DISCRIMINATOR);
const isPlace = startsWith(PLACE_ORDER_DISCRIMINATOR);
const isPulse = startsWith(PULSE_DISCRIMINATOR);

const ixData = (tx: SolanaTransaction | Transaction): Uint8Array[] =>
  "message" in tx
    ? tx.message.compiledInstructions.map((ix) => ix.data)
    : tx.instructions.map((ix) => ix.data);

// Another program's instruction, so the flashloan projection skips it
const foreignIx = (keyCount = 0) =>
  new TransactionInstruction({
    programId: PublicKey.unique(),
    keys: Array.from({ length: keyCount }, () => ({
      pubkey: PublicKey.unique(),
      isSigner: false,
      isWritable: true,
    })),
    data: Buffer.alloc(8),
  });

afterEach(() => {
  vi.restoreAllMocks();
});

const sol = bank();
const usdc = bank();
const usdt = bank();
const usdcCollateral = bank({ mint: usdc.mint });
const bankMap = new Map([sol, usdc, usdt, usdcCollateral].map((b) => [b.address.toBase58(), b]));

const holder = account([balance(sol, "asset"), balance(usdc, "liability")]);

function deposit(
  marginfiAccount: MarginfiAccountType,
  target: BankType,
  ordersToClose?: PublicKey[]
) {
  return makeDepositTx({
    program,
    bank: target,
    tokenProgram: TOKEN_PROGRAM_ID,
    amount: 10,
    accountAddress: marginfiAccount.address,
    authority: marginfiAccount.authority,
    group: marginfiAccount.group,
    luts: [],
    marginfiAccount,
    bankMap,
    bankMetadataMap: {},
    opts: overrides(marginfiAccount, target),
    ordersToClose,
  });
}

describe("single-transaction builders", () => {
  it("close the orders in front of a deposit, with the rent back to the authority", async () => {
    const toClose = orders(2);
    const [first, second, ...rest] = (await deposit(holder, sol, toClose)).instructions;

    expect([first, second].every((ix) => isClose(ix.data))).toBe(true);
    // close_order accounts: group, marginfi_account, authority, order, fee_recipient
    expect(base58([first.keys[3].pubkey, second.keys[3].pubkey])).toEqual(base58(toClose));
    expect(first.keys[4].pubkey.equals(holder.authority)).toBe(true);
    expect(rest.some((ix) => isClose(ix.data))).toBe(false);
  });

  it("leave a deposit as it is without orders to close", async () => {
    expect(ixData(await deposit(holder, sol)).some(isClose)).toBe(false);
  });

  it("keep the premium refresh after the closes while both fit", async () => {
    const data = ixData(await deposit(holder, sol, orders(1)));

    expect(isClose(data[0])).toBe(true);
    expect(isPulse(data[data.length - 1])).toBe(true);
  });

  it("drop the premium refresh, never a close, once both don't fit", async () => {
    let count = 0;
    let data: Uint8Array[];
    do {
      count++;
      data = ixData(await deposit(holder, sol, orders(count)));
    } while (data.some(isPulse));

    expect(data.filter(isClose)).toHaveLength(count);
  });

  it("throw ORDER_CLOSES_DONT_FIT when the closes don't fit next to the action", async () => {
    const toClose = orders(30);
    const error = await deposit(holder, sol, toClose).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TransactionBuildingError);
    expect((error as TransactionBuildingError).code).toBe(
      TransactionBuildingErrorCode.ORDER_CLOSES_DONT_FIT
    );
    expect(
      (error as TransactionBuildingError<TransactionBuildingErrorCode.ORDER_CLOSES_DONT_FIT>)
        .details.orderAddresses
    ).toEqual(base58(toClose));
  });

  it("close the orders in front of a repay and a borrow too", async () => {
    const repayTx = await makeRepayTx({
      program,
      bank: usdc,
      tokenProgram: TOKEN_PROGRAM_ID,
      amount: 5,
      accountAddress: holder.address,
      authority: holder.authority,
      luts: [],
      marginfiAccount: holder,
      bankMap,
      bankMetadataMap: {},
      opts: overrides(holder, usdc),
      ordersToClose: orders(1),
    });
    const { transactions } = await makeBorrowTx({
      program,
      bank: usdc,
      bankMap,
      tokenProgram: TOKEN_PROGRAM_ID,
      amount: 1,
      marginfiAccount: holder,
      authority: holder.authority,
      isSync: true,
      connection,
      oraclePrices: new Map(),
      assetShareValueMultiplierByBank: new Map(),
      bankMetadataMap: {},
      luts: [],
      ordersToClose: orders(1),
    });

    expect(isClose(ixData(repayTx)[0])).toBe(true);
    expect(transactions).toHaveLength(1);
    expect(isClose(ixData(transactions[0])[0])).toBe(true);
  });
});

describe("multi-transaction builders", () => {
  function bulkRepay(marginfiAccount: MarginfiAccountType, targets: BankType[], count: number) {
    return makeBulkRepayTx({
      program,
      connection,
      marginfiAccount,
      bankAddresses: targets.map((b) => b.address),
      bankMap,
      bankMetadataMap: {},
      tokenProgramsByBank: new Map(targets.map((b) => [b.address.toBase58(), TOKEN_PROGRAM_ID])),
      overrideInferAccounts: { group: marginfiAccount.group },
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
    expect(isClose(ixData(single.transactions[0])[0])).toBe(true);

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
    const repayWithCollateral = (ordersToClose?: PublicKey[]) =>
      makeRepayWithCollatTx({
        program,
        marginfiAccount: collateralized,
        connection,
        bankMap,
        oraclePrices: new Map(),
        assetShareValueMultiplierByBank: new Map(),
        bankMetadataMap: {},
        withdrawOpts: {
          totalPositionAmount: 1_000,
          withdrawAmount: 10,
          withdrawBank: usdcCollateral,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        repayOpts: { repayBank: usdc, tokenProgram: TOKEN_PROGRAM_ID, totalPositionAmount: 100 },
        swapOpts: {},
        overrideInferAccounts: { group: collateralized.group },
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
    expect(ixData(flashloanTx).some(isClose)).toBe(false);
    expect(ixData(ordersTx).every(isClose)).toBe(true);
    expect(ixData(ordersTx)).toHaveLength(toClose.length);
  });
});

describe("makeOrderChangesTx", () => {
  const pair = { collateralBank: sol.address, debtBank: usdc.address };
  const placeOrder = {
    ...pair,
    trigger: { stopLossUsd: new BigNumber(50), maxSlippagePercent: 1 },
    globalFeeWallet: PublicKey.unique(),
  };
  const [pairOrder] = deriveOrderPda(program.programId, holder.address, [
    pair.collateralBank,
    pair.debtBank,
  ]);
  const changes = (params: { ordersToClose?: PublicKey[]; place?: boolean }) =>
    makeOrderChangesTx({
      program,
      marginfiAccount: holder,
      ordersToClose: params.ordersToClose,
      placeOrder: params.place ? placeOrder : undefined,
      connection,
      luts: [],
    });

  it("builds nothing, and fetches nothing, without changes", async () => {
    const offline = { getLatestBlockhashAndContext: vi.fn() } as unknown as Connection;
    const tx = await makeOrderChangesTx({
      program,
      marginfiAccount: holder,
      ordersToClose: [],
      connection: offline,
      luts: [],
    });

    expect(tx).toBeUndefined();
    expect(offline.getLatestBlockhashAndContext).not.toHaveBeenCalled();
  });

  it("closes, then places, as an update when the pair's own order is among the closes", async () => {
    const tx = await changes({ ordersToClose: [PublicKey.unique(), pairOrder], place: true });
    const data = ixData(tx!);

    expect(tx?.type).toBe(TransactionType.UPDATE_ORDER);
    expect(data.slice(0, 2).every(isClose)).toBe(true);
    expect(isPlace(data[2])).toBe(true);
  });

  it("tags a placement on a new pair and closes alone by what they do", async () => {
    const placed = await changes({ ordersToClose: [PublicKey.unique()], place: true });
    const closed = await changes({ ordersToClose: [PublicKey.unique()] });

    expect(placed?.type).toBe(TransactionType.PLACE_ORDER);
    expect(closed?.type).toBe(TransactionType.CLOSE_ORDER);
  });

  it("throws ORDER_CLOSES_DONT_FIT rather than spill into a second transaction", async () => {
    const error = await changes({ ordersToClose: orders(30), place: true }).catch(
      (e: unknown) => e
    );

    expect((error as TransactionBuildingError).code).toBe(
      TransactionBuildingErrorCode.ORDER_CLOSES_DONT_FIT
    );
  });
});

describe("composeBridgedSwap", () => {
  it("leaves bundle slots for the transactions the caller appends", async () => {
    const tx = (type: TransactionType) =>
      addTransactionMetadata(
        new VersionedTransaction(
          new TransactionMessage({
            payerKey: holder.authority,
            recentBlockhash: BLOCKHASH,
            instructions: [foreignIx()],
          }).compileToV0Message()
        ),
        { type, addressLookupTables: [] }
      );
    const leg = () => ({
      transactions: [tx(TransactionType.CRANK), tx(TransactionType.FLASHLOAN)],
      quoteResponse: { inAmount: "1", outAmount: "1", otherAmountThreshold: "1", slippageBps: 0 },
    });
    const compose = (reservedTxs: number) =>
      composeBridgedSwap({
        firstLeg: leg(),
        buildSecondLeg: async () => leg(),
        marginfiAccount: holder,
        program,
        banksMap: bankMap,
        assetShareValueMultiplierByBank: new Map(),
        feePayer: holder.authority,
        reservedTxs,
      });

    // Two cranks and two flashloans against the default five-transaction ceiling
    expect((await compose(1))?.transactions).toHaveLength(4);
    expect(await compose(2)).toBeNull();
  });
});
