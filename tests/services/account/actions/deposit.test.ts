import { address, createNoopSigner, type Address, type Instruction } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { addr, LATEST_BLOCKHASH } from "../../../helpers/addresses";
import { makeAccount, makeBalance, makeBank } from "../../../helpers/factories";
import { isMarginfiIx } from "../../../helpers/ix";
import { mainnetBanks } from "../../../helpers/mainnet";
import { depositParams, toWire, v283Cases } from "../../../helpers/parity";
import { fakeRpc } from "../../../helpers/rpc";

import { DEFAULT_ADDRESS, MAX_ACCOUNT_LOCKS } from "~/constants";
import { TransactionBuildingErrorCode } from "~/errors";
import { MarginfiInstruction } from "~/instructions";
import { makeDepositIx, makeDepositTx } from "~/services/account/actions/deposit";
import type { MarginfiAccountType } from "~/services/account/types";
import { AssetTag, BankType, OracleSetup } from "~/services/bank";
import { getTotalAccountKeys, SolanaTransaction, TransactionFormat } from "~/services/transaction";
import type { BankIntegrationMetadataMap } from "~/types";
import { KaminoReserve } from "~/vendor/klend";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const rpc = fakeRpc({ accountsExist: true });
const noLuts: TransactionFormat = { version: 0, luts: {} };

const premiumBank = (overrides: Parameters<typeof makeBank>[0] = {}) =>
  makeBank({ premiumTag: 1, premiumActive: true, ...overrides });
const asset = (bank: BankType) => makeBalance(bank, "asset", 1_000e6);
const debt = (bank: BankType) => makeBalance(bank, "liability", 100e6);

const ixsOf = (tx: SolanaTransaction): readonly Instruction[] => tx.message.instructions;
const lastIx = (tx: SolanaTransaction): Instruction => ixsOf(tx)[ixsOf(tx).length - 1];
const keys = (ix: Instruction) => (ix.accounts ?? []).map((meta) => meta.address);
const isClose = isMarginfiIx(MarginfiInstruction.MarginfiAccountCloseOrder);
const isPulse = isMarginfiIx(MarginfiInstruction.LendingAccountPulseHealth);
const hasPulse = (tx: SolanaTransaction) => ixsOf(tx).some(isPulse);

const orders = (count: number) => Array.from({ length: count }, addr);

const sol = premiumBank();
const usdc = premiumBank();
const usdt = premiumBank();
const inactive = premiumBank({ premiumActive: false });
const bankMap = new Map<string, BankType>([sol, usdc, usdt, inactive].map((b) => [b.address, b]));

const borrower = makeAccount([asset(sol), debt(usdc)]);

function deposit(
  marginfiAccount: MarginfiAccountType,
  target: BankType,
  {
    ordersToClose,
    opts,
  }: { ordersToClose?: Address[]; opts?: { skipPremiumRefresh?: boolean } } = {}
) {
  return makeDepositTx({
    programAddress,
    bank: target,
    tokenProgram,
    amount: 10,
    marginfiAccount,
    authority: createNoopSigner(marginfiAccount.authority),
    rpc,
    txFormat: noLuts,
    latestBlockhash: LATEST_BLOCKHASH,
    bankMap,
    bankMetadataMap: {},
    ordersToClose,
    opts,
  });
}

const lendingMarket = addr();
const reserves = new Map<string, KaminoReserve>();
// Every fixture key goes in the lookup table, so account locks bind before bytes do
const lutAddresses: Address[] = [lendingMarket];

function kaminoBank(): BankType {
  const base = premiumBank({ config: { assetTag: AssetTag.KAMINO } });
  const reserve = addr();
  const obligation = addr();
  const reserveState = {
    lendingMarket,
    farmCollateral: addr(),
    liquidity: { supplyVault: addr() },
    collateral: { mintPubkey: addr(), supplyVault: addr() },
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
  const base = premiumBank();
  return {
    ...base,
    config: {
      ...base.config,
      oracleSetup: OracleSetup.PythLST,
      oracleKeys: [base.oracleKey, addr()],
    },
  } as BankType;
}

const kaminoTarget = kaminoBank();
const heldKamino = [kaminoBank(), kaminoBank(), kaminoBank()];
const lsts = Array.from({ length: 11 }, lstBank);
const kaminoDebt = premiumBank();
const largeBanks = [kaminoTarget, ...heldKamino, ...lsts, kaminoDebt];
const largeBankMap = new Map<string, BankType>(largeBanks.map((b) => [b.address, b]));
const kaminoMetadataMap = Object.fromEntries(
  [kaminoTarget, ...heldKamino].map((b) => [
    b.address,
    { kaminoStates: { reserveState: reserves.get(b.address) } },
  ])
) as unknown as BankIntegrationMetadataMap;

function kaminoDeposit(marginfiAccount: MarginfiAccountType) {
  const txFormat: TransactionFormat = {
    version: 0,
    luts: {
      [addr()]: [
        ...lutAddresses,
        marginfiAccount.address,
        marginfiAccount.group,
        ...largeBanks.flatMap((b) => [b.address, b.mint, b.liquidityVault, ...b.config.oracleKeys]),
      ],
    },
  };
  return makeDepositTx({
    programAddress,
    bank: kaminoTarget,
    tokenProgram,
    amount: 10,
    marginfiAccount,
    authority: createNoopSigner(marginfiAccount.authority),
    rpc,
    txFormat,
    latestBlockhash: LATEST_BLOCKHASH,
    bankMap: largeBankMap,
    bankMetadataMap: kaminoMetadataMap,
  });
}

describe("makeDepositTx", () => {
  it("closes the orders in front of the deposit, with the rent back to the authority", async () => {
    const toClose = orders(2);
    const [first, second, ...rest] = ixsOf(
      await deposit(borrower, sol, { ordersToClose: toClose })
    );

    expect([first, second].every(isClose)).toBe(true);
    // close_order accounts: group, marginfi_account, authority, order, fee_recipient
    expect([first, second].map((ix) => keys(ix)[3])).toEqual(toClose);
    expect(keys(first)[4]).toBe(borrower.authority);
    expect(rest.some(isClose)).toBe(false);
  });

  it("leaves the deposit as it is without orders to close", async () => {
    expect(ixsOf(await deposit(borrower, sol)).some(isClose)).toBe(false);
  });

  it("keeps the premium refresh after the closes while both fit", async () => {
    const ixs = ixsOf(await deposit(borrower, sol, { ordersToClose: orders(1) }));

    expect(isClose(ixs[0])).toBe(true);
    expect(isPulse(ixs[ixs.length - 1])).toBe(true);
  });

  it("drops the premium refresh, never a close, once both don't fit", async () => {
    let count = 0;
    let ixs: readonly Instruction[];
    do {
      count++;
      ixs = ixsOf(await deposit(borrower, sol, { ordersToClose: orders(count) }));
    } while (ixs.some(isPulse));

    expect(ixs.filter(isClose)).toHaveLength(count);
  });

  it("throws ORDER_CLOSES_DONT_FIT when the closes don't fit next to the deposit", async () => {
    const toClose = orders(30);

    await expect(deposit(borrower, sol, { ordersToClose: toClose })).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.ORDER_CLOSES_DONT_FIT,
      details: { orderAddresses: toClose },
    });
  });

  it("adds pulse_health while premium-bearing debt exists, with the deposited bank in it", async () => {
    const tx = await deposit(borrower, usdt);
    const pulse = lastIx(tx);

    expect(isPulse(pulse)).toBe(true);
    expect(keys(pulse).slice(0, 2)).toEqual([borrower.address, borrower.group]);
    expect(keys(pulse)).toEqual(expect.arrayContaining([sol, usdc, usdt].map((b) => b.address)));
  });

  it("adds no pulse without premium-bearing debt", async () => {
    const noPremiumDebt = makeAccount([asset(sol), debt(inactive)]);
    expect(hasPulse(await deposit(noPremiumDebt, usdt))).toBe(false);
    expect(hasPulse(await deposit(makeAccount([asset(sol)]), usdt))).toBe(false);
  });

  it("skips the pulse with opts.skipPremiumRefresh", async () => {
    const tx = await deposit(borrower, usdt, { opts: { skipPremiumRefresh: true } });
    expect(hasPulse(tx)).toBe(false);
  });

  it("keeps the pulse on a Kamino deposit while it fits", async () => {
    const small = makeAccount([asset(heldKamino[0]), debt(kaminoDebt)]);
    expect(hasPulse(await kaminoDeposit(small))).toBe(true);
  });

  it("drops the pulse when it would push a Kamino deposit past the account-lock limit", async () => {
    const large = makeAccount([...heldKamino.map(asset), ...lsts.map(asset), debt(kaminoDebt)]);
    const tx = await kaminoDeposit(large);

    expect(hasPulse(tx)).toBe(false);
    expect(getTotalAccountKeys(tx.message)).toBeLessThanOrEqual(MAX_ACCOUNT_LOCKS);
  });
});

describe("makeDepositIx", () => {
  it("matches the v2.8.3 instructions for a deposit", async () => {
    const ixs = await makeDepositIx({
      ...depositParams,
      bank: mainnetBanks.default,
      amount: 12.345678,
    });
    expect(toWire(ixs)).toEqual(v283Cases.deposit);
  });

  it("matches the v2.8.3 instructions for a SOL deposit, wrapping SOL net of the wSOL balance", async () => {
    const ixs = await makeDepositIx({
      ...depositParams,
      bank: mainnetBanks.sol,
      amount: 1.5,
      opts: { wSolBalanceUi: 0.25 },
    });
    expect(toWire(ixs)).toEqual(v283Cases.depositSolWrap);
  });

  it("matches the v2.8.3 instructions for a Drift deposit", async () => {
    const ixs = await makeDepositIx({ ...depositParams, bank: mainnetBanks.drift, amount: 3 });
    expect(toWire(ixs)).toEqual(v283Cases.driftDeposit);
  });

  it("matches the v2.8.3 instructions for a JupLend deposit", async () => {
    const ixs = await makeDepositIx({ ...depositParams, bank: mainnetBanks.juplend, amount: 9 });
    expect(toWire(ixs)).toEqual(v283Cases.juplendDeposit);
  });
});
