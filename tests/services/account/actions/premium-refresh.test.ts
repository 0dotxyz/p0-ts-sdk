import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import { MarginfiAccount, MarginfiAccountWrapper, Project0Client } from "~/index";
import instructions from "~/instructions";
import {
  BalanceType,
  createEmptyBalance,
  HealthCacheStatus,
  makeBulkRepayTx,
  makeDepositTx,
  makeRepayTx,
  MarginfiAccountType,
} from "~/services/account";
import { AssetTag, BankType, OracleSetup } from "~/services/bank";
import type { MarginfiProgram } from "~/types";
import { TOKEN_PROGRAM_ID } from "~/vendor/spl";

const PULSE_DISCRIMINATOR = Buffer.from([186, 52, 117, 97, 34, 74, 39, 253]);

const program = new Program<MarginfiIdlType>(
  MARGINFI_IDL,
  new AnchorProvider(new Connection("http://127.0.0.1:1"), {} as Wallet, {})
) as unknown as MarginfiProgram;

function bank(opts: { premiumActive?: boolean; assetTag?: AssetTag } = {}): BankType {
  const oracle = PublicKey.unique();
  return {
    address: PublicKey.unique(),
    mint: PublicKey.unique(),
    mintDecimals: 6,
    assetShareValue: new BigNumber(1),
    liabilityShareValue: new BigNumber(1),
    group: PublicKey.unique(),
    liquidityVault: PublicKey.unique(),
    oracleKey: oracle,
    premiumTag: 1,
    premiumActive: opts.premiumActive ?? true,
    premiumActivatedAt: 0,
    config: {
      oracleSetup: OracleSetup.PythPushOracle,
      assetTag: opts.assetTag ?? AssetTag.DEFAULT,
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

afterEach(() => {
  vi.restoreAllMocks();
});

const lastIx = (tx: Transaction): TransactionInstruction =>
  tx.instructions[tx.instructions.length - 1];
const isPulse = (ix: TransactionInstruction) => ix.data.subarray(0, 8).equals(PULSE_DISCRIMINATOR);
const keys = (ix: TransactionInstruction) => ix.keys.map((k) => k.pubkey.toBase58());

const sol = bank();
const usdc = bank();
const usdt = bank();
const inactive = bank({ premiumActive: false });
const kamino = bank({ assetTag: AssetTag.KAMINO });
const bankMap = new Map([sol, usdc, usdt, inactive, kamino].map((b) => [b.address.toBase58(), b]));

function deposit(
  marginfiAccount: MarginfiAccountType,
  target: BankType,
  opts: { skipPremiumRefresh?: boolean } = {}
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
    opts: { ...overrides(marginfiAccount, target), skipPremiumRefresh: opts.skipPremiumRefresh },
  });
}

function bulkRepay(
  marginfiAccount: MarginfiAccountType,
  targets: BankType[],
  skipPremiumRefresh?: boolean
) {
  return makeBulkRepayTx({
    program,
    connection: {
      getLatestBlockhash: async () => ({ blockhash: PublicKey.default.toBase58() }),
    } as unknown as Connection,
    marginfiAccount,
    bankAddresses: targets.map((b) => b.address),
    bankMap,
    bankMetadataMap: {},
    tokenProgramsByBank: new Map(targets.map((b) => [b.address.toBase58(), TOKEN_PROGRAM_ID])),
    overrideInferAccounts: { group: marginfiAccount.group },
    skipPremiumRefresh,
  });
}

function repay(marginfiAccount: MarginfiAccountType, target: BankType, repayAll: boolean) {
  return makeRepayTx({
    program,
    bank: target,
    tokenProgram: TOKEN_PROGRAM_ID,
    amount: 100,
    accountAddress: marginfiAccount.address,
    authority: marginfiAccount.authority,
    repayAll,
    luts: [],
    marginfiAccount,
    bankMap,
    bankMetadataMap: {},
    opts: overrides(marginfiAccount, target),
  });
}

describe("deposits", () => {
  const borrower = account([balance(sol, "asset"), balance(usdc, "liability")]);

  it("add pulse_health while premium-bearing debt exists, with the deposited bank in it", async () => {
    const tx = await deposit(borrower, usdt);
    const pulse = lastIx(tx);

    expect(isPulse(pulse)).toBe(true);
    expect(keys(pulse).slice(0, 2)).toEqual([
      borrower.address.toBase58(),
      borrower.group.toBase58(),
    ]);
    expect(keys(pulse)).toEqual(
      expect.arrayContaining([sol, usdc, usdt].map((b) => b.address.toBase58()))
    );
  });

  it("stay as they are without premium-bearing debt", async () => {
    const noPremiumDebt = account([balance(sol, "asset"), balance(inactive, "liability")]);
    expect((await deposit(noPremiumDebt, usdt)).instructions.some(isPulse)).toBe(false);
    expect((await deposit(account([balance(sol, "asset")]), usdt)).instructions.some(isPulse)).toBe(
      false
    );
  });

  it("skip the pulse with opts.skipPremiumRefresh", async () => {
    const tx = await deposit(borrower, usdt, { skipPremiumRefresh: true });
    expect(tx.instructions.some(isPulse)).toBe(false);
  });
});

describe("repays", () => {
  it("add pulse_health while premium-bearing debt remains, without a fully repaid bank", async () => {
    const twoDebts = account([
      balance(sol, "asset"),
      balance(usdc, "liability"),
      balance(usdt, "liability"),
    ]);
    const pulse = lastIx(await repay(twoDebts, usdc, true));

    expect(isPulse(pulse)).toBe(true);
    expect(keys(pulse)).toContain(usdt.address.toBase58());
    expect(keys(pulse)).not.toContain(usdc.address.toBase58());
  });

  it("add it after a partial repay of the only premium debt, but not after repaying it in full", async () => {
    const borrower = account([balance(sol, "asset"), balance(usdc, "liability")]);
    expect(isPulse(lastIx(await repay(borrower, usdc, false)))).toBe(true);
    expect((await repay(borrower, usdc, true)).instructions.some(isPulse)).toBe(false);
  });

  it("drop the pulse instead of throwing when a held bank has no venue state", async () => {
    const kaminoCollateral = account([balance(kamino, "asset"), balance(usdc, "liability")]);
    const tx = await repay(kaminoCollateral, usdc, false);

    expect(tx.instructions.some(isPulse)).toBe(false);
  });

  it("bulk: add one pulse after all repays, unless skipped", async () => {
    vi.spyOn(instructions, "makeRepayIx").mockResolvedValue(
      new TransactionInstruction({ programId: program.programId, keys: [], data: Buffer.alloc(8) })
    );
    const twoDebts = account([
      balance(sol, "asset"),
      balance(usdc, "liability"),
      balance(usdt, "liability"),
    ]);

    const { transactions, mustBeAtomicBundle } = await bulkRepay(twoDebts, [usdc]);
    expect(transactions).toHaveLength(1);
    expect(mustBeAtomicBundle).toBe(false);
    const message = transactions[transactions.length - 1].message;
    const last = message.compiledInstructions[message.compiledInstructions.length - 1];
    const accountKeys = message.staticAccountKeys.map((k) => k.toBase58());
    expect(Buffer.from(last.data.subarray(0, 8)).equals(PULSE_DISCRIMINATOR)).toBe(true);
    expect(last.accountKeyIndexes.map((i) => accountKeys[i])).not.toContain(
      usdc.address.toBase58()
    );

    const skipped = (await bulkRepay(twoDebts, [usdc], true)).transactions.flatMap((tx) =>
      tx.message.compiledInstructions.map((ix) => Buffer.from(ix.data.subarray(0, 8)))
    );
    expect(skipped.some((data) => data.equals(PULSE_DISCRIMINATOR))).toBe(false);
  });

  it("bulk: bundle a batch that splits with the premium refresh in it", async () => {
    vi.spyOn(instructions, "makeRepayIx").mockImplementation(
      async () =>
        new TransactionInstruction({
          programId: program.programId,
          keys: Array.from({ length: 16 }, () => ({
            pubkey: PublicKey.unique(),
            isSigner: false,
            isWritable: true,
          })),
          data: Buffer.alloc(8),
        })
    );
    const threeDebts = account([
      balance(sol, "asset"),
      balance(usdc, "liability"),
      balance(inactive, "liability"),
      balance(usdt, "liability"),
    ]);

    const split = await bulkRepay(threeDebts, [usdc, inactive]);
    expect(split.transactions.length).toBeGreaterThan(1);
    expect(split.mustBeAtomicBundle).toBe(true);

    const skipped = await bulkRepay(threeDebts, [usdc, inactive], true);
    expect(skipped.transactions.length).toBeGreaterThan(1);
    expect(skipped.mustBeAtomicBundle).toBe(false);
  });
});

describe("account wrapper", () => {
  it("passes the client's state so deposits get the pulse with no extra arguments", async () => {
    const marginfiAccount = MarginfiAccount.fromAccountType(
      account([balance(sol, "asset"), balance(usdc, "liability")])
    );
    const client = {
      program,
      bankMap,
      mintDataByBank: new Map(
        [sol, usdc, usdt].map((b) => [
          b.address.toBase58(),
          { mint: b.mint, tokenProgram: TOKEN_PROGRAM_ID },
        ])
      ),
      addressLookupTables: [],
      bankIntegrationMap: {},
    } as unknown as Project0Client;
    const wrapper = new MarginfiAccountWrapper(marginfiAccount, client);

    const tx = await wrapper.makeDepositTx(usdt.address, 10, overrides(marginfiAccount, usdt));
    expect(isPulse(lastIx(tx))).toBe(true);
  });
});
