import {
  AccountRole,
  createNoopSigner,
  getAddressDecoder,
  isSignerRole,
  isWritableRole,
  type AccountMeta,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";

import instructions from "~/instructions";

// Wire format recorded from the Anchor 0.30 builders these replaced; never update with `-u`.

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const signer = (fill: number) => createNoopSigner(key(fill));
const wrapped = (fill: number) => ({ value: new Uint8Array(16).fill(fill) });

const toWire = (ix: Instruction) => ({
  programId: ix.programAddress,
  keys: (ix.accounts ?? []).map((a) => [a.address, isSignerRole(a.role), isWritableRole(a.role)]),
  data: Buffer.from(ix.data ?? []).toString("hex"),
});

const programAddress = key(200);
const remaining: AccountMeta[] = [
  { address: key(180), role: AccountRole.READONLY },
  { address: key(181), role: AccountRole.WRITABLE },
];

const group = key(1);
const authority = signer(2);
const marginfiAccount = key(3);
const bank = key(4);
const tokenAccount = key(5);
const liquidityVault = key(6);
const tokenProgram = key(7);
const feePayer = signer(8);
const mint = key(9);
const integrationAcc1 = key(10);
const integrationAcc2 = key(11);
const integrationAcc3 = key(12);

const juplendAccounts = {
  group,
  marginfiAccount,
  authority,
  bank,
  mint,
  integrationAcc1,
  fTokenMint: key(28),
  integrationAcc2,
  lendingAdmin: key(20),
  supplyTokenReservesLiquidity: key(21),
  lendingSupplyPositionOnLiquidity: key(22),
  rateModel: key(23),
  vault: key(24),
  liquidity: key(25),
  liquidityProgram: key(26),
  rewardsRateModel: key(27),
  tokenProgram,
};

const kaminoAccounts = {
  group,
  marginfiAccount,
  authority,
  bank,
  integrationAcc1,
  integrationAcc2,
  mint,
  lendingMarket: key(30),
  lendingMarketAuthority: key(31),
  reserveLiquiditySupply: key(32),
  reserveCollateralMint: key(33),
  liquidityTokenProgram: tokenProgram,
};

const driftAccounts = {
  group,
  marginfiAccount,
  authority,
  bank,
  liquidityVault,
  integrationAcc1,
  integrationAcc2,
  integrationAcc3,
  mint,
  driftState: key(40),
  driftSpotMarketVault: key(41),
  tokenProgram,
};

const interestRateConfig = (fill: number) => ({
  insuranceFeeFixedApr: wrapped(fill),
  insuranceIrFee: wrapped(fill + 1),
  protocolFixedFeeApr: wrapped(fill + 2),
  protocolIrFee: wrapped(fill + 3),
  protocolOriginationFee: wrapped(fill + 4),
  zeroUtilRate: 10,
  hundredUtilRate: 20,
  points: Array.from({ length: 5 }, (_, i) => ({ util: i, rate: i * 2 })),
});

const cases: Record<string, () => Promise<Instruction>> = {
  makeInitMarginfiAccountIx: () =>
    instructions.makeInitMarginfiAccountIx(programAddress, {
      marginfiGroup: group,
      marginfiAccount: signer(3),
      authority,
      feePayer,
    }),
  "makeInitMarginfiAccountPdaIx thirdPartyId none": () =>
    instructions.makeInitMarginfiAccountPdaIx(programAddress, {
      marginfiGroup: group,
      marginfiAccount,
      authority,
      feePayer,
      accountIndex: 3,
      thirdPartyId: null,
    }),
  "makeInitMarginfiAccountPdaIx thirdPartyId some": () =>
    instructions.makeInitMarginfiAccountPdaIx(programAddress, {
      marginfiGroup: group,
      marginfiAccount,
      authority,
      feePayer,
      accountIndex: 3,
      thirdPartyId: 7,
    }),
  makeJuplendDepositIx: () =>
    instructions.makeJuplendDepositIx(
      programAddress,
      { ...juplendAccounts, signerTokenAccount: tokenAccount, liquidityVault, amount: 1234n },
      remaining
    ),
  "makeJuplendWithdrawIx withdrawAll none": () =>
    instructions.makeJuplendWithdrawIx(
      programAddress,
      {
        ...juplendAccounts,
        destinationTokenAccount: tokenAccount,
        claimAccount: key(29),
        integrationAcc3,
        amount: 1234n,
        withdrawAll: null,
      },
      remaining
    ),
  "makeJuplendWithdrawIx withdrawAll true": () =>
    instructions.makeJuplendWithdrawIx(
      programAddress,
      {
        ...juplendAccounts,
        destinationTokenAccount: tokenAccount,
        claimAccount: key(29),
        integrationAcc3,
        amount: 1234n,
        withdrawAll: true,
      },
      remaining
    ),
  "makeKaminoDepositIx farms, refresh none": () =>
    instructions.makeKaminoDepositIx(
      programAddress,
      {
        ...kaminoAccounts,
        signerTokenAccount: tokenAccount,
        liquidityVault,
        reserveDestinationDepositCollateral: key(34),
        obligationFarmUserState: key(35),
        reserveFarmState: key(36),
        amount: 1234n,
        refreshReserve: null,
      },
      remaining
    ),
  "makeKaminoDepositIx no farms, refresh true": () =>
    instructions.makeKaminoDepositIx(
      programAddress,
      {
        ...kaminoAccounts,
        signerTokenAccount: tokenAccount,
        liquidityVault,
        reserveDestinationDepositCollateral: key(34),
        amount: 1234n,
        refreshReserve: true,
      },
      remaining
    ),
  "makeDriftDepositIx oracle": () =>
    instructions.makeDriftDepositIx(programAddress, {
      ...driftAccounts,
      signerTokenAccount: tokenAccount,
      driftOracle: key(42),
      amount: 1234n,
    }),
  "makeDriftDepositIx no oracle": () =>
    instructions.makeDriftDepositIx(programAddress, {
      ...driftAccounts,
      signerTokenAccount: tokenAccount,
      amount: 1234n,
    }),
  "makeDepositIx depositUpToLimit none": () =>
    instructions.makeDepositIx(
      programAddress,
      {
        group,
        marginfiAccount,
        authority,
        bank,
        signerTokenAccount: tokenAccount,
        liquidityVault,
        tokenProgram,
        amount: 1234n,
        depositUpToLimit: null,
      },
      remaining
    ),
  "makeDepositIx depositUpToLimit true": () =>
    instructions.makeDepositIx(
      programAddress,
      {
        group,
        marginfiAccount,
        authority,
        bank,
        signerTokenAccount: tokenAccount,
        liquidityVault,
        tokenProgram,
        amount: 1234n,
        depositUpToLimit: true,
      },
      remaining
    ),
  "makeRepayIx repayAll true": () =>
    instructions.makeRepayIx(
      programAddress,
      {
        group,
        marginfiAccount,
        authority,
        bank,
        signerTokenAccount: tokenAccount,
        liquidityVault,
        tokenProgram,
        amount: 1234n,
        repayAll: true,
      },
      remaining
    ),
  "makeDriftWithdrawIx rewards, withdrawAll true": () =>
    instructions.makeDriftWithdrawIx(
      programAddress,
      {
        ...driftAccounts,
        destinationTokenAccount: tokenAccount,
        driftSigner: key(43),
        driftOracle: key(42),
        driftRewardOracle: key(44),
        driftRewardSpotMarket: key(45),
        driftRewardMint: key(46),
        driftRewardOracle2: key(47),
        driftRewardSpotMarket2: key(48),
        driftRewardMint2: key(49),
        amount: 1234n,
        withdrawAll: true,
      },
      remaining
    ),
  "makeDriftWithdrawIx no rewards, withdrawAll false": () =>
    instructions.makeDriftWithdrawIx(
      programAddress,
      {
        ...driftAccounts,
        destinationTokenAccount: tokenAccount,
        driftSigner: key(43),
        amount: 1234n,
        withdrawAll: false,
      },
      remaining
    ),
  ...Object.fromEntries(
    [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ].map(([isFinalWithdrawal, refreshReserve]) => [
      `makeKaminoWithdrawIx final=${isFinalWithdrawal} refresh=${refreshReserve}`,
      () =>
        instructions.makeKaminoWithdrawIx(
          programAddress,
          {
            ...kaminoAccounts,
            destinationTokenAccount: tokenAccount,
            liquidityVault,
            reserveSourceCollateral: key(34),
            obligationFarmUserState: isFinalWithdrawal ? undefined : key(35),
            reserveFarmState: isFinalWithdrawal ? undefined : key(36),
            amount: 1234n,
            isFinalWithdrawal,
            refreshReserve,
          },
          remaining
        ),
    ])
  ),
  "makeWithdrawIx withdrawAll true": () =>
    instructions.makeWithdrawIx(
      programAddress,
      {
        group,
        marginfiAccount,
        authority,
        bank,
        destinationTokenAccount: tokenAccount,
        liquidityVault,
        tokenProgram,
        amount: 1234n,
        withdrawAll: true,
      },
      remaining
    ),
  makeBorrowIx: () =>
    instructions.makeBorrowIx(
      programAddress,
      {
        group,
        marginfiAccount,
        authority,
        bank,
        destinationTokenAccount: tokenAccount,
        liquidityVault,
        tokenProgram,
        amount: 18446744073709551615n,
      },
      remaining
    ),
  makeLendingAccountLiquidateIx: () =>
    instructions.makeLendingAccountLiquidateIx(
      programAddress,
      {
        group,
        assetBank: key(50),
        liabBank: key(51),
        liquidatorMarginfiAccount: key(52),
        authority,
        liquidateeMarginfiAccount: key(53),
        tokenProgram,
        assetAmount: 1234n,
        liquidateeAccounts: 4,
        liquidatorAccounts: 6,
      },
      remaining
    ),
  makePoolConfigureBankIx: () =>
    instructions.makePoolConfigureBankIx(programAddress, {
      group,
      admin: authority,
      bank,
      bankConfigOpt: {
        assetWeightInit: wrapped(1),
        assetWeightMaint: null,
        liabilityWeightInit: wrapped(2),
        liabilityWeightMaint: null,
        depositLimit: 1_000_000n,
        borrowLimit: null,
        operationalState: 1,
        interestRateConfig: interestRateConfig(3),
        riskTier: 1,
        assetTag: 2,
        totalAssetValueInitLimit: null,
        oracleMaxConfidence: 100,
        oracleMaxAge: 60,
        permissionlessBadDebtSettlement: true,
        freezeSettings: false,
        tokenlessRepaymentsAllowed: null,
        liquidationLiquidatorFee: null,
        liquidationInsuranceFee: null,
        circuitBreakerEnabled: null,
        cbDeviationBpsTiers: null,
        cbTierDurationsSeconds: null,
        cbEscalationWindowMult: null,
        cbEmaAlphaBps: null,
        cbWindowSeconds: null,
        cbWindowMaxUpBps: null,
        cbWindowMaxDownBps: null,
      },
    }),
  makeBeginFlashLoanIx: () =>
    instructions.makeBeginFlashLoanIx(programAddress, { marginfiAccount, authority, endIndex: 5 }),
  makeEndFlashLoanIx: () =>
    instructions.makeEndFlashLoanIx(
      programAddress,
      { marginfiAccount, group, authority },
      remaining
    ),
  makeAccountTransferToNewAccountIx: () =>
    instructions.makeAccountTransferToNewAccountIx(programAddress, {
      group,
      oldMarginfiAccount: marginfiAccount,
      newMarginfiAccount: signer(60),
      authority,
      feePayer,
      newAuthority: key(61),
      globalFeeWallet: key(62),
    }),
  makeGroupInitIx: () =>
    instructions.makeGroupInitIx(programAddress, { marginfiGroup: signer(1), admin: authority }),
  makeLendingPoolConfigureBankOracleIx: () =>
    instructions.makeLendingPoolConfigureBankOracleIx(
      programAddress,
      { group, admin: authority, bank, setup: 3, oracle: key(70) },
      remaining
    ),
  makeLendingPoolConfigureBankOracleScopeIx: () =>
    instructions.makeLendingPoolConfigureBankOracleScopeIx(programAddress, {
      group,
      admin: authority,
      bank,
      oracle: key(71),
      entryIndex: 511,
    }),
  makeLendingPoolSetOraclePriceIx: () =>
    instructions.makeLendingPoolSetOraclePriceIx(
      programAddress,
      { group, admin: authority, bank, price: wrapped(9), setup: 11 },
      remaining
    ),
  ...Object.fromEntries(
    (
      [
        ["seed default", undefined],
        ["seed 9", 9n],
      ] as const
    ).map(([label, bankSeed]) => [
      `makePoolAddPermissionlessStakedBankIx ${label}`,
      () =>
        instructions.makePoolAddPermissionlessStakedBankIx(
          programAddress,
          {
            marginfiGroup: group,
            stakedSettings: key(80),
            feePayer,
            bankMint: mint,
            solPool: key(81),
            poolOnramp: key(82),
            stakePool: key(83),
            validatorVoteAccount: key(84),
            tokenProgram,
            bankSeed,
          },
          remaining
        ),
    ])
  ),
  makePoolAddBankIx: () =>
    instructions.makePoolAddBankIx(programAddress, {
      marginfiGroup: group,
      admin: authority,
      feePayer,
      globalFeeWallet: key(62),
      bankMint: mint,
      bank: signer(4),
      tokenProgram,
      bankConfig: {
        assetWeightInit: wrapped(1),
        assetWeightMaint: wrapped(2),
        liabilityWeightInit: wrapped(3),
        liabilityWeightMaint: wrapped(4),
        depositLimit: 1_000_000n,
        interestRateConfig: interestRateConfig(5),
        operationalState: 1,
        borrowLimit: 500_000n,
        riskTier: 0,
        assetTag: 1,
        totalAssetValueInitLimit: 9_000_000n,
        oracleMaxAge: 60,
        oracleMaxConfidence: 100,
      },
    }),
  makeCloseAccountIx: () =>
    instructions.makeCloseAccountIx(programAddress, { marginfiAccount, authority, feePayer }),
  makePulseHealthIx: () =>
    instructions.makePulseHealthIx(programAddress, { marginfiAccount, group }, remaining),
};

describe("marginfi instruction wire format", () => {
  it.each(Object.entries(cases))("%s", async (_, build) => {
    expect(toWire(await build())).toMatchSnapshot();
  });

  it("covers every exported builder", () => {
    const covered = new Set(Object.keys(cases).map((name) => name.split(" ")[0]));
    expect([...covered].sort()).toEqual(Object.keys(instructions).sort());
  });
});
