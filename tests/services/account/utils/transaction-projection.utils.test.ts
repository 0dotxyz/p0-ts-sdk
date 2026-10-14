import {
  address,
  createNoopSigner,
  getBase64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { BigNumber } from "bignumber.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import accountFixtures from "../../../fixtures/mainnet-accounts.json";
import { addr, key } from "../../../helpers/addresses";
import { mainnetBankMap, mainnetBanks } from "../../../helpers/mainnet";
import { makeDebt, makePremiumBank, NOW, usdc, YEAR } from "../../../helpers/premium";

import { DEFAULT_ADDRESS } from "~/constants";
import instructions from "~/instructions";
import { BalanceType, MarginfiAccountType } from "~/services/account/types";
import { decodeMarginfiAccount } from "~/services/account/utils/deserialize.utils";
import { computeBalancePremium } from "~/services/account/utils/premium.utils";
import { balanceToDto } from "~/services/account/utils/serialize.utils";
import {
  computeHealthAccounts,
  computeProjectedActiveBalancesNoCpi,
  computeProjectedActiveBanksNoCpi,
} from "~/services/account/utils/transaction-projection.utils";
import { AssetTag, BankType, OracleSetup } from "~/services/bank/types";

const base64 = getBase64Encoder();
const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");

// Mainnet account with 14 active positions, incl. an asset in the default bank fixture and a
// liability in the SOL bank fixture; the other fixture banks become new positions.
const accountFixture = accountFixtures[1];
const account = decodeMarginfiAccount(
  address(accountFixture.address),
  base64.encode(accountFixture.data)
);
const banksMap = mainnetBankMap;

const group = account.group;
const marginfiAccount = account.address;
const authority = createNoopSigner(account.authority);
const tokenAccounts = { liquidityVault: key(6), mint: key(9), tokenProgram: key(7) };
const venue = { group, marginfiAccount, authority, mint: key(9), integrationAcc1: key(10) };
const kamino = {
  ...venue,
  bank: mainnetBanks.kamino.address,
  integrationAcc2: key(11),
  lendingMarket: key(30),
  lendingMarketAuthority: key(31),
  reserveLiquiditySupply: key(32),
  reserveCollateralMint: key(33),
  reserveSourceCollateral: key(34),
  liquidityVault: key(6),
  liquidityTokenProgram: key(7),
  destinationTokenAccount: key(5),
};
const juplend = {
  ...venue,
  bank: mainnetBanks.juplend.address,
  fTokenMint: key(28),
  integrationAcc2: key(11),
  lendingAdmin: key(20),
  supplyTokenReservesLiquidity: key(21),
  lendingSupplyPositionOnLiquidity: key(22),
  rateModel: key(23),
  vault: key(24),
  liquidity: key(25),
  liquidityProgram: key(26),
  rewardsRateModel: key(27),
  liquidityVault: key(6),
  tokenProgram: key(7),
};

async function buildInstructions(): Promise<Instruction[]> {
  return [
    await instructions.makeDepositIx(programAddress, {
      ...tokenAccounts,
      group,
      marginfiAccount,
      authority,
      bank: mainnetBanks.default.address,
      signerTokenAccount: key(5),
      amount: 1_000_000n,
      depositUpToLimit: null,
    }),
    await instructions.makeRepayIx(programAddress, {
      ...tokenAccounts,
      group,
      marginfiAccount,
      authority,
      bank: mainnetBanks.sol.address,
      signerTokenAccount: key(5),
      amount: 100_000n,
      repayAll: null,
    }),
    // Different marginfi account: ignored
    await instructions.makeDepositIx(programAddress, {
      ...tokenAccounts,
      group,
      marginfiAccount: key(99),
      authority,
      bank: mainnetBanks.drift.address,
      signerTokenAccount: key(5),
      amount: 7n,
      depositUpToLimit: null,
    }),
    await instructions.makeKaminoDepositIx(programAddress, {
      ...kamino,
      signerTokenAccount: key(5),
      reserveDestinationDepositCollateral: key(34),
      amount: 3_000_000n,
      refreshReserve: null,
    }),
    await instructions.makeJuplendDepositIx(programAddress, {
      ...juplend,
      signerTokenAccount: key(5),
      amount: 9_000_000n,
    }),
    await instructions.makeJuplendWithdrawIx(
      programAddress,
      {
        ...juplend,
        destinationTokenAccount: key(5),
        claimAccount: key(29),
        integrationAcc3: key(12),
        amount: 2_000_000n,
        withdrawAll: null,
      },
      []
    ),
    // withdraw-all via kaminoWithdraw's flags bit 0
    await instructions.makeKaminoWithdrawIx(
      programAddress,
      {
        ...kamino,
        amount: 0n,
        isFinalWithdrawal: true,
        refreshReserve: false,
      },
      []
    ),
    await instructions.makeWithdrawIx(
      programAddress,
      {
        ...tokenAccounts,
        group,
        marginfiAccount,
        authority,
        bank: mainnetBanks.default.address,
        destinationTokenAccount: key(5),
        amount: 500_000n,
        withdrawAll: null,
      },
      []
    ),
  ];
}

// Matches the v2.8.3 (Anchor-decoding) projection for the same instruction bytes.
describe("transaction projection", () => {
  it("projects which banks stay active", async () => {
    const projected = computeProjectedActiveBanksNoCpi({
      account,
      instructions: await buildInstructions(),
      programAddress,
    });

    expect(projected).toContain(mainnetBanks.juplend.address);
    expect(projected).not.toContain(mainnetBanks.kamino.address);
    expect(projected).not.toContain(mainnetBanks.drift.address);
    expect(projected).toMatchSnapshot();
  });

  it("projects balance shares through deposits, repays and withdraws", async () => {
    const result = computeProjectedActiveBalancesNoCpi({
      account,
      instructions: await buildInstructions(),
      programAddress,
      banksMap,
      assetShareValueMultiplierByBank: new Map([
        [mainnetBanks.kamino.address, new BigNumber(1.2345)],
        [mainnetBanks.juplend.address, new BigNumber(1.011)],
      ]),
    });

    expect(result.withdrawnBanks).toEqual([
      mainnetBanks.juplend.address,
      mainnetBanks.kamino.address,
      mainnetBanks.default.address,
    ]);
    expect({
      ...result,
      projectedBalances: result.projectedBalances.map(balanceToDto),
    }).toMatchSnapshot();
  });

  it("closes a balance on repay-all whatever its dust, and never on a partial repay", async () => {
    const repay = (amount: bigint, repayAll: boolean | null) =>
      instructions.makeRepayIx(programAddress, {
        ...tokenAccounts,
        group,
        marginfiAccount,
        authority,
        bank: mainnetBanks.sol.address,
        signerTokenAccount: key(5),
        amount,
        repayAll,
      });
    const projectedSol = (balances: typeof account.balances, ix: Instruction) =>
      computeProjectedActiveBalancesNoCpi({
        account: { ...account, balances },
        instructions: [ix],
        programAddress,
        banksMap,
        assetShareValueMultiplierByBank: new Map(),
      }).projectedBalances.find((balance) => balance.bankPk === mainnetBanks.sol.address);

    const withAssetDust = account.balances.map((balance) =>
      balance.bankPk === mainnetBanks.sol.address
        ? { ...balance, assetShares: new BigNumber(0.000001) }
        : balance
    );
    expect(projectedSol(withAssetDust, await repay(0n, true))).toBeUndefined();
    expect(projectedSol(account.balances, await repay(10n ** 18n, null))?.active).toBe(true);
  });
});

describe("computeHealthAccounts", () => {
  const KEYS = Array.from({ length: 5 }, addr);

  function bank(opts: {
    oracleSetup: OracleSetup;
    assetTag: AssetTag;
    oracleKeys?: Address[];
  }): BankType {
    const oracleKeys = opts.oracleKeys ?? KEYS;
    return {
      address: addr(),
      oracleKey: oracleKeys[0],
      config: {
        oracleSetup: opts.oracleSetup,
        assetTag: opts.assetTag,
        oracleKeys,
      },
    } as unknown as BankType;
  }

  // Risk account keys for a single bank, via the public health-accounts entry point
  function riskAccountKeys(b: BankType): Address[] {
    return computeHealthAccounts(new Map([[b.address, b]]), [b.address]);
  }

  it("keeps the default [bank, oracle] shape for plain pyth banks (regression)", () => {
    const b = bank({ oracleSetup: OracleSetup.PythPushOracle, assetTag: AssetTag.DEFAULT });
    expect(riskAccountKeys(b)).toEqual([b.address, KEYS[0]]);
  });

  it("keeps the venue [bank, oracle, keys[1]] shape for kamino banks (regression)", () => {
    const b = bank({ oracleSetup: OracleSetup.KaminoPythPush, assetTag: AssetTag.KAMINO });
    expect(riskAccountKeys(b)).toEqual([b.address, KEYS[0], KEYS[1]]);
  });

  it("appends the pricing account at keys[1] for plain multiplier setups", () => {
    for (const oracleSetup of [OracleSetup.PythMSOL, OracleSetup.PythLST, OracleSetup.PTPyth]) {
      const b = bank({ oracleSetup, assetTag: AssetTag.DEFAULT });
      expect(riskAccountKeys(b)).toEqual([b.address, KEYS[0], KEYS[1]]);
    }
  });

  it("appends the pricing account at keys[2] after the venue account for venue multiplier setups", () => {
    const venueCases: [OracleSetup, AssetTag][] = [
      [OracleSetup.KaminoMSOL, AssetTag.KAMINO],
      [OracleSetup.KaminoLST, AssetTag.KAMINO],
      [OracleSetup.JuplendMSOL, AssetTag.JUPLEND],
      [OracleSetup.JuplendLST, AssetTag.JUPLEND],
    ];
    for (const [oracleSetup, assetTag] of venueCases) {
      const b = bank({ oracleSetup, assetTag });
      expect(riskAccountKeys(b)).toEqual([b.address, KEYS[0], KEYS[1], KEYS[2]]);
    }
  });

  it("always passes the staked on-ramp slot, empty when the bank isn't backfilled", () => {
    const backfilled = bank({
      oracleSetup: OracleSetup.StakedWithPythPush,
      assetTag: AssetTag.STAKED,
    });
    expect(riskAccountKeys(backfilled)).toEqual([
      backfilled.address,
      KEYS[0],
      KEYS[1],
      KEYS[2],
      KEYS[3],
    ]);

    const notBackfilled = bank({
      oracleSetup: OracleSetup.StakedWithPythPush,
      assetTag: AssetTag.STAKED,
      oracleKeys: [KEYS[0], KEYS[1], KEYS[2], DEFAULT_ADDRESS, DEFAULT_ADDRESS],
    });
    expect(riskAccountKeys(notBackfilled)).toEqual([
      notBackfilled.address,
      KEYS[0],
      KEYS[1],
      KEYS[2],
      DEFAULT_ADDRESS,
    ]);
  });

  it("needs no extra accounts for Scope and PTFixed", () => {
    for (const oracleSetup of [OracleSetup.Scope, OracleSetup.PTFixed]) {
      const b = bank({ oracleSetup, assetTag: AssetTag.DEFAULT });
      expect(riskAccountKeys(b)).toEqual([b.address, KEYS[0]]);
    }
  });
});

describe("computeProjectedActiveBalancesNoCpi", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function projectRepay(balance: BalanceType, b: BankType, amount: number, repayAll = false) {
    const debtor = {
      address: addr(),
      balances: [balance],
    } as unknown as MarginfiAccountType;
    const ix = await instructions.makeRepayIx(programAddress, {
      group: addr(),
      marginfiAccount: debtor.address,
      authority: createNoopSigner(addr()),
      signerTokenAccount: addr(),
      bank: b.address,
      liquidityVault: addr(),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      mint: b.mint,
      amount: BigInt(usdc(amount).toFixed()),
      repayAll,
    });
    return computeProjectedActiveBalancesNoCpi({
      account: debtor,
      instructions: [ix],
      programAddress,
      banksMap: new Map([[b.address, b]]),
      assetShareValueMultiplierByBank: new Map(),
    }).projectedBalances[0];
  }

  it("settles premium before principal on repay (vb03: repay 4 of 10 premium, shares unchanged)", async () => {
    const b = makePremiumBank();
    const balance = makeDebt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    const projected = await projectRepay(balance, b, 4);
    expect(projected.liabilityShares.toNumber()).toBe(usdc(1000).toNumber());
    expect(projected.premiumOutstanding.toNumber()).toBe(usdc(6).toNumber());
    expect(computeBalancePremium(projected, b, NOW).toNumber()).toBe(usdc(6).toNumber());
  });

  it("repays principal with whatever exceeds the premium", async () => {
    const b = makePremiumBank();
    const balance = makeDebt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    const projected = await projectRepay(balance, b, 110);
    expect(projected.premiumOutstanding.isZero()).toBe(true);
    expect(projected.liabilityShares.toNumber()).toBe(usdc(900).toNumber());
  });

  it("clears the premium on repay-all", async () => {
    const b = makePremiumBank();
    const balance = makeDebt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    const projected = await projectRepay(balance, b, 0, true);
    expect(projected.active).toBe(false);
    expect(projected.premiumOutstanding.isZero()).toBe(true);
    expect(projected.premiumRate.isZero()).toBe(true);
  });
});
