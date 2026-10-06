import { AccountRole, isInstructionWithData, type Address, type Instruction } from "@solana/kit";

import {
  getDriftDepositInstructionAsync,
  getDriftWithdrawInstructionAsync,
  getJuplendDepositInstructionAsync,
  getJuplendWithdrawInstructionAsync,
  getKaminoDepositInstructionAsync,
  getKaminoWithdrawInstructionAsync,
  getLendingAccountBorrowInstructionAsync,
  getLendingAccountDepositInstruction,
  getLendingAccountEndFlashloanInstruction,
  getLendingAccountLiquidateInstructionAsync,
  getLendingAccountPulseHealthInstruction,
  getLendingAccountRepayInstruction,
  getLendingAccountStartFlashloanInstruction,
  getLendingAccountWithdrawInstructionAsync,
  getLendingPoolAddBankInstructionAsync,
  getLendingPoolAddBankPermissionlessInstructionAsync,
  getLendingPoolConfigureBankGovInstruction,
  getLendingPoolConfigureBankInstruction,
  getLendingPoolConfigureBankOracleInstruction,
  getLendingPoolConfigureBankOracleScopeInstruction,
  getLendingPoolSetOraclePriceInstruction,
  getMarginfiAccountCloseInstructionAsync,
  getMarginfiAccountCloseOrderInstruction,
  getMarginfiAccountInitializeInstruction,
  getMarginfiAccountInitializePdaInstruction,
  getMarginfiAccountPlaceOrderInstructionAsync,
  getMarginfiGroupInitializeInstructionAsync,
  getTransferToNewAccountInstructionAsync,
  parseMarginfiInstruction,
  type BankConfigCompactArgs,
  type DriftDepositAsyncInput,
  type DriftWithdrawAsyncInput,
  type JuplendDepositAsyncInput,
  type JuplendWithdrawAsyncInput,
  type KaminoDepositAsyncInput,
  type KaminoWithdrawAsyncInput,
  type LendingAccountBorrowAsyncInput,
  type LendingAccountDepositInput,
  type LendingAccountEndFlashloanInput,
  type LendingAccountLiquidateAsyncInput,
  type LendingAccountPulseHealthInput,
  type LendingAccountRepayInput,
  type LendingAccountStartFlashloanInput,
  type LendingAccountWithdrawAsyncInput,
  type LendingPoolAddBankAsyncInput,
  type LendingPoolAddBankPermissionlessAsyncInput,
  type LendingPoolConfigureBankGovInput,
  type LendingPoolConfigureBankInput,
  type LendingPoolConfigureBankOracleInput,
  type LendingPoolConfigureBankOracleScopeInput,
  type LendingPoolSetOraclePriceInput,
  type MarginfiAccountCloseAsyncInput,
  type MarginfiAccountCloseOrderInput,
  type MarginfiAccountInitializeInput,
  type MarginfiAccountInitializePdaInput,
  type MarginfiAccountPlaceOrderAsyncInput,
  type MarginfiGroupInitializeAsyncInput,
  type ParsedMarginfiInstruction,
  type TransferToNewAccountAsyncInput,
} from "./generated/marginfi";

import { TOKEN_2022_PROGRAM_ID } from "~/constants";

export { MarginfiInstruction } from "./generated/marginfi";

// Every remaining account marginfi reads is read-only.
function withRemainingAccounts(ix: Instruction, remainingAccounts: Address[]): Instruction {
  return {
    ...ix,
    accounts: [
      ...(ix.accounts ?? []),
      ...remainingAccounts.map((address) => ({ address, role: AccountRole.READONLY })),
    ],
  };
}

// Token-2022 banks take their mint as the first remaining account (`maybe_take_bank_mint`).
function token2022Mint(tokenProgram: Address, mint: Address): Address[] {
  return tokenProgram === TOKEN_2022_PROGRAM_ID ? [mint] : [];
}

/** Creates a marginfi account at a keypair address; `marginfiAccount` must sign. */
async function makeInitMarginfiAccountIx(
  programAddress: Address,
  input: MarginfiAccountInitializeInput
): Promise<Instruction> {
  return getMarginfiAccountInitializeInstruction(input, { programAddress });
}

/** Creates a marginfi account at its PDA (group, authority, `accountIndex`, `thirdPartyId`). */
async function makeInitMarginfiAccountPdaIx(
  programAddress: Address,
  input: MarginfiAccountInitializePdaInput
): Promise<Instruction> {
  return getMarginfiAccountInitializePdaInstruction(input, { programAddress });
}

/** Deposits `amount` (native units) into a JupLend-backed bank. */
async function makeJuplendDepositIx(
  programAddress: Address,
  input: JuplendDepositAsyncInput
): Promise<Instruction> {
  return getJuplendDepositInstructionAsync(input, { programAddress });
}

/**
 * Withdraws `amount` (native units) from a JupLend-backed bank; `withdrawAll` closes the balance.
 * @param healthAccounts - Health-check remaining accounts (`computeHealthAccounts`).
 */
async function makeJuplendWithdrawIx(
  programAddress: Address,
  input: JuplendWithdrawAsyncInput,
  healthAccounts: Address[]
): Promise<Instruction> {
  return withRemainingAccounts(
    await getJuplendWithdrawInstructionAsync(input, { programAddress }),
    healthAccounts
  );
}

/**
 * Deposits `amount` (native units) into a Kamino-backed bank; `refreshReserve` refreshes the
 * reserve in-instruction.
 */
async function makeKaminoDepositIx(
  programAddress: Address,
  input: KaminoDepositAsyncInput
): Promise<Instruction> {
  return getKaminoDepositInstructionAsync(input, { programAddress });
}

/** Deposits `amount` (native units) into a Drift-backed bank. */
async function makeDriftDepositIx(
  programAddress: Address,
  input: DriftDepositAsyncInput
): Promise<Instruction> {
  return getDriftDepositInstructionAsync(input, { programAddress });
}

/** Deposits `amount` (native units) of the bank's `mint` from `signerTokenAccount`. */
async function makeDepositIx(
  programAddress: Address,
  { mint, ...input }: LendingAccountDepositInput & { mint: Address; tokenProgram: Address }
): Promise<Instruction> {
  return withRemainingAccounts(
    getLendingAccountDepositInstruction(input, { programAddress }),
    token2022Mint(input.tokenProgram, mint)
  );
}

/**
 * Repays `amount` (native units) of the bank's liability in its `mint`; `repayAll` closes the
 * balance.
 */
async function makeRepayIx(
  programAddress: Address,
  { mint, ...input }: LendingAccountRepayInput & { mint: Address; tokenProgram: Address }
): Promise<Instruction> {
  return withRemainingAccounts(
    getLendingAccountRepayInstruction(input, { programAddress }),
    token2022Mint(input.tokenProgram, mint)
  );
}

/**
 * Withdraws `amount` (native units) from a Drift-backed bank; `withdrawAll` closes the balance.
 * @param healthAccounts - Health-check remaining accounts (`computeHealthAccounts`).
 */
async function makeDriftWithdrawIx(
  programAddress: Address,
  input: DriftWithdrawAsyncInput,
  healthAccounts: Address[]
): Promise<Instruction> {
  return withRemainingAccounts(
    await getDriftWithdrawInstructionAsync(input, { programAddress }),
    healthAccounts
  );
}

/**
 * Withdraws `amount` (native units) from a Kamino-backed bank. `isFinalWithdrawal` closes the
 * balance; `refreshReserve` refreshes the reserve via batch refresh.
 * @param healthAccounts - Health-check remaining accounts (`computeHealthAccounts`).
 */
async function makeKaminoWithdrawIx(
  programAddress: Address,
  {
    isFinalWithdrawal,
    refreshReserve,
    ...input
  }: Omit<KaminoWithdrawAsyncInput, "flags"> & {
    isFinalWithdrawal: boolean;
    refreshReserve?: boolean;
  },
  healthAccounts: Address[]
): Promise<Instruction> {
  // bit 0 = withdraw all, bit 1 = batch refresh; `None` when no flag is set.
  const flags = (isFinalWithdrawal ? 1 : 0) | (refreshReserve ? 2 : 0);
  return withRemainingAccounts(
    await getKaminoWithdrawInstructionAsync(
      { ...input, flags: flags === 0 ? null : flags },
      { programAddress }
    ),
    healthAccounts
  );
}

/**
 * Withdraws `amount` (native units) of the bank's `mint` to `destinationTokenAccount`;
 * `withdrawAll` closes the balance.
 * @param healthAccounts - Health-check remaining accounts (`computeHealthAccounts`).
 */
async function makeWithdrawIx(
  programAddress: Address,
  { mint, ...input }: LendingAccountWithdrawAsyncInput & { mint: Address; tokenProgram: Address },
  healthAccounts: Address[]
): Promise<Instruction> {
  return withRemainingAccounts(
    await getLendingAccountWithdrawInstructionAsync(input, { programAddress }),
    [...token2022Mint(input.tokenProgram, mint), ...healthAccounts]
  );
}

/**
 * Borrows `amount` (native units) of the bank's `mint` to `destinationTokenAccount`.
 * @param healthAccounts - Health-check remaining accounts (`computeHealthAccounts`).
 */
async function makeBorrowIx(
  programAddress: Address,
  { mint, ...input }: LendingAccountBorrowAsyncInput & { mint: Address; tokenProgram: Address },
  healthAccounts: Address[]
): Promise<Instruction> {
  return withRemainingAccounts(
    await getLendingAccountBorrowInstructionAsync(input, { programAddress }),
    [...token2022Mint(input.tokenProgram, mint), ...healthAccounts]
  );
}

/**
 * Liquidates `assetAmount` (native units) of the liquidatee's asset bank position.
 * @param remainingAccounts - Liquidator then liquidatee health-check accounts, sized by
 * `liquidatorAccounts` / `liquidateeAccounts`.
 */
async function makeLendingAccountLiquidateIx(
  programAddress: Address,
  input: LendingAccountLiquidateAsyncInput,
  remainingAccounts: Address[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    await getLendingAccountLiquidateInstructionAsync(input, { programAddress }),
    remainingAccounts
  );
}

/** Updates a bank's admin-level config (limits, rates, pausing); `null` fields are left unchanged. */
async function makePoolConfigureBankIx(
  programAddress: Address,
  input: LendingPoolConfigureBankInput
): Promise<Instruction> {
  return getLendingPoolConfigureBankInstruction(input, { programAddress });
}

/**
 * Updates a bank's governance-level config (weights, risk tier, asset tag, oracle limits,
 * freezing, returning to operational); `null` fields are left unchanged.
 */
async function makePoolConfigureBankGovIx(
  programAddress: Address,
  input: LendingPoolConfigureBankGovInput
): Promise<Instruction> {
  return getLendingPoolConfigureBankGovInstruction(input, { programAddress });
}

/** Starts a flashloan; `endIndex` is the transaction index of the matching end instruction. */
async function makeBeginFlashLoanIx(
  programAddress: Address,
  input: LendingAccountStartFlashloanInput
): Promise<Instruction> {
  return getLendingAccountStartFlashloanInstruction(input, { programAddress });
}

/**
 * Ends a flashloan and runs the health check.
 * @param remainingAccounts - Health-check accounts for the projected active banks.
 */
async function makeEndFlashLoanIx(
  programAddress: Address,
  input: LendingAccountEndFlashloanInput,
  remainingAccounts: Address[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    getLendingAccountEndFlashloanInstruction(input, { programAddress }),
    remainingAccounts
  );
}

/** Moves the account's positions to `newMarginfiAccount` owned by `newAuthority`. */
async function makeAccountTransferToNewAccountIx(
  programAddress: Address,
  input: TransferToNewAccountAsyncInput
): Promise<Instruction> {
  return getTransferToNewAccountInstructionAsync(input, { programAddress });
}

/** Initializes a marginfi group; `marginfiGroup` and `admin` must sign. */
async function makeGroupInitIx(
  programAddress: Address,
  input: MarginfiGroupInitializeAsyncInput
): Promise<Instruction> {
  return getMarginfiGroupInitializeInstructionAsync(input, { programAddress });
}

/**
 * Configures a bank's oracle.
 * @param remainingAccounts - The oracle account(s) for `setup`.
 */
async function makeLendingPoolConfigureBankOracleIx(
  programAddress: Address,
  input: LendingPoolConfigureBankOracleInput,
  remainingAccounts: Address[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    getLendingPoolConfigureBankOracleInstruction(input, { programAddress }),
    remainingAccounts
  );
}

/**
 * Points a bank at entry `entryIndex` of the Scope OraclePrices account `oracle`.
 * @param integrationAccount - For Kamino / JupLend banks, the reserve or lending account (the
 * bank's `oracleKeys[1]`) the program validates after the feed.
 */
async function makeLendingPoolConfigureBankOracleScopeIx(
  programAddress: Address,
  input: LendingPoolConfigureBankOracleScopeInput,
  integrationAccount?: Address
): Promise<Instruction> {
  return withRemainingAccounts(
    getLendingPoolConfigureBankOracleScopeInstruction(input, { programAddress }),
    integrationAccount ? [input.oracle, integrationAccount] : [input.oracle]
  );
}

/**
 * Configures a fixed or Exponent PT oracle price.
 * @param remainingAccounts - Oracle accounts required by `setup`.
 */
async function makeLendingPoolSetOraclePriceIx(
  programAddress: Address,
  input: LendingPoolSetOraclePriceInput,
  remainingAccounts: Address[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    getLendingPoolSetOraclePriceInstruction(input, { programAddress }),
    remainingAccounts
  );
}

/**
 * Adds a permissionless staked-SOL bank; `bankSeed` defaults to 0.
 * @param remainingAccounts - Pyth oracle, SOL pool and bank mint.
 */
async function makePoolAddPermissionlessStakedBankIx(
  programAddress: Address,
  {
    bankSeed = 0n,
    ...input
  }: Omit<LendingPoolAddBankPermissionlessAsyncInput, "bankSeed"> & {
    bankSeed?: bigint;
  },
  remainingAccounts: Address[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    await getLendingPoolAddBankPermissionlessInstructionAsync(
      { ...input, bankSeed },
      { programAddress }
    ),
    remainingAccounts
  );
}

/** Adds a bank to a group with `bankConfig`; `configFlags` and padding are zeroed. */
async function makePoolAddBankIx(
  programAddress: Address,
  {
    bankConfig,
    ...input
  }: Omit<LendingPoolAddBankAsyncInput, "bankConfig"> & {
    bankConfig: Omit<BankConfigCompactArgs, "configFlags" | "pad0">;
  }
): Promise<Instruction> {
  return getLendingPoolAddBankInstructionAsync(
    { ...input, bankConfig: { ...bankConfig, configFlags: 0, pad0: new Uint8Array(5) } },
    { programAddress }
  );
}

/** Closes an empty marginfi account and returns rent to `feePayer`; derives the rebalance fee pool. */
async function makeCloseAccountIx(
  programAddress: Address,
  input: MarginfiAccountCloseAsyncInput
): Promise<Instruction> {
  return getMarginfiAccountCloseInstructionAsync(input, { programAddress });
}

/**
 * Places a take-profit / stop-loss order on a collateral/debt bank pair; derives the fee state.
 * The `order` account must be derived by the caller (see `deriveOrderPda`): the IDL has no pda
 * block for it.
 */
async function makePlaceOrderIx(
  programAddress: Address,
  input: MarginfiAccountPlaceOrderAsyncInput
): Promise<Instruction> {
  return getMarginfiAccountPlaceOrderInstructionAsync(input, { programAddress });
}

/** Closes an order and returns its rent to `feeRecipient`. */
async function makeCloseOrderIx(
  programAddress: Address,
  input: MarginfiAccountCloseOrderInput
): Promise<Instruction> {
  return getMarginfiAccountCloseOrderInstruction(input, { programAddress });
}

/**
 * Refreshes the account's health cache.
 * @param remainingAccounts - Bank/oracle accounts for each active balance.
 */
async function makePulseHealthIx(
  programAddress: Address,
  input: LendingAccountPulseHealthInput,
  remainingAccounts: Address[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    getLendingAccountPulseHealthInstruction(input, { programAddress }),
    remainingAccounts
  );
}

/**
 * Decodes a marginfi instruction into its type (`MarginfiInstruction`), named accounts and args.
 * Doesn't check `programAddress`, so staging deployments decode too.
 * @returns undefined when `ix` isn't a marginfi instruction this IDL knows (unknown discriminator,
 * missing data or too few accounts)
 */
export function parseMarginfiIx(ix: Instruction): ParsedMarginfiInstruction<string> | undefined {
  if (!isInstructionWithData(ix)) return undefined;
  try {
    return parseMarginfiInstruction(ix);
  } catch {
    return undefined;
  }
}

const instructions = {
  makeDepositIx,
  makeJuplendDepositIx,
  makeDriftDepositIx,
  makeKaminoDepositIx,
  makeRepayIx,
  makeWithdrawIx,
  makeJuplendWithdrawIx,
  makeDriftWithdrawIx,
  makeKaminoWithdrawIx,
  makeBorrowIx,
  makeInitMarginfiAccountIx,
  makeInitMarginfiAccountPdaIx,
  makeLendingAccountLiquidateIx,
  makePoolAddBankIx,
  makePoolConfigureBankIx,
  makePoolConfigureBankGovIx,
  makeBeginFlashLoanIx,
  makeEndFlashLoanIx,
  makeAccountTransferToNewAccountIx,
  makeGroupInitIx,
  makeCloseAccountIx,
  makePoolAddPermissionlessStakedBankIx,
  makeLendingPoolConfigureBankOracleIx,
  makeLendingPoolConfigureBankOracleScopeIx,
  makeLendingPoolSetOraclePriceIx,
  makePulseHealthIx,
  makePlaceOrderIx,
  makeCloseOrderIx,
};

export default instructions;
