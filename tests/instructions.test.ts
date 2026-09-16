import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import BN from "bn.js";
import { describe, expect, it, vi } from "vitest";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import instructions from "~/instructions";
import { BankConfigOptRaw } from "~/services/bank";
import syncInstructions from "~/sync-instructions";
import { MarginfiProgram, Wallet } from "~/types";
import {
  bigNumberToWrappedI80F48,
  deriveBankFeeVault,
  deriveBankFeeVaultAuthority,
  deriveBankInsuranceVault,
  deriveBankInsuranceVaultAuthority,
  deriveBankLiquidityVault,
  deriveBankLiquidityVaultAuthority,
  deriveFeeState,
} from "~/utils";
import { DRIFT_PROGRAM_ID } from "~/vendor/drift";

const pk = (fill: number) => new PublicKey(new Uint8Array(32).fill(fill));
const meta = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });

const programId = pk(1);
const group = pk(2);
const marginfiAccount = pk(3);
const authority = pk(4);
const feePayer = pk(5);
const tokenAccount = pk(6);
const bank = pk(7);
const tokenProgram = pk(8);
const mint = pk(17);
const liabBank = pk(30);
const [liquidityVault] = deriveBankLiquidityVault(programId, bank);
const [feeState] = deriveFeeState(programId);

const getAccountInfo = vi.fn(() => {
  throw new Error("instruction builders must not touch the RPC");
});
const connection = { getAccountInfo, commitment: "confirmed" } as unknown as Connection;
const program = new Program<MarginfiIdlType>(
  { ...MARGINFI_IDL, address: programId.toBase58() },
  new AnchorProvider(connection, {} as Wallet, {})
) as unknown as MarginfiProgram;

const idlAccountCount = (name: string) => {
  const ix = MARGINFI_IDL.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`${name} not in IDL`);
  return ix.accounts.length;
};

const serialize = (ix: TransactionInstruction) => ({
  programId: ix.programId.toBase58(),
  keys: ix.keys.map((k) => ({
    pubkey: k.pubkey.toBase58(),
    isSigner: k.isSigner,
    isWritable: k.isWritable,
  })),
  data: ix.data.toString("base64"),
});

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

const kaminoAccounts = {
  lendingMarket: pk(10),
  lendingMarketAuthority: pk(11),
  reserveLiquiditySupply: pk(12),
  reserveCollateralMint: pk(13),
  liquidityTokenProgram: tokenProgram,
  obligationFarmUserState: null,
  reserveFarmState: null,
  integrationAcc1: pk(15),
  integrationAcc2: pk(16),
};
const driftAccounts = {
  driftState: pk(10),
  driftSpotMarketVault: pk(11),
  driftOracle: null,
  integrationAcc1: pk(15),
  integrationAcc2: pk(16),
  integrationAcc3: pk(18),
};
const juplendAccounts = {
  lendingAdmin: pk(20),
  supplyTokenReservesLiquidity: pk(21),
  lendingSupplyPositionOnLiquidity: pk(22),
  rateModel: pk(23),
  vault: pk(24),
  liquidity: pk(25),
  liquidityProgram: pk(26),
  rewardsRateModel: pk(27),
  fTokenMint: pk(28),
  integrationAcc1: pk(15),
  integrationAcc2: pk(16),
};
const stakedBankAccounts = {
  stakedSettings: pk(35),
  bankMint: mint,
  solPool: pk(36),
  poolOnramp: pk(37),
  stakePool: pk(38),
  validatorVoteAccount: pk(39),
};
const [stakedBank] = PublicKey.findProgramAddressSync(
  [group.toBuffer(), mint.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 8)],
  programId
);

type Case = {
  name: string;
  build: () => Promise<TransactionInstruction>;
  remaining: number;
  /** Hand-encoded simulation builder taking the same inputs, when one exists. */
  sync?: () => TransactionInstruction;
};

const cases: Case[] = [
  {
    name: "marginfi_account_initialize",
    build: () =>
      instructions.makeInitMarginfiAccountIx(program, {
        marginfiGroup: group,
        marginfiAccount,
        authority,
        feePayer,
      }),
    remaining: 0,
    sync: () =>
      syncInstructions.makeInitMarginfiAccountIx(programId, {
        marginfiGroup: group,
        marginfiAccount,
        authority,
        feePayer,
      }),
  },
  {
    name: "marginfi_account_initialize_pda",
    build: () =>
      instructions.makeInitMarginfiAccountPdaIx(
        program,
        { marginfiGroup: group, marginfiAccount, authority, feePayer },
        { accountIndex: 0 }
      ),
    remaining: 0,
  },
  {
    name: "lending_account_deposit",
    build: () =>
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
        { amount },
        remaining
      ),
    remaining: remaining.length,
    sync: () =>
      syncInstructions.makeDepositIx(
        programId,
        { group, marginfiAccount, authority, signerTokenAccount: tokenAccount, bank, tokenProgram },
        { amount },
        remaining
      ),
  },
  {
    name: "lending_account_repay",
    build: () =>
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
        { amount },
        remaining
      ),
    remaining: remaining.length,
    sync: () =>
      syncInstructions.makeRepayIx(
        programId,
        { group, marginfiAccount, authority, signerTokenAccount: tokenAccount, bank, tokenProgram },
        { amount },
        remaining
      ),
  },
  {
    name: "lending_account_withdraw",
    build: () =>
      instructions.makeWithdrawIx(
        program,
        {
          marginfiAccount,
          bank,
          destinationTokenAccount: tokenAccount,
          tokenProgram,
          group,
          authority,
          liquidityVault,
        },
        { amount },
        remaining
      ),
    remaining: remaining.length,
    sync: () =>
      syncInstructions.makeWithdrawIx(
        programId,
        {
          group,
          marginfiAccount,
          authority,
          bank,
          destinationTokenAccount: tokenAccount,
          tokenProgram,
        },
        { amount },
        remaining
      ),
  },
  {
    name: "lending_account_borrow",
    build: () =>
      instructions.makeBorrowIx(
        program,
        {
          marginfiAccount,
          bank,
          destinationTokenAccount: tokenAccount,
          tokenProgram,
          group,
          authority,
          liquidityVault,
        },
        { amount },
        remaining
      ),
    remaining: remaining.length,
    sync: () =>
      syncInstructions.makeBorrowIx(
        programId,
        {
          group,
          marginfiAccount,
          authority,
          bank,
          destinationTokenAccount: tokenAccount,
          tokenProgram,
        },
        { amount },
        remaining
      ),
  },
  {
    name: "kamino_deposit",
    build: () =>
      instructions.makeKaminoDepositIx(
        program,
        {
          ...kaminoAccounts,
          marginfiAccount,
          bank,
          signerTokenAccount: tokenAccount,
          reserveDestinationDepositCollateral: pk(14),
          group,
          authority,
          liquidityVault,
          mint,
        },
        { amount },
        remaining
      ),
    remaining: remaining.length,
    sync: () =>
      syncInstructions.makeKaminoDepositIx(
        programId,
        {
          ...kaminoAccounts,
          group,
          marginfiAccount,
          authority,
          bank,
          signerTokenAccount: tokenAccount,
          mint,
          reserveDestinationDepositCollateral: pk(14),
        },
        { amount },
        remaining
      ),
  },
  {
    name: "kamino_withdraw",
    build: () =>
      instructions.makeKaminoWithdrawIx(
        program,
        {
          ...kaminoAccounts,
          marginfiAccount,
          bank,
          destinationTokenAccount: tokenAccount,
          mint,
          reserveSourceCollateral: pk(14),
          group,
          authority,
          liquidityVault,
        },
        { amount, isFinalWithdrawal: false },
        remaining
      ),
    remaining: remaining.length,
    sync: () =>
      syncInstructions.makeKaminoWithdrawIx(
        programId,
        {
          ...kaminoAccounts,
          group,
          marginfiAccount,
          authority,
          bank,
          destinationTokenAccount: tokenAccount,
          mint,
          reserveSourceCollateral: pk(14),
        },
        { amount, isFinalWithdrawal: false },
        remaining
      ),
  },
  {
    name: "drift_deposit",
    build: () =>
      instructions.makeDriftDepositIx(
        program,
        {
          ...driftAccounts,
          marginfiAccount,
          bank,
          signerTokenAccount: tokenAccount,
          tokenProgram,
          group,
          authority,
          liquidityVault,
          mint,
        },
        { amount }
      ),
    remaining: 0,
    sync: () =>
      syncInstructions.makeDriftDepositIx(
        programId,
        {
          ...driftAccounts,
          group,
          marginfiAccount,
          authority,
          bank,
          liquidityVault,
          signerTokenAccount: tokenAccount,
          mint,
          driftProgram: DRIFT_PROGRAM_ID,
          tokenProgram,
          systemProgram: SystemProgram.programId,
        },
        { amount }
      ),
  },
  {
    name: "drift_withdraw",
    build: () =>
      instructions.makeDriftWithdrawIx(
        program,
        {
          ...driftAccounts,
          marginfiAccount,
          bank,
          destinationTokenAccount: tokenAccount,
          driftSigner: pk(19),
          tokenProgram,
          driftRewardOracle: null,
          driftRewardSpotMarket: null,
          driftRewardMint: null,
          driftRewardOracle2: null,
          driftRewardSpotMarket2: null,
          driftRewardMint2: null,
          group,
          authority,
          liquidityVault,
          mint,
        },
        { amount, withdrawAll: false },
        remaining
      ),
    remaining: remaining.length,
    sync: () =>
      syncInstructions.makeDriftWithdrawIx(
        programId,
        {
          ...driftAccounts,
          group,
          marginfiAccount,
          authority,
          bank,
          liquidityVault,
          destinationTokenAccount: tokenAccount,
          driftSigner: pk(19),
          mint,
          tokenProgram,
        },
        { amount, withdrawAll: false },
        remaining
      ),
  },
  {
    name: "juplend_deposit",
    build: () =>
      instructions.makeJuplendDepositIx(
        program,
        {
          ...juplendAccounts,
          marginfiAccount,
          bank,
          signerTokenAccount: tokenAccount,
          tokenProgram,
          group,
          authority,
          liquidityVault,
          mint,
        },
        { amount },
        remaining
      ),
    remaining: remaining.length,
  },
  {
    name: "juplend_withdraw",
    build: () =>
      instructions.makeJuplendWithdrawIx(
        program,
        {
          ...juplendAccounts,
          marginfiAccount,
          bank,
          destinationTokenAccount: tokenAccount,
          claimAccount: pk(29),
          tokenProgram,
          group,
          authority,
          mint,
          integrationAcc3: pk(18),
        },
        { amount },
        remaining
      ),
    remaining: remaining.length,
  },
  {
    name: "lending_account_liquidate",
    build: () =>
      instructions.makeLendingAccountLiquidateIx(
        program,
        {
          assetBank: bank,
          liabBank,
          liquidatorMarginfiAccount: marginfiAccount,
          liquidateeMarginfiAccount: pk(31),
          tokenProgram,
          group,
          authority,
        },
        { assetAmount: amount, liquidateeAccounts: 1, liquidatorAccounts: 1 },
        remaining
      ),
    remaining: remaining.length,
    sync: () =>
      syncInstructions.makeLendingAccountLiquidateIx(
        programId,
        {
          group,
          assetBank: bank,
          liabBank,
          liquidatorMarginfiAccount: marginfiAccount,
          authority,
          liquidateeMarginfiAccount: pk(31),
          bankLiquidityVaultAuthority: deriveBankLiquidityVaultAuthority(programId, liabBank)[0],
          bankLiquidityVault: deriveBankLiquidityVault(programId, liabBank)[0],
          bankInsuranceVault: deriveBankInsuranceVault(programId, liabBank)[0],
          tokenProgram,
        },
        { assetAmount: amount, liquidateeAccounts: 1, liquidatorAccounts: 1 },
        remaining
      ),
  },
  {
    name: "lending_pool_configure_bank",
    build: () =>
      instructions.makePoolConfigureBankIx(
        program,
        { bank, group, admin: authority },
        { bankConfigOpt: nullBankConfigOpt }
      ),
    remaining: 0,
  },
  {
    name: "lending_account_start_flashloan",
    build: () =>
      instructions.makeBeginFlashLoanIx(
        program,
        { marginfiAccount, authority },
        { endIndex: new BN(2) }
      ),
    remaining: 0,
    sync: () =>
      syncInstructions.makeBeginFlashLoanIx(
        programId,
        { marginfiAccount, authority },
        { endIndex: new BN(2) }
      ),
  },
  {
    name: "lending_account_end_flashloan",
    build: () =>
      instructions.makeEndFlashLoanIx(program, { marginfiAccount, group, authority }, remaining),
    remaining: remaining.length,
    sync: () =>
      syncInstructions.makeEndFlashLoanIx(
        programId,
        { marginfiAccount, group, authority },
        remaining
      ),
  },
  {
    name: "transfer_to_new_account",
    build: () =>
      instructions.makeAccountTransferToNewAccountIx(program, {
        oldMarginfiAccount: marginfiAccount,
        newMarginfiAccount: pk(32),
        newAuthority: pk(33),
        globalFeeWallet: pk(34),
        feePayer,
        group,
        authority,
      }),
    remaining: 0,
    sync: () =>
      syncInstructions.makeAccountTransferToNewAccountIx(programId, {
        group,
        oldMarginfiAccount: marginfiAccount,
        newMarginfiAccount: pk(32),
        authority,
        feePayer,
        newAuthority: pk(33),
        globalFeeWallet: pk(34),
        feeState,
      }),
  },
  {
    name: "marginfi_group_initialize",
    build: () => instructions.makeGroupInitIx(program, { marginfiGroup: group, admin: authority }),
    remaining: 0,
    sync: () =>
      syncInstructions.makeGroupInitIx(programId, {
        marginfiGroup: group,
        admin: authority,
        feeState,
      }),
  },
  {
    name: "marginfi_account_close",
    build: () => instructions.makeCloseAccountIx(program, { marginfiAccount, feePayer, authority }),
    remaining: 0,
    sync: () =>
      syncInstructions.makeCloseAccountIx(programId, { marginfiAccount, authority, feePayer }),
  },
  {
    name: "lending_pool_add_bank_permissionless",
    build: () =>
      instructions.makePoolAddPermissionlessStakedBankIx(
        program,
        { ...stakedBankAccounts, feePayer, marginfiGroup: group },
        remaining,
        {}
      ),
    remaining: remaining.length,
    sync: () =>
      syncInstructions.makePoolAddPermissionlessStakedBankIx(
        programId,
        {
          ...stakedBankAccounts,
          marginfiGroup: group,
          feePayer,
          bank: stakedBank,
          liquidityVaultAuthority: deriveBankLiquidityVaultAuthority(programId, stakedBank)[0],
          liquidityVault: deriveBankLiquidityVault(programId, stakedBank)[0],
          insuranceVaultAuthority: deriveBankInsuranceVaultAuthority(programId, stakedBank)[0],
          insuranceVault: deriveBankInsuranceVault(programId, stakedBank)[0],
          feeVaultAuthority: deriveBankFeeVaultAuthority(programId, stakedBank)[0],
          feeVault: deriveBankFeeVault(programId, stakedBank)[0],
        },
        remaining,
        {}
      ),
  },
  {
    name: "lending_pool_configure_bank_oracle",
    build: () =>
      instructions.makeLendingPoolConfigureBankOracleIx(
        program,
        { bank, group, admin: authority },
        { setup: 3, feedId: pk(40) },
        remaining
      ),
    remaining: remaining.length,
    sync: () =>
      syncInstructions.makeLendingPoolConfigureBankOracleIx(
        programId,
        { group, admin: authority, bank },
        { setup: 3, feedId: pk(40) },
        remaining
      ),
  },
  {
    name: "lending_pool_configure_bank_oracle_scope",
    build: () =>
      instructions.makeLendingPoolConfigureBankOracleScopeIx(
        program,
        { bank, group, admin: authority },
        { oracle: pk(40), entryIndex: 1 }
      ),
    remaining: 1,
    sync: () =>
      syncInstructions.makeLendingPoolConfigureBankOracleScopeIx(
        programId,
        { group, admin: authority, bank },
        { oracle: pk(40), entryIndex: 1 }
      ),
  },
  {
    name: "lending_pool_set_oracle_price",
    build: () =>
      instructions.makeLendingPoolSetOraclePriceIx(
        program,
        { bank, group, admin: authority },
        { price: bigNumberToWrappedI80F48(new BigNumber(1)), setup: 24 },
        remaining
      ),
    remaining: remaining.length,
  },
  {
    name: "lending_account_pulse_health",
    build: () => instructions.makePulseHealthIx(program, { marginfiAccount, group }, remaining),
    remaining: remaining.length,
    sync: () =>
      syncInstructions.makePulseHealthIx(programId, { marginfiAccount, group }, remaining),
  },
];

describe("instruction builders", () => {
  it.each(cases)("$name resolves every account offline", async ({ name, build, remaining }) => {
    const ix = await build();
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(ix.programId.equals(programId)).toBe(true);
    expect(ix.keys.length).toBe(idlAccountCount(name) + remaining);
  });

  // Golden wire format: the accounts and bytes the on-chain program receives for fixed inputs.
  // A different encoder (Codama, a hand-written builder) must reproduce these exactly.
  it.each(cases)("$name matches the recorded wire format", async ({ build }) => {
    expect(serialize(await build())).toMatchSnapshot();
  });

  it.each(cases.filter((c) => c.sync))(
    "$name sync simulation builder matches the Anchor builder",
    async ({ build, sync }) => {
      if (!sync) return;
      expect(serialize(sync())).toEqual(serialize(await build()));
    }
  );
});
