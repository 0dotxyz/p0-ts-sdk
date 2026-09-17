import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { address, createNoopSigner, isSignerRole, isWritableRole } from "@solana/kit";
import { AccountMeta, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { describe, expect, it } from "vitest";

import { getLendingAccountDepositInstruction } from "~/generated/marginfi";
import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import instructions from "~/instructions";
import type { BankConfigCompactRaw, BankConfigOptRaw } from "~/services";
import type { MarginfiProgram, Wallet } from "~/types";

const key = (fill: number) => new PublicKey(new Uint8Array(32).fill(fill));

const rpcStub = new Proxy({} as Connection, {
  get: (_, prop) => {
    throw new Error(`instruction builders must not touch the RPC (accessed ${String(prop)})`);
  },
});

const program = new Program<MarginfiIdlType>(
  { ...MARGINFI_IDL, address: key(200).toBase58() },
  new AnchorProvider(rpcStub, {} as Wallet, {})
) as unknown as MarginfiProgram;

const remaining: AccountMeta[] = [
  { pubkey: key(180), isSigner: false, isWritable: false },
  { pubkey: key(181), isSigner: false, isWritable: true },
];

const wrapped = (fill: number) => ({ value: new Array(16).fill(fill) });

const toWire = (ix: TransactionInstruction) => ({
  programId: ix.programId.toBase58(),
  keys: ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
  data: ix.data.toString("hex"),
});

const group = key(1);
const authority = key(2);
const marginfiAccount = key(3);
const bank = key(4);
const tokenAccount = key(5);
const liquidityVault = key(6);
const tokenProgram = key(7);
const feePayer = key(8);
const mint = key(9);
const integrationAcc1 = key(10);
const integrationAcc2 = key(11);
const integrationAcc3 = key(12);

const juplendAccounts = {
  marginfiAccount,
  bank,
  lendingAdmin: key(20),
  supplyTokenReservesLiquidity: key(21),
  lendingSupplyPositionOnLiquidity: key(22),
  rateModel: key(23),
  vault: key(24),
  liquidity: key(25),
  liquidityProgram: key(26),
  rewardsRateModel: key(27),
  tokenProgram,
  group,
  authority,
  mint,
  integrationAcc1,
  fTokenMint: key(28),
  integrationAcc2,
};

// Accounts Anchor resolves from IDL `relations` over RPC; the builder types don't expose them,
// but the builders forward unknown keys to `accountsPartial`.
const bankRelations = { liquidityVault, mint, integrationAcc1, integrationAcc2, integrationAcc3 };
const flashloanRelations = { group };

const kaminoAccounts = {
  marginfiAccount,
  bank,
  lendingMarket: key(30),
  lendingMarketAuthority: key(31),
  reserveLiquiditySupply: key(32),
  reserveCollateralMint: key(33),
  liquidityTokenProgram: tokenProgram,
  group,
  authority,
};

const driftAccounts = {
  marginfiAccount,
  bank,
  driftState: key(40),
  driftSpotMarketVault: key(41),
  tokenProgram,
  group,
  authority,
};

const bankConfigOpt: BankConfigOptRaw = {
  assetWeightInit: wrapped(1),
  assetWeightMaint: null,
  liabilityWeightInit: wrapped(2),
  liabilityWeightMaint: null,
  depositLimit: new BN(1_000_000),
  borrowLimit: null,
  operationalState: { operational: {} },
  interestRateConfig: {
    insuranceFeeFixedApr: wrapped(3),
    insuranceIrFee: wrapped(4),
    protocolFixedFeeApr: wrapped(5),
    protocolIrFee: wrapped(6),
    protocolOriginationFee: wrapped(7),
    zeroUtilRate: 10,
    hundredUtilRate: 20,
    points: Array.from({ length: 5 }, (_, i) => ({ util: i, rate: i * 2 })),
  },
  riskTier: { isolated: {} },
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
};

const bankConfigCompact = {
  assetWeightInit: wrapped(1),
  assetWeightMaint: wrapped(2),
  liabilityWeightInit: wrapped(3),
  liabilityWeightMaint: wrapped(4),
  depositLimit: new BN(1_000_000),
  interestRateConfig: {
    insuranceFeeFixedApr: wrapped(5),
    insuranceIrFee: wrapped(6),
    protocolFixedFeeApr: wrapped(7),
    protocolIrFee: wrapped(8),
    protocolOriginationFee: wrapped(9),
    zeroUtilRate: 10,
    hundredUtilRate: 20,
    points: Array.from({ length: 5 }, (_, i) => ({ util: i, rate: i * 2 })),
  },
  operationalState: { operational: {} },
  borrowLimit: new BN(500_000),
  riskTier: { collateral: {} },
  assetTag: 1,
  totalAssetValueInitLimit: new BN(9_000_000),
  oracleMaxAge: 60,
  oracleMaxConfidence: 100,
} as BankConfigCompactRaw;

const cases: Record<string, () => Promise<TransactionInstruction> | TransactionInstruction> = {
  makeInitMarginfiAccountIx: () =>
    instructions.makeInitMarginfiAccountIx(program, {
      marginfiGroup: group,
      marginfiAccount,
      authority,
      feePayer,
    }),
  "makeInitMarginfiAccountPdaIx thirdPartyId none": () =>
    instructions.makeInitMarginfiAccountPdaIx(
      program,
      { marginfiGroup: group, marginfiAccount, authority, feePayer },
      { accountIndex: 3 }
    ),
  "makeInitMarginfiAccountPdaIx thirdPartyId some": () =>
    instructions.makeInitMarginfiAccountPdaIx(
      program,
      { marginfiGroup: group, marginfiAccount, authority, feePayer },
      { accountIndex: 3, thirdPartyId: 7 }
    ),
  makeJuplendDepositIx: () =>
    instructions.makeJuplendDepositIx(
      program,
      { ...juplendAccounts, signerTokenAccount: tokenAccount, liquidityVault },
      { amount: new BN(1234) },
      remaining
    ),
  "makeJuplendWithdrawIx withdrawAll none": () =>
    instructions.makeJuplendWithdrawIx(
      program,
      {
        ...juplendAccounts,
        destinationTokenAccount: tokenAccount,
        claimAccount: key(29),
        integrationAcc3,
      },
      { amount: new BN(1234) },
      remaining
    ),
  "makeJuplendWithdrawIx withdrawAll true": () =>
    instructions.makeJuplendWithdrawIx(
      program,
      {
        ...juplendAccounts,
        destinationTokenAccount: tokenAccount,
        claimAccount: key(29),
        integrationAcc3,
      },
      { amount: new BN(1234), withdrawAll: true },
      remaining
    ),
  "makeKaminoDepositIx farms, refresh none": () =>
    instructions.makeKaminoDepositIx(
      program,
      {
        ...kaminoAccounts,
        signerTokenAccount: tokenAccount,
        reserveDestinationDepositCollateral: key(34),
        obligationFarmUserState: key(35),
        reserveFarmState: key(36),
        liquidityVault,
        integrationAcc1,
        integrationAcc2,
        mint,
      },
      { amount: new BN(1234) },
      remaining
    ),
  "makeKaminoDepositIx no farms, refresh true": () =>
    instructions.makeKaminoDepositIx(
      program,
      {
        ...kaminoAccounts,
        signerTokenAccount: tokenAccount,
        reserveDestinationDepositCollateral: key(34),
        obligationFarmUserState: null,
        reserveFarmState: null,
        liquidityVault,
        integrationAcc1,
        integrationAcc2,
        mint,
      },
      { amount: new BN(1234), refreshReserve: true },
      remaining
    ),
  "makeDriftDepositIx oracle": () =>
    instructions.makeDriftDepositIx(
      program,
      {
        ...driftAccounts,
        signerTokenAccount: tokenAccount,
        driftOracle: key(42),
        liquidityVault,
        integrationAcc1,
        integrationAcc2,
        integrationAcc3,
        mint,
      },
      { amount: new BN(1234) }
    ),
  "makeDriftDepositIx no oracle": () =>
    instructions.makeDriftDepositIx(
      program,
      {
        ...driftAccounts,
        signerTokenAccount: tokenAccount,
        driftOracle: null,
        liquidityVault,
        integrationAcc1,
        integrationAcc2,
        integrationAcc3,
        mint,
      },
      { amount: new BN(1234) }
    ),
  "makeDepositIx depositUpToLimit none": () =>
    instructions.makeDepositIx(
      program,
      {
        marginfiAccount,
        signerTokenAccount: tokenAccount,
        bank,
        tokenProgram,
        group,
        authority,
        liquidityVault,
      },
      { amount: new BN(1234) },
      remaining
    ),
  "makeDepositIx depositUpToLimit true": () =>
    instructions.makeDepositIx(
      program,
      {
        marginfiAccount,
        signerTokenAccount: tokenAccount,
        bank,
        tokenProgram,
        group,
        authority,
        liquidityVault,
      },
      { amount: new BN(1234), depositUpToLimit: true },
      remaining
    ),
  "makeRepayIx repayAll true": () =>
    instructions.makeRepayIx(
      program,
      {
        marginfiAccount,
        signerTokenAccount: tokenAccount,
        bank,
        tokenProgram,
        group,
        authority,
        liquidityVault,
      },
      { amount: new BN(1234), repayAll: true },
      remaining
    ),
  "makeDriftWithdrawIx rewards, withdrawAll true": () =>
    instructions.makeDriftWithdrawIx(
      program,
      {
        ...driftAccounts,
        destinationTokenAccount: tokenAccount,
        driftSigner: key(43),
        ...bankRelations,
        driftOracle: key(42),
        driftRewardOracle: key(44),
        driftRewardSpotMarket: key(45),
        driftRewardMint: key(46),
        driftRewardOracle2: key(47),
        driftRewardSpotMarket2: key(48),
        driftRewardMint2: key(49),
      },
      { amount: new BN(1234), withdrawAll: true },
      remaining
    ),
  "makeDriftWithdrawIx no rewards, withdrawAll false": () =>
    instructions.makeDriftWithdrawIx(
      program,
      {
        ...driftAccounts,
        destinationTokenAccount: tokenAccount,
        driftSigner: key(43),
        ...bankRelations,
        driftOracle: null,
        driftRewardOracle: null,
        driftRewardSpotMarket: null,
        driftRewardMint: null,
        driftRewardOracle2: null,
        driftRewardSpotMarket2: null,
        driftRewardMint2: null,
      },
      { amount: new BN(1234), withdrawAll: false },
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
          program,
          {
            ...kaminoAccounts,
            destinationTokenAccount: tokenAccount,
            reserveSourceCollateral: key(34),
            obligationFarmUserState: isFinalWithdrawal ? null : key(35),
            reserveFarmState: isFinalWithdrawal ? null : key(36),
            ...bankRelations,
          },
          { amount: new BN(1234), isFinalWithdrawal, refreshReserve },
          remaining
        ),
    ])
  ),
  "makeWithdrawIx withdrawAll true": () =>
    instructions.makeWithdrawIx(
      program,
      {
        marginfiAccount,
        bank,
        destinationTokenAccount: tokenAccount,
        tokenProgram,
        group,
        authority,
        ...bankRelations,
      },
      { amount: new BN(1234), withdrawAll: true },
      remaining
    ),
  makeBorrowIx: () =>
    instructions.makeBorrowIx(
      program,
      {
        marginfiAccount,
        bank,
        destinationTokenAccount: tokenAccount,
        tokenProgram,
        group,
        authority,
        ...bankRelations,
      },
      { amount: new BN("18446744073709551615") },
      remaining
    ),
  makeLendingAccountLiquidateIx: () =>
    instructions.makeLendingAccountLiquidateIx(
      program,
      {
        assetBank: key(50),
        liabBank: key(51),
        liquidatorMarginfiAccount: key(52),
        liquidateeMarginfiAccount: key(53),
        tokenProgram,
        group,
        authority,
      },
      { assetAmount: new BN(1234), liquidateeAccounts: 4, liquidatorAccounts: 6 },
      remaining
    ),
  makePoolConfigureBankIx: () =>
    instructions.makePoolConfigureBankIx(
      program,
      { bank, group, admin: authority },
      { bankConfigOpt }
    ),
  makeBeginFlashLoanIx: () =>
    instructions.makeBeginFlashLoanIx(
      program,
      { marginfiAccount, authority },
      { endIndex: new BN(5) }
    ),
  makeEndFlashLoanIx: () =>
    instructions.makeEndFlashLoanIx(
      program,
      { marginfiAccount, authority, ...flashloanRelations },
      remaining
    ),
  makeAccountTransferToNewAccountIx: () =>
    instructions.makeAccountTransferToNewAccountIx(program, {
      oldMarginfiAccount: marginfiAccount,
      newMarginfiAccount: key(60),
      newAuthority: key(61),
      globalFeeWallet: key(62),
      feePayer,
      group,
      authority,
    }),
  makeGroupInitIx: () =>
    instructions.makeGroupInitIx(program, { marginfiGroup: group, admin: authority }),
  makeLendingPoolConfigureBankOracleIx: () =>
    instructions.makeLendingPoolConfigureBankOracleIx(
      program,
      { bank, group, admin: authority },
      { setup: 3, feedId: key(70) },
      remaining
    ),
  makeLendingPoolConfigureBankOracleScopeIx: () =>
    instructions.makeLendingPoolConfigureBankOracleScopeIx(
      program,
      { bank, group, admin: authority },
      { oracle: key(71), entryIndex: 511 }
    ),
  makeLendingPoolSetOraclePriceIx: () =>
    instructions.makeLendingPoolSetOraclePriceIx(
      program,
      { bank, group, admin: authority },
      { price: wrapped(9), setup: 11 },
      remaining
    ),
  "makePoolAddPermissionlessStakedBankIx seed default": () =>
    instructions.makePoolAddPermissionlessStakedBankIx(
      program,
      {
        stakedSettings: key(80),
        feePayer,
        bankMint: mint,
        solPool: key(81),
        poolOnramp: key(82),
        stakePool: key(83),
        validatorVoteAccount: key(84),
        marginfiGroup: group,
        tokenProgram,
      },
      remaining,
      {}
    ),
  "makePoolAddPermissionlessStakedBankIx seed 9": () =>
    instructions.makePoolAddPermissionlessStakedBankIx(
      program,
      {
        stakedSettings: key(80),
        feePayer,
        bankMint: mint,
        solPool: key(81),
        poolOnramp: key(82),
        stakePool: key(83),
        validatorVoteAccount: key(84),
        marginfiGroup: group,
        tokenProgram,
      },
      remaining,
      { seed: new BN(9) }
    ),
  makePoolAddBankIx: () =>
    instructions.makePoolAddBankIx(
      program,
      {
        marginfiGroup: group,
        feePayer,
        bankMint: mint,
        bank,
        tokenProgram,
        admin: authority,
        globalFeeWallet: key(62),
      },
      { bankConfig: bankConfigCompact }
    ),
  makeCloseAccountIx: () =>
    instructions.makeCloseAccountIx(program, { marginfiAccount, feePayer, authority }),
  // makePulseHealthIx only forwards marginfiAccount, so `group` can't reach Anchor through it;
  // record the identical method chain with the relation supplied.
  makePulseHealthIx: () =>
    program.methods
      .lendingAccountPulseHealth()
      .accountsPartial({ marginfiAccount, group })
      .remainingAccounts(remaining)
      .instruction(),
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

describe("codama-generated marginfi client", () => {
  it("encodes deposit identically to Anchor", async () => {
    const toAddress = (pk: PublicKey) => address(pk.toBase58());
    const ix = getLendingAccountDepositInstruction(
      {
        group: toAddress(group),
        marginfiAccount: toAddress(marginfiAccount),
        authority: createNoopSigner(toAddress(authority)),
        bank: toAddress(bank),
        signerTokenAccount: toAddress(tokenAccount),
        liquidityVault: toAddress(liquidityVault),
        tokenProgram: toAddress(tokenProgram),
        amount: 1234n,
        depositUpToLimit: true,
      },
      { programAddress: toAddress(key(200)) }
    );
    const anchorIx = await instructions.makeDepositIx(
      program,
      {
        marginfiAccount,
        signerTokenAccount: tokenAccount,
        bank,
        tokenProgram,
        group,
        authority,
        liquidityVault,
      },
      { amount: new BN(1234), depositUpToLimit: true }
    );

    expect({
      programId: ix.programAddress,
      keys: ix.accounts.map((a) => [a.address, isSignerRole(a.role), isWritableRole(a.role)]),
      data: Buffer.from(ix.data).toString("hex"),
    }).toEqual(toWire(anchorIx));
  });
});
