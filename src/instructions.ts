import {
  AccountRole,
  isInstructionWithData,
  type AccountMeta,
  type Address,
  type Instruction,
} from "@solana/kit";

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
  getLendingPoolConfigureBankInstruction,
  getLendingPoolConfigureBankOracleInstruction,
  getLendingPoolConfigureBankOracleScopeInstruction,
  getLendingPoolSetOraclePriceInstruction,
  getMarginfiAccountCloseInstruction,
  getMarginfiAccountInitializeInstruction,
  getMarginfiAccountInitializePdaInstruction,
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
  type LendingPoolConfigureBankInput,
  type LendingPoolConfigureBankOracleInput,
  type LendingPoolConfigureBankOracleScopeInput,
  type LendingPoolSetOraclePriceInput,
  type MarginfiAccountCloseInput,
  type MarginfiAccountInitializeInput,
  type MarginfiAccountInitializePdaInput,
  type MarginfiGroupInitializeAsyncInput,
  type ParsedMarginfiInstruction,
  type TransferToNewAccountAsyncInput,
} from "./generated/marginfi";

export { MarginfiInstruction } from "./generated/marginfi";

function withRemainingAccounts(ix: Instruction, remainingAccounts: AccountMeta[]): Instruction {
  return { ...ix, accounts: [...(ix.accounts ?? []), ...remainingAccounts] };
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

/**
 * Deposits `amount` (native units) into a JupLend-backed bank.
 * @param remainingAccounts - Token-2022 mint when the bank uses Token-2022.
 */
async function makeJuplendDepositIx(
  programAddress: Address,
  input: JuplendDepositAsyncInput,
  remainingAccounts: AccountMeta[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    await getJuplendDepositInstructionAsync(input, { programAddress }),
    remainingAccounts
  );
}

/**
 * Withdraws `amount` (native units) from a JupLend-backed bank; `withdrawAll` closes the balance.
 * @param remainingAccounts - Token-2022 mint (if any), then health-check bank/oracle accounts.
 */
async function makeJuplendWithdrawIx(
  programAddress: Address,
  input: JuplendWithdrawAsyncInput,
  remainingAccounts: AccountMeta[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    await getJuplendWithdrawInstructionAsync(input, { programAddress }),
    remainingAccounts
  );
}

/**
 * Deposits `amount` (native units) into a Kamino-backed bank; `refreshReserve` refreshes the
 * reserve in-instruction.
 * @param remainingAccounts - Token-2022 mint when the bank uses Token-2022.
 */
async function makeKaminoDepositIx(
  programAddress: Address,
  input: KaminoDepositAsyncInput,
  remainingAccounts: AccountMeta[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    await getKaminoDepositInstructionAsync(input, { programAddress }),
    remainingAccounts
  );
}

/** Deposits `amount` (native units) into a Drift-backed bank. */
async function makeDriftDepositIx(
  programAddress: Address,
  input: DriftDepositAsyncInput
): Promise<Instruction> {
  return getDriftDepositInstructionAsync(input, { programAddress });
}

/**
 * Deposits `amount` (native units) from `signerTokenAccount` into the bank.
 * @param remainingAccounts - Token-2022 mint when the bank uses Token-2022.
 */
async function makeDepositIx(
  programAddress: Address,
  input: LendingAccountDepositInput,
  remainingAccounts: AccountMeta[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    getLendingAccountDepositInstruction(input, { programAddress }),
    remainingAccounts
  );
}

/**
 * Repays `amount` (native units) of the bank's liability; `repayAll` closes the balance.
 * @param remainingAccounts - Token-2022 mint when the bank uses Token-2022.
 */
async function makeRepayIx(
  programAddress: Address,
  input: LendingAccountRepayInput,
  remainingAccounts: AccountMeta[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    getLendingAccountRepayInstruction(input, { programAddress }),
    remainingAccounts
  );
}

/**
 * Withdraws `amount` (native units) from a Drift-backed bank; `withdrawAll` closes the balance.
 * @param remainingAccounts - Token-2022 mint (if any), then health-check bank/oracle accounts.
 */
async function makeDriftWithdrawIx(
  programAddress: Address,
  input: DriftWithdrawAsyncInput,
  remainingAccounts: AccountMeta[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    await getDriftWithdrawInstructionAsync(input, { programAddress }),
    remainingAccounts
  );
}

/**
 * Withdraws `amount` (native units) from a Kamino-backed bank. `isFinalWithdrawal` closes the
 * balance; `refreshReserve` refreshes the reserve via batch refresh.
 * @param remainingAccounts - Token-2022 mint (if any), then health-check bank/oracle accounts.
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
  remainingAccounts: AccountMeta[] = []
): Promise<Instruction> {
  // bit 0 = withdraw all, bit 1 = batch refresh; `None` when no flag is set.
  const flags = (isFinalWithdrawal ? 1 : 0) | (refreshReserve ? 2 : 0);
  return withRemainingAccounts(
    await getKaminoWithdrawInstructionAsync(
      { ...input, flags: flags === 0 ? null : flags },
      { programAddress }
    ),
    remainingAccounts
  );
}

/**
 * Withdraws `amount` (native units) to `destinationTokenAccount`; `withdrawAll` closes the balance.
 * @param remainingAccounts - Token-2022 mint (if any), then health-check bank/oracle accounts.
 */
async function makeWithdrawIx(
  programAddress: Address,
  input: LendingAccountWithdrawAsyncInput,
  remainingAccounts: AccountMeta[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    await getLendingAccountWithdrawInstructionAsync(input, { programAddress }),
    remainingAccounts
  );
}

/**
 * Borrows `amount` (native units) to `destinationTokenAccount`.
 * @param remainingAccounts - Token-2022 mint (if any), then health-check bank/oracle accounts.
 */
async function makeBorrowIx(
  programAddress: Address,
  input: LendingAccountBorrowAsyncInput,
  remainingAccounts: AccountMeta[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    await getLendingAccountBorrowInstructionAsync(input, { programAddress }),
    remainingAccounts
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
  remainingAccounts: AccountMeta[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    await getLendingAccountLiquidateInstructionAsync(input, { programAddress }),
    remainingAccounts
  );
}

/** Updates a bank's config; `null` fields in `bankConfigOpt` are left unchanged. */
async function makePoolConfigureBankIx(
  programAddress: Address,
  input: LendingPoolConfigureBankInput
): Promise<Instruction> {
  return getLendingPoolConfigureBankInstruction(input, { programAddress });
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
 * @param remainingAccounts - Health-check bank/oracle accounts for the projected active banks.
 */
async function makeEndFlashLoanIx(
  programAddress: Address,
  input: LendingAccountEndFlashloanInput,
  remainingAccounts: AccountMeta[] = []
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
 * @param remainingAccounts - The oracle account(s) for `setup` (read-only).
 */
async function makeLendingPoolConfigureBankOracleIx(
  programAddress: Address,
  input: LendingPoolConfigureBankOracleInput,
  remainingAccounts: AccountMeta[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    getLendingPoolConfigureBankOracleInstruction(input, { programAddress }),
    remainingAccounts
  );
}

/** Points a bank at entry `entryIndex` of the Scope OraclePrices account `oracle`. */
async function makeLendingPoolConfigureBankOracleScopeIx(
  programAddress: Address,
  input: LendingPoolConfigureBankOracleScopeInput
): Promise<Instruction> {
  return withRemainingAccounts(
    getLendingPoolConfigureBankOracleScopeInstruction(input, { programAddress }),
    [{ address: input.oracle, role: AccountRole.READONLY }]
  );
}

/**
 * Configures a fixed or Exponent PT oracle price.
 * @param remainingAccounts - Oracle accounts required by `setup` (read-only).
 */
async function makeLendingPoolSetOraclePriceIx(
  programAddress: Address,
  input: LendingPoolSetOraclePriceInput,
  remainingAccounts: AccountMeta[] = []
): Promise<Instruction> {
  return withRemainingAccounts(
    getLendingPoolSetOraclePriceInstruction(input, { programAddress }),
    remainingAccounts
  );
}

/**
 * Adds a permissionless staked-SOL bank; `bankSeed` defaults to 0.
 * @param remainingAccounts - Pyth oracle, SOL pool and bank mint (read-only).
 */
async function makePoolAddPermissionlessStakedBankIx(
  programAddress: Address,
  {
    bankSeed = 0n,
    ...input
  }: Omit<LendingPoolAddBankPermissionlessAsyncInput, "bankSeed"> & {
    bankSeed?: bigint;
  },
  remainingAccounts: AccountMeta[] = []
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

/** Closes an empty marginfi account and returns rent to `feePayer`. */
async function makeCloseAccountIx(
  programAddress: Address,
  input: MarginfiAccountCloseInput
): Promise<Instruction> {
  return getMarginfiAccountCloseInstruction(input, { programAddress });
}

/**
 * Refreshes the account's health cache.
 * @param remainingAccounts - Bank/oracle accounts for each active balance.
 */
async function makePulseHealthIx(
  programAddress: Address,
  input: LendingAccountPulseHealthInput,
  remainingAccounts: AccountMeta[] = []
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
};

export default instructions;
