import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import BN from "bn.js";
import { describe, expect, it, vi } from "vitest";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import instructions from "~/instructions";
import { BankConfigOptRaw } from "~/services/bank";
import { MarginfiProgram, Wallet } from "~/types";
import { bigNumberToWrappedI80F48 } from "~/utils";

const pk = (fill: number) => new PublicKey(new Uint8Array(32).fill(fill));
const meta = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });

const getAccountInfo = vi.fn(() => {
  throw new Error("instruction builders must not touch the RPC");
});
const connection = { getAccountInfo, commitment: "confirmed" } as unknown as Connection;
const program = new Program<MarginfiIdlType>(
  { ...MARGINFI_IDL, address: pk(1).toBase58() },
  new AnchorProvider(connection, {} as Wallet, {})
) as unknown as MarginfiProgram;

const idlAccountCount = (name: string) => {
  const ix = MARGINFI_IDL.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`${name} not in IDL`);
  return ix.accounts.length;
};

const nullBankConfigOpt: BankConfigOptRaw = {
  assetWeightInit: null,
  assetWeightMaint: null,
  liabilityWeightInit: null,
  liabilityWeightMaint: null,
  depositLimit: null,
  borrowLimit: null,
  operationalState: null,
  interestRateConfig: null,
  riskTier: null,
  assetTag: null,
  totalAssetValueInitLimit: null,
  oracleMaxConfidence: null,
  oracleMaxAge: null,
  permissionlessBadDebtSettlement: null,
  freezeSettings: null,
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

const remaining = [meta(pk(90)), meta(pk(91))];
const amount = new BN(1);

// name in the IDL, builder, remaining accounts passed
const cases: [string, () => Promise<TransactionInstruction>, number][] = [
  [
    "marginfi_account_initialize",
    () =>
      instructions.makeInitMarginfiAccountIx(program, {
        marginfiGroup: pk(2),
        marginfiAccount: pk(3),
        authority: pk(4),
        feePayer: pk(5),
      }),
    0,
  ],
  [
    "marginfi_account_initialize_pda",
    () =>
      instructions.makeInitMarginfiAccountPdaIx(
        program,
        { marginfiGroup: pk(2), marginfiAccount: pk(3), authority: pk(4), feePayer: pk(5) },
        { accountIndex: 0 }
      ),
    0,
  ],
  [
    "lending_account_deposit",
    () =>
      instructions.makeDepositIx(
        program,
        {
          marginfiAccount: pk(3),
          signerTokenAccount: pk(6),
          bank: pk(7),
          tokenProgram: pk(8),
          group: pk(2),
          authority: pk(4),
          liquidityVault: pk(9),
        },
        { amount },
        remaining
      ),
    remaining.length,
  ],
  [
    "lending_account_repay",
    () =>
      instructions.makeRepayIx(
        program,
        {
          marginfiAccount: pk(3),
          signerTokenAccount: pk(6),
          bank: pk(7),
          tokenProgram: pk(8),
          group: pk(2),
          authority: pk(4),
          liquidityVault: pk(9),
        },
        { amount },
        remaining
      ),
    remaining.length,
  ],
  [
    "lending_account_withdraw",
    () =>
      instructions.makeWithdrawIx(
        program,
        {
          marginfiAccount: pk(3),
          bank: pk(7),
          destinationTokenAccount: pk(6),
          tokenProgram: pk(8),
          group: pk(2),
          authority: pk(4),
          liquidityVault: pk(9),
        },
        { amount },
        remaining
      ),
    remaining.length,
  ],
  [
    "lending_account_borrow",
    () =>
      instructions.makeBorrowIx(
        program,
        {
          marginfiAccount: pk(3),
          bank: pk(7),
          destinationTokenAccount: pk(6),
          tokenProgram: pk(8),
          group: pk(2),
          authority: pk(4),
          liquidityVault: pk(9),
        },
        { amount },
        remaining
      ),
    remaining.length,
  ],
  [
    "kamino_deposit",
    () =>
      instructions.makeKaminoDepositIx(
        program,
        {
          marginfiAccount: pk(3),
          bank: pk(7),
          signerTokenAccount: pk(6),
          lendingMarket: pk(10),
          lendingMarketAuthority: pk(11),
          reserveLiquiditySupply: pk(12),
          reserveCollateralMint: pk(13),
          reserveDestinationDepositCollateral: pk(14),
          liquidityTokenProgram: pk(8),
          obligationFarmUserState: null,
          reserveFarmState: null,
          group: pk(2),
          authority: pk(4),
          liquidityVault: pk(9),
          integrationAcc1: pk(15),
          integrationAcc2: pk(16),
          mint: pk(17),
        },
        { amount },
        remaining
      ),
    remaining.length,
  ],
  [
    "kamino_withdraw",
    () =>
      instructions.makeKaminoWithdrawIx(
        program,
        {
          marginfiAccount: pk(3),
          bank: pk(7),
          destinationTokenAccount: pk(6),
          lendingMarket: pk(10),
          mint: pk(17),
          lendingMarketAuthority: pk(11),
          reserveLiquiditySupply: pk(12),
          reserveCollateralMint: pk(13),
          reserveSourceCollateral: pk(14),
          liquidityTokenProgram: pk(8),
          obligationFarmUserState: null,
          reserveFarmState: null,
          group: pk(2),
          authority: pk(4),
          liquidityVault: pk(9),
          integrationAcc1: pk(15),
          integrationAcc2: pk(16),
        },
        { amount, isFinalWithdrawal: false },
        remaining
      ),
    remaining.length,
  ],
  [
    "drift_deposit",
    () =>
      instructions.makeDriftDepositIx(
        program,
        {
          marginfiAccount: pk(3),
          bank: pk(7),
          signerTokenAccount: pk(6),
          driftState: pk(10),
          driftSpotMarketVault: pk(11),
          tokenProgram: pk(8),
          driftOracle: null,
          group: pk(2),
          authority: pk(4),
          liquidityVault: pk(9),
          integrationAcc1: pk(15),
          integrationAcc2: pk(16),
          integrationAcc3: pk(18),
          mint: pk(17),
        },
        { amount }
      ),
    0,
  ],
  [
    "drift_withdraw",
    () =>
      instructions.makeDriftWithdrawIx(
        program,
        {
          marginfiAccount: pk(3),
          bank: pk(7),
          destinationTokenAccount: pk(6),
          driftState: pk(10),
          driftSigner: pk(19),
          driftSpotMarketVault: pk(11),
          tokenProgram: pk(8),
          driftOracle: null,
          driftRewardOracle: null,
          driftRewardSpotMarket: null,
          driftRewardMint: null,
          driftRewardOracle2: null,
          driftRewardSpotMarket2: null,
          driftRewardMint2: null,
          group: pk(2),
          authority: pk(4),
          liquidityVault: pk(9),
          integrationAcc1: pk(15),
          integrationAcc2: pk(16),
          integrationAcc3: pk(18),
          mint: pk(17),
        },
        { amount, withdrawAll: false },
        remaining
      ),
    remaining.length,
  ],
  [
    "juplend_deposit",
    () =>
      instructions.makeJuplendDepositIx(
        program,
        {
          marginfiAccount: pk(3),
          bank: pk(7),
          signerTokenAccount: pk(6),
          lendingAdmin: pk(20),
          supplyTokenReservesLiquidity: pk(21),
          lendingSupplyPositionOnLiquidity: pk(22),
          rateModel: pk(23),
          vault: pk(24),
          liquidity: pk(25),
          liquidityProgram: pk(26),
          rewardsRateModel: pk(27),
          tokenProgram: pk(8),
          group: pk(2),
          authority: pk(4),
          liquidityVault: pk(9),
          fTokenMint: pk(28),
          integrationAcc1: pk(15),
          integrationAcc2: pk(16),
          mint: pk(17),
        },
        { amount },
        remaining
      ),
    remaining.length,
  ],
  [
    "juplend_withdraw",
    () =>
      instructions.makeJuplendWithdrawIx(
        program,
        {
          marginfiAccount: pk(3),
          bank: pk(7),
          destinationTokenAccount: pk(6),
          lendingAdmin: pk(20),
          supplyTokenReservesLiquidity: pk(21),
          lendingSupplyPositionOnLiquidity: pk(22),
          rateModel: pk(23),
          vault: pk(24),
          claimAccount: pk(29),
          liquidity: pk(25),
          liquidityProgram: pk(26),
          rewardsRateModel: pk(27),
          tokenProgram: pk(8),
          group: pk(2),
          authority: pk(4),
          mint: pk(17),
          integrationAcc1: pk(15),
          fTokenMint: pk(28),
          integrationAcc2: pk(16),
          integrationAcc3: pk(18),
        },
        { amount },
        remaining
      ),
    remaining.length,
  ],
  [
    "lending_account_liquidate",
    () =>
      instructions.makeLendingAccountLiquidateIx(
        program,
        {
          assetBank: pk(7),
          liabBank: pk(30),
          liquidatorMarginfiAccount: pk(3),
          liquidateeMarginfiAccount: pk(31),
          tokenProgram: pk(8),
          group: pk(2),
          authority: pk(4),
        },
        { assetAmount: amount, liquidateeAccounts: 1, liquidatorAccounts: 1 },
        remaining
      ),
    remaining.length,
  ],
  [
    "lending_pool_configure_bank",
    () =>
      instructions.makePoolConfigureBankIx(
        program,
        { bank: pk(7), group: pk(2), admin: pk(4) },
        { bankConfigOpt: nullBankConfigOpt }
      ),
    0,
  ],
  [
    "lending_account_start_flashloan",
    () =>
      instructions.makeBeginFlashLoanIx(
        program,
        { marginfiAccount: pk(3), authority: pk(4) },
        { endIndex: new BN(2) }
      ),
    0,
  ],
  [
    "lending_account_end_flashloan",
    () =>
      instructions.makeEndFlashLoanIx(
        program,
        { marginfiAccount: pk(3), group: pk(2), authority: pk(4) },
        remaining
      ),
    remaining.length,
  ],
  [
    "transfer_to_new_account",
    () =>
      instructions.makeAccountTransferToNewAccountIx(program, {
        oldMarginfiAccount: pk(3),
        newMarginfiAccount: pk(32),
        newAuthority: pk(33),
        globalFeeWallet: pk(34),
        feePayer: pk(5),
        group: pk(2),
        authority: pk(4),
      }),
    0,
  ],
  [
    "marginfi_group_initialize",
    () => instructions.makeGroupInitIx(program, { marginfiGroup: pk(2), admin: pk(4) }),
    0,
  ],
  [
    "marginfi_account_close",
    () =>
      instructions.makeCloseAccountIx(program, {
        marginfiAccount: pk(3),
        feePayer: pk(5),
        authority: pk(4),
      }),
    0,
  ],
  [
    "lending_pool_add_bank_permissionless",
    () =>
      instructions.makePoolAddPermissionlessStakedBankIx(
        program,
        {
          stakedSettings: pk(35),
          feePayer: pk(5),
          bankMint: pk(17),
          solPool: pk(36),
          poolOnramp: pk(37),
          stakePool: pk(38),
          validatorVoteAccount: pk(39),
          marginfiGroup: pk(2),
        },
        remaining,
        {}
      ),
    remaining.length,
  ],
  [
    "lending_pool_configure_bank_oracle",
    () =>
      instructions.makeLendingPoolConfigureBankOracleIx(
        program,
        { bank: pk(7), group: pk(2), admin: pk(4) },
        { setup: 3, feedId: pk(40) },
        remaining
      ),
    remaining.length,
  ],
  [
    "lending_pool_configure_bank_oracle_scope",
    () =>
      instructions.makeLendingPoolConfigureBankOracleScopeIx(
        program,
        { bank: pk(7), group: pk(2), admin: pk(4) },
        { oracle: pk(40), entryIndex: 1 }
      ),
    1,
  ],
  [
    "lending_pool_set_oracle_price",
    () =>
      instructions.makeLendingPoolSetOraclePriceIx(
        program,
        { bank: pk(7), group: pk(2), admin: pk(4) },
        { price: bigNumberToWrappedI80F48(new BigNumber(1)), setup: 24 },
        remaining
      ),
    remaining.length,
  ],
  [
    "lending_account_pulse_health",
    () =>
      instructions.makePulseHealthIx(program, { marginfiAccount: pk(3), group: pk(2) }, remaining),
    remaining.length,
  ],
];

describe("instruction builders resolve every account offline", () => {
  it.each(cases)("%s", async (name, build, remainingCount) => {
    const ix = await build();
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(ix.programId.equals(pk(1))).toBe(true);
    expect(ix.keys.length).toBe(idlAccountCount(name) + remainingCount);
  });
});
