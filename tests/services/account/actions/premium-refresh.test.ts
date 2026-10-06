import {
  AccountRole,
  address,
  blockhash,
  createNoopSigner,
  getAddressDecoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import BigNumber from "bignumber.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_ACCOUNT_LOCKS } from "~/constants";
import instructions from "~/instructions";
import { MarginfiAccount } from "~/models/account";
import { MarginfiAccountWrapper } from "~/models/account-wrapper";
import type { Project0Client } from "~/models/client";
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
import { getTotalAccountKeys, SolanaTransaction, TransactionFormat } from "~/services/transaction";
import type { BankIntegrationMetadataMap } from "~/types";
import { KaminoReserve } from "~/vendor/klend";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const DEFAULT_ADDRESS = address("11111111111111111111111111111111");
const latestBlockhash = {
  blockhash: blockhash("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"),
  lastValidBlockHeight: 1n,
};
const rpc = { getLatestBlockhash: () => ({ send: async () => ({ value: latestBlockhash }) }) };
const noLuts: TransactionFormat = { version: 0, luts: {} };
const PULSE_DISCRIMINATOR = [186, 52, 117, 97, 34, 74, 39, 253];

let addressCount = 0;
const uniqueAddress = (): Address => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, ++addressCount);
  return getAddressDecoder().decode(bytes);
};

function bank(opts: { premiumActive?: boolean; assetTag?: AssetTag } = {}): BankType {
  const oracle = uniqueAddress();
  return {
    address: uniqueAddress(),
    mint: uniqueAddress(),
    mintDecimals: 6,
    assetShareValue: new BigNumber(1),
    liabilityShareValue: new BigNumber(1),
    group: uniqueAddress(),
    liquidityVault: uniqueAddress(),
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

afterEach(() => {
  vi.restoreAllMocks();
});

const ixsOf = (tx: SolanaTransaction): readonly Instruction[] => tx.message.instructions;
const lastIx = (tx: SolanaTransaction): Instruction => ixsOf(tx)[ixsOf(tx).length - 1];
const isPulse = (ix: Instruction) =>
  ix.data !== undefined && PULSE_DISCRIMINATOR.every((byte, i) => ix.data?.[i] === byte);
const hasPulse = (tx: SolanaTransaction) => ixsOf(tx).some(isPulse);
const keys = (ix: Instruction) => (ix.accounts ?? []).map((meta) => meta.address);

const sol = bank();
const usdc = bank();
const usdt = bank();
const inactive = bank({ premiumActive: false });
const kamino = bank({ assetTag: AssetTag.KAMINO });
const bankMap = new Map<string, BankType>(
  [sol, usdc, usdt, inactive, kamino].map((b) => [b.address, b])
);

function deposit(
  marginfiAccount: MarginfiAccountType,
  target: BankType,
  opts: { skipPremiumRefresh?: boolean } = {}
) {
  return makeDepositTx({
    programAddress,
    bank: target,
    tokenProgram,
    amount: 10,
    marginfiAccount,
    authority: createNoopSigner(marginfiAccount.authority),
    rpc: rpc as never,
    txFormat: noLuts,
    latestBlockhash,
    bankMap,
    bankMetadataMap: {},
    opts,
  });
}

function bulkRepay(
  marginfiAccount: MarginfiAccountType,
  targets: BankType[],
  skipPremiumRefresh?: boolean
) {
  return makeBulkRepayTx({
    programAddress,
    authority: createNoopSigner(marginfiAccount.authority),
    rpc: rpc as never,
    marginfiAccount,
    bankAddresses: targets.map((b) => b.address),
    bankMap,
    bankMetadataMap: {},
    tokenProgramsByBank: new Map(targets.map((b) => [b.address, tokenProgram])),
    txFormat: noLuts,
    skipPremiumRefresh,
  });
}

function repay(marginfiAccount: MarginfiAccountType, target: BankType, repayAll: boolean) {
  return makeRepayTx({
    programAddress,
    bank: target,
    tokenProgram,
    amount: 100,
    marginfiAccount,
    authority: createNoopSigner(marginfiAccount.authority),
    repayAll,
    rpc: rpc as never,
    txFormat: noLuts,
    latestBlockhash,
    bankMap,
    bankMetadataMap: {},
  });
}

describe("deposits", () => {
  const borrower = account([balance(sol, "asset"), balance(usdc, "liability")]);

  it("add pulse_health while premium-bearing debt exists, with the deposited bank in it", async () => {
    const tx = await deposit(borrower, usdt);
    const pulse = lastIx(tx);

    expect(isPulse(pulse)).toBe(true);
    expect(keys(pulse).slice(0, 2)).toEqual([borrower.address, borrower.group]);
    expect(keys(pulse)).toEqual(expect.arrayContaining([sol, usdc, usdt].map((b) => b.address)));
  });

  it("stay as they are without premium-bearing debt", async () => {
    const noPremiumDebt = account([balance(sol, "asset"), balance(inactive, "liability")]);
    expect(hasPulse(await deposit(noPremiumDebt, usdt))).toBe(false);
    expect(hasPulse(await deposit(account([balance(sol, "asset")]), usdt))).toBe(false);
  });

  it("skip the pulse with opts.skipPremiumRefresh", async () => {
    const tx = await deposit(borrower, usdt, { skipPremiumRefresh: true });
    expect(hasPulse(tx)).toBe(false);
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
    expect(keys(pulse)).toContain(usdt.address);
    expect(keys(pulse)).not.toContain(usdc.address);
  });

  it("add it after a partial repay of the only premium debt, but not after repaying it in full", async () => {
    const borrower = account([balance(sol, "asset"), balance(usdc, "liability")]);
    expect(isPulse(lastIx(await repay(borrower, usdc, false)))).toBe(true);
    expect(hasPulse(await repay(borrower, usdc, true))).toBe(false);
  });

  it("drop the pulse instead of throwing when a held bank has no venue state", async () => {
    const kaminoCollateral = account([balance(kamino, "asset"), balance(usdc, "liability")]);
    const tx = await repay(kaminoCollateral, usdc, false);

    expect(hasPulse(tx)).toBe(false);
  });

  it("bulk: add one pulse after all repays, unless skipped", async () => {
    const twoDebts = account([
      balance(sol, "asset"),
      balance(usdc, "liability"),
      balance(usdt, "liability"),
    ]);

    const { transactions, mustBeAtomicBundle } = await bulkRepay(twoDebts, [usdc]);
    expect(transactions).toHaveLength(1);
    expect(mustBeAtomicBundle).toBe(false);
    const last = lastIx(transactions[transactions.length - 1]);
    expect(isPulse(last)).toBe(true);
    expect(keys(last)).not.toContain(usdc.address);

    const skipped = await bulkRepay(twoDebts, [usdc], true);
    expect(skipped.transactions.some(hasPulse)).toBe(false);
  });

  it("bulk: bundle a batch that splits with the premium refresh in it", async () => {
    vi.spyOn(instructions, "makeRepayIx").mockImplementation(async () => ({
      programAddress,
      accounts: Array.from({ length: 16 }, () => ({
        address: uniqueAddress(),
        role: AccountRole.WRITABLE,
      })),
      data: new Uint8Array(8),
    }));
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
      programAddress,
      rpc,
      bankMap,
      mintDataByBank: new Map(
        [sol, usdc, usdt].map((b) => [b.address, { mint: b.mint, tokenProgram }])
      ),
      addressLookupTables: {},
      bankIntegrationMap: {},
      assetShareValueMultiplierByBank: new Map(),
    } as unknown as Project0Client;
    const wrapper = new MarginfiAccountWrapper(marginfiAccount, client);

    const tx = await wrapper.makeDepositTx(usdt.address, 10);
    expect(isPulse(lastIx(tx))).toBe(true);
  });
});

describe("large accounts", () => {
  const lendingMarket = uniqueAddress();
  const reserves = new Map<string, KaminoReserve>();
  // Every fixture key goes in the lookup table, so account locks bind before bytes do
  const lutAddresses: Address[] = [lendingMarket];

  function kaminoBank(): BankType {
    const base = bank({ assetTag: AssetTag.KAMINO });
    const reserve = uniqueAddress();
    const obligation = uniqueAddress();
    const reserveState = {
      lendingMarket,
      farmCollateral: uniqueAddress(),
      liquidity: { supplyVault: uniqueAddress() },
      collateral: { mintPubkey: uniqueAddress(), supplyVault: uniqueAddress() },
      config: {
        tokenInfo: {
          pythConfiguration: { price: base.oracleKey },
          switchboardConfiguration: {
            priceAggregator: DEFAULT_ADDRESS,
            twapAggregator: DEFAULT_ADDRESS,
          },
          scopeConfiguration: { priceFeed: DEFAULT_ADDRESS },
        },
      },
    };
    reserves.set(base.address, reserveState as unknown as KaminoReserve);
    lutAddresses.push(
      obligation,
      reserveState.farmCollateral,
      reserveState.liquidity.supplyVault,
      reserveState.collateral.mintPubkey,
      reserveState.collateral.supplyVault
    );
    return {
      ...base,
      kaminoIntegrationAccounts: { kaminoReserve: reserve, kaminoObligation: obligation },
      config: {
        ...base.config,
        oracleSetup: OracleSetup.KaminoPythPush,
        oracleKeys: [base.oracleKey, reserve],
      },
    } as BankType;
  }

  function lstBank(): BankType {
    const base = bank();
    return {
      ...base,
      config: {
        ...base.config,
        oracleSetup: OracleSetup.PythLST,
        oracleKeys: [base.oracleKey, uniqueAddress()],
      },
    } as BankType;
  }

  const target = kaminoBank();
  const heldKamino = [kaminoBank(), kaminoBank(), kaminoBank()];
  const lsts = Array.from({ length: 11 }, lstBank);
  const debt = bank();
  const banks = [target, ...heldKamino, ...lsts, debt];
  const largeBankMap = new Map<string, BankType>(banks.map((b) => [b.address, b]));
  const bankMetadataMap = Object.fromEntries(
    [target, ...heldKamino].map((b) => [
      b.address,
      { kaminoStates: { reserveState: reserves.get(b.address) } },
    ])
  ) as unknown as BankIntegrationMetadataMap;

  function kaminoDeposit(marginfiAccount: MarginfiAccountType) {
    const txFormat: TransactionFormat = {
      version: 0,
      luts: {
        [uniqueAddress()]: [
          ...lutAddresses,
          marginfiAccount.address,
          marginfiAccount.group,
          ...banks.flatMap((b) => [b.address, b.mint, b.liquidityVault, ...b.config.oracleKeys]),
        ],
      },
    };
    return makeDepositTx({
      programAddress,
      bank: target,
      tokenProgram,
      amount: 10,
      marginfiAccount,
      authority: createNoopSigner(marginfiAccount.authority),
      rpc: rpc as never,
      txFormat,
      latestBlockhash,
      bankMap: largeBankMap,
      bankMetadataMap,
    });
  }

  it("keep the pulse on a Kamino deposit while it fits", async () => {
    const small = account([balance(heldKamino[0], "asset"), balance(debt, "liability")]);
    expect(hasPulse(await kaminoDeposit(small))).toBe(true);
  });

  it("drop it when it would push a Kamino deposit past the account-lock limit", async () => {
    const large = account([
      ...heldKamino.map((b) => balance(b, "asset")),
      ...lsts.map((b) => balance(b, "asset")),
      balance(debt, "liability"),
    ]);
    const tx = await kaminoDeposit(large);

    expect(hasPulse(tx)).toBe(false);
    expect(getTotalAccountKeys(tx.message)).toBeLessThanOrEqual(MAX_ACCOUNT_LOCKS);
  });
});
