import { PublicKey, AddressLookupTableAccount } from "@solana/web3.js";
import BN from "bn.js";

import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@mrgnlabs/mrgn-common";

import { BankType } from "../services/bank";
import { MarginfiAccountType } from "../services";
import {
  deriveUserState,
  FARMS_PROGRAM_ID,
  getAllDerivedKaminoAccounts,
  KLEND_PROGRAM_ID,
  ReserveRaw,
} from "../vendor";

import {
  deriveBankLiquidityVault,
  deriveBankLiquidityVaultAuthority,
} from "./pda.utils";

/**
 * Transaction Size Calculator for Flashloan Operations
 *
 * Calculates exact byte size of transactions before building them,
 * accounting for address lookup tables and instruction composition.
 */

// ============================================================================
// Constants
// ============================================================================

const MAX_TX_SIZE = 1232; // Maximum transaction size in bytes

/**
 * Encodes a number as a compact-u16 (Solana shortvec encoding)
 * Returns the byte length needed
 * Variable-length encoding with no upper bound
 */
function getCompactU16Size(value: number): number {
  if (value < 0) throw new Error("Negative values not supported in shortvec");
  let bytes = 0;
  let v = value >>> 0; // Convert to unsigned 32-bit
  do {
    bytes++;
    v >>>= 7;
  } while (v > 0);
  return bytes;
}

/**
 * Gets the actual bytes for compact-u16 encoding
 */
function encodeCompactU16Length(value: number): number {
  return getCompactU16Size(value);
}

// ============================================================================
// Transaction Structure Overhead
// ============================================================================

function calculateTransactionOverhead(numSigners: number): number {
  return (
    encodeCompactU16Length(numSigners) + // signature count (compact-u16)
    64 * numSigners + // signatures
    1 + // message version (0x80 for v0)
    3 + // message header
    32 // recent blockhash
  );
}

// ============================================================================
// LUT Account Tracking
// ============================================================================

/**
 * Builds maps of which accounts come from which LUT, split by writable vs readonly
 * Returns: { writable: Map<lutIndex, Set<accountKey>>, readonly: Map<lutIndex, Set<accountKey>> }
 */
function buildLutAccountMaps(
  allAccounts: Set<string>,
  writableAccounts: Set<string>,
  luts: AddressLookupTableAccount[]
): {
  writable: Map<number, Set<string>>;
  readonly: Map<number, Set<string>>;
} {
  const writableLutMap = new Map<number, Set<string>>();
  const readonlyLutMap = new Map<number, Set<string>>();

  // Initialize sets for each LUT
  luts.forEach((_, index) => {
    writableLutMap.set(index, new Set<string>());
    readonlyLutMap.set(index, new Set<string>());
  });

  // For each account, check if it's in any LUT and whether it's writable
  allAccounts.forEach((accountKey) => {
    const pubkey = new PublicKey(accountKey);
    const isWritable = writableAccounts.has(accountKey);

    luts.forEach((lut, lutIndex) => {
      if (lut.state.addresses.some((addr) => addr.equals(pubkey))) {
        if (isWritable) {
          writableLutMap.get(lutIndex)!.add(accountKey);
        } else {
          readonlyLutMap.get(lutIndex)!.add(accountKey);
        }
      }
    });
  });

  return { writable: writableLutMap, readonly: readonlyLutMap };
}

/**
 * Helper to add accounts and track their mutability
 */
function addAccounts(
  allAccounts: Set<string>,
  writableAccounts: Set<string>,
  accounts: PublicKey[],
  writableIndices: number[]
) {
  accounts.forEach((acc, index) => {
    const key = acc.toBase58();
    allAccounts.add(key);
    if (writableIndices.includes(index)) {
      writableAccounts.add(key);
    }
  });
}

/**
 * Compute health check banks based on active balances
 * Mirrors computeHealthCheckAccounts from compute.utils.ts
 */
function computeHealthCheckBanks(
  activeBalances: Array<{ active: boolean; bankPk: PublicKey }>,
  allBanks: Map<string, BankType>,
  mandatoryBanks: PublicKey[] = [],
  excludedBanks: PublicKey[] = []
): BankType[] {
  const balancesActive = activeBalances.filter((b) => b.active);

  const mandatoryBanksSet = new Set(mandatoryBanks.map((b) => b.toBase58()));
  const excludedBanksSet = new Set(excludedBanks.map((b) => b.toBase58()));
  const activeBanksSet = new Set(
    balancesActive.map((b) => b.bankPk.toBase58())
  );
  const banksToAdd = new Set(
    [...mandatoryBanksSet].filter((x) => !activeBanksSet.has(x))
  );

  let slotsToKeep = banksToAdd.size;
  const projectedActiveBanks = activeBalances
    .filter((balance) => {
      if (balance.active) {
        return !excludedBanksSet.has(balance.bankPk.toBase58());
      } else if (slotsToKeep > 0) {
        slotsToKeep--;
        return true;
      } else {
        return false;
      }
    })
    .map((balance) => {
      if (balance.active) {
        const bank = allBanks.get(balance.bankPk.toBase58());
        if (!bank) throw Error(`Bank ${balance.bankPk.toBase58()} not found`);
        return bank;
      }
      const newBankAddress = [...banksToAdd.values()][0]!;
      banksToAdd.delete(newBankAddress);
      const bank = allBanks.get(newBankAddress);
      if (!bank) throw Error(`Bank ${newBankAddress} not found`);
      return bank;
    });

  return projectedActiveBanks;
}

/**
 * Simulate projected active banks after withdraw and repay
 * Mirrors computeProjectedActiveBanksNoCpi logic
 */
function computeProjectedActiveBanks(
  activeBalances: Array<{ active: boolean; bankPk: PublicKey }>,
  actions: {
    bank: BankType;
    fullAmount: boolean;
    actionType: "withdraw" | "repay" | "deposit" | "borrow";
  }[]
): Array<{ active: boolean; bankPk: PublicKey }> {
  const projected = activeBalances.map((b) => ({
    active: b.active,
    bankPk: b.bankPk,
  }));

  for (const action of actions) {
    switch (action.actionType) {
      case "withdraw":
        if (action.fullAmount) {
          const withdrawBalance = projected.find((b) =>
            b.bankPk.equals(action.bank.address)
          );
          if (withdrawBalance) {
            withdrawBalance.active = false;
            // Keep the bankPk - don't set to PublicKey.default
          }
        }
        break;
      case "repay":
        if (action.fullAmount) {
          const repayBalance = projected.find((b) =>
            b.bankPk.equals(action.bank.address)
          );
          if (repayBalance) {
            repayBalance.active = false;
            // Keep the bankPk - don't set to PublicKey.default
          }
        }
        break;
      case "deposit":
        const depositBalance = projected.find((b) =>
          b.bankPk.equals(action.bank.address)
        );
        if (!depositBalance) {
          projected.push({
            active: true,
            bankPk: action.bank.address,
          });
        }
        break;
      case "borrow":
        const borrowBalance = projected.find((b) =>
          b.bankPk.equals(action.bank.address)
        );
        if (!borrowBalance) {
          projected.push({
            active: true,
            bankPk: action.bank.address,
          });
        }
        break;
    }
  }

  // Simulate withdraw - only mark as inactive if withdrawAll

  // Simulate repay - only mark as inactive if repayAll

  return projected;
}

// ============================================================================
// Instruction Data Sizes
// ============================================================================

/**
 * Calculate size for begin flashloan instruction data
 * Discriminator (8) + endIndex (u64 = 8)
 */
function getBeginFlashloanDataSize(endIndex: BN): number {
  return 8 + 8;
}

/**
 * Calculate size for end flashloan instruction data
 * Discriminator (8) only, no args
 */
function getEndFlashloanDataSize(): number {
  return 8;
}

/**
 * Calculate size for withdraw instruction data
 * Discriminator (8) + amount (u64 = 8) + withdrawAll (Option<bool> = 2)
 */
function getWithdrawDataSize(): number {
  return 8 + 8 + 2; // discriminator + amount + option<bool>
}

/**
 * Calculate size for repay instruction data
 * Discriminator (8) + amount (u64 = 8) + repayAll (Option<bool> = 2)
 */
function getRepayDataSize(): number {
  return 8 + 8 + 2; // discriminator + amount + option<bool>
}

/**
 * Calculate size for Kamino withdraw instruction data
 * Discriminator (8) + amount (u64 = 8) + isFinalWithdrawal (Option<bool> = 2)
 */
function getKaminoWithdrawDataSize(): number {
  return 8 + 8 + 2; // discriminator + amount + option<bool>
}

/**
 * Calculate size for deposit instruction data
 * Discriminator (8) + amount (u64 = 8) + depositUpToLimit (Option<bool> = 2)
 */
function getDepositDataSize(): number {
  return 8 + 8 + 2; // discriminator + amount + option<bool>
}

/**
 * Calculate size for Kamino deposit instruction data
 * Discriminator (8) + amount (u64 = 8)
 */
function getKaminoDepositDataSize(): number {
  return 8 + 8; // discriminator + amount
}

/**
 * Calculate size for borrow instruction data
 * Discriminator (8) + amount (u64 = 8)
 */
function getBorrowDataSize(): number {
  return 8 + 8; // discriminator + amount
}

/**
 * Calculate size for priority fee instruction data
 * Compute Budget program uses 1-byte discriminators (native program, not Anchor)
 * SetComputeUnitLimit: 1 + 4 (u32)
 * SetComputeUnitPrice: 1 + 8 (u64)
 */
function getPriorityFeeDataSize(): number {
  // Typically uses SetComputeUnitPrice
  return 1 + 8; // 1 byte discriminator + u64 price
}

// ============================================================================
// Instruction Account Counts (from IDL)
// ============================================================================

/**
 * Begin flashloan accounts:
 * - marginfiAccount (writable)
 * - authority (signer)
 * - ixsSysvar
 */
function getBeginFlashloanAccounts(
  marginfiAccount: PublicKey,
  authority: PublicKey
): PublicKey[] {
  return [
    marginfiAccount,
    authority,
    new PublicKey("Sysvar1nstructions1111111111111111111111111"), // ixsSysvar
  ];
}

/**
 * End flashloan accounts:
 * - marginfiAccount (writable)
 * - authority (signer)
 * + remaining accounts (banks for health check)
 *
 * Remaining accounts per bank:
 * - bank.address
 * - bank.oracleKey
 * - bank.kaminoReserve (if kamino bank, assetTag === 3)
 */
function getEndFlashloanAccounts(
  marginfiAccount: PublicKey,
  authority: PublicKey,
  banks: BankType[]
): PublicKey[] {
  const baseAccounts = [marginfiAccount, authority];

  // Add remaining accounts for each bank (health check)
  const remainingAccounts: PublicKey[] = [];
  banks.forEach((bank) => {
    remainingAccounts.push(bank.address, bank.oracleKey);
    // If kamino bank (assetTag === 3), include kamino reserve
    if (bank.config.assetTag === 3) {
      remainingAccounts.push(bank.kaminoReserve);
    }
  });

  return [...baseAccounts, ...remainingAccounts];
}

/**
 * Withdraw base accounts (without remaining accounts):
 * - group
 * - marginfiAccount (writable)
 * - authority (signer)
 * - bank (writable)
 * - destinationTokenAccount (writable)
 * - bankLiquidityVaultAuthority
 * - liquidityVault (writable)
 * - tokenProgram
 */
function getWithdrawBaseAccounts(
  group: PublicKey,
  marginfiAccount: PublicKey,
  authority: PublicKey,
  bank: PublicKey,
  destinationTokenAccount: PublicKey,
  bankLiquidityVaultAuthority: PublicKey,
  liquidityVault: PublicKey,
  tokenProgram: PublicKey
): PublicKey[] {
  return [
    group,
    marginfiAccount,
    authority,
    bank,
    destinationTokenAccount,
    bankLiquidityVaultAuthority,
    liquidityVault,
    tokenProgram,
  ];
}

/**
 * Repay base accounts (without remaining accounts):
 * - group
 * - marginfiAccount (writable)
 * - authority (signer)
 * - bank (writable)
 * - signerTokenAccount (writable)
 * - liquidityVault (writable)
 * - tokenProgram
 */
function getRepayBaseAccounts(
  group: PublicKey,
  marginfiAccount: PublicKey,
  authority: PublicKey,
  bank: PublicKey,
  signerTokenAccount: PublicKey,
  liquidityVault: PublicKey,
  tokenProgram: PublicKey
): PublicKey[] {
  return [
    group,
    marginfiAccount,
    authority,
    bank,
    signerTokenAccount,
    liquidityVault,
    tokenProgram,
  ];
}

/**
 * Deposit base accounts (without remaining accounts):
 * - group
 * - marginfiAccount (writable)
 * - authority (signer)
 * - bank (writable)
 * - signerTokenAccount (writable)
 * - liquidityVault (writable)
 * - tokenProgram
 */
function getDepositBaseAccounts(
  group: PublicKey,
  marginfiAccount: PublicKey,
  authority: PublicKey,
  bank: PublicKey,
  signerTokenAccount: PublicKey,
  liquidityVault: PublicKey,
  tokenProgram: PublicKey
): PublicKey[] {
  return [
    group,
    marginfiAccount,
    authority,
    bank,
    signerTokenAccount,
    liquidityVault,
    tokenProgram,
  ];
}

/**
 * Borrow base accounts (without remaining accounts):
 * - group
 * - marginfiAccount (writable)
 * - authority (signer)
 * - bank (writable)
 * - destinationTokenAccount (writable)
 * - bankLiquidityVaultAuthority
 * - liquidityVault (writable)
 * - tokenProgram
 */
function getBorrowBaseAccounts(
  group: PublicKey,
  marginfiAccount: PublicKey,
  authority: PublicKey,
  bank: PublicKey,
  destinationTokenAccount: PublicKey,
  bankLiquidityVaultAuthority: PublicKey,
  liquidityVault: PublicKey,
  tokenProgram: PublicKey
): PublicKey[] {
  return [
    group,
    marginfiAccount,
    authority,
    bank,
    destinationTokenAccount,
    bankLiquidityVaultAuthority,
    liquidityVault,
    tokenProgram,
  ];
}

/**
 * Kamino withdraw base accounts (without remaining accounts):
 * - group
 * - marginfiAccount (writable)
 * - authority (signer)
 * - bank (writable)
 * - destinationTokenAccount (writable)
 * - liquidityVaultAuthority (writable)
 * - liquidityVault (writable)
 * - kaminoObligation (writable)
 * - lendingMarket
 * - lendingMarketAuthority
 * - kaminoReserve (writable)
 * - reserveLiquidityMint (writable)
 * - reserveLiquiditySupply (writable)
 * - reserveCollateralMint (writable)
 * - reserveSourceCollateral (writable)
 * - [optional] obligationFarmUserState (writable)
 * - [optional] reserveFarmState (writable)
 * - kaminoProgram
 * - farmsProgram
 * - tokenProgram
 * - liquidityTokenProgram
 * - instructionSysvarAccount
 */
function getKaminoWithdrawBaseAccounts(
  group: PublicKey,
  marginfiAccount: PublicKey,
  authority: PublicKey,
  bank: PublicKey,
  destinationTokenAccount: PublicKey,
  liquidityVaultAuthority: PublicKey,
  liquidityVault: PublicKey,
  kaminoObligation: PublicKey,
  lendingMarket: PublicKey,
  lendingMarketAuthority: PublicKey,
  kaminoReserve: PublicKey,
  reserveLiquidityMint: PublicKey,
  reserveLiquiditySupply: PublicKey,
  reserveCollateralMint: PublicKey,
  reserveSourceCollateral: PublicKey,
  kaminoProgram: PublicKey,
  farmsProgram: PublicKey,
  tokenProgram: PublicKey,
  liquidityTokenProgram: PublicKey,
  instructionSysvarAccount: PublicKey,
  obligationFarmUserState?: PublicKey,
  reserveFarmState?: PublicKey
): PublicKey[] {
  const accounts = [
    group,
    marginfiAccount,
    authority,
    bank,
    destinationTokenAccount,
    liquidityVaultAuthority,
    liquidityVault,
    kaminoObligation,
    lendingMarket,
    lendingMarketAuthority,
    kaminoReserve,
    reserveLiquidityMint,
    reserveLiquiditySupply,
    reserveCollateralMint,
    reserveSourceCollateral,
  ];

  if (obligationFarmUserState) accounts.push(obligationFarmUserState);
  if (reserveFarmState) accounts.push(reserveFarmState);

  accounts.push(
    kaminoProgram,
    farmsProgram,
    tokenProgram,
    liquidityTokenProgram,
    instructionSysvarAccount
  );

  return accounts;
}

/**
 * Kamino deposit base accounts (without remaining accounts):
 * - group
 * - marginfiAccount (writable)
 * - authority (signer)
 * - bank (writable)
 * - signerTokenAccount (writable)
 * - liquidityVaultAuthority (writable)
 * - liquidityVault (writable)
 * - kaminoObligation (writable)
 * - lendingMarket
 * - lendingMarketAuthority
 * - kaminoReserve (writable)
 * - mint
 * - reserveLiquidityMint (writable)
 * - reserveLiquiditySupply (writable)
 * - reserveCollateralMint (writable)
 * - reserveDestinationDepositCollateral (writable)
 * - [optional] obligationFarmUserState (writable)
 * - [optional] reserveFarmState (writable)
 * - kaminoProgram
 * - farmsProgram
 * - tokenProgram
 * - liquidityTokenProgram
 * - instructionSysvarAccount
 */
function getKaminoDepositBaseAccounts(
  group: PublicKey,
  marginfiAccount: PublicKey,
  authority: PublicKey,
  bank: PublicKey,
  signerTokenAccount: PublicKey,
  liquidityVaultAuthority: PublicKey,
  liquidityVault: PublicKey,
  kaminoObligation: PublicKey,
  lendingMarket: PublicKey,
  lendingMarketAuthority: PublicKey,
  kaminoReserve: PublicKey,
  mint: PublicKey,
  reserveLiquidityMint: PublicKey,
  reserveLiquiditySupply: PublicKey,
  reserveCollateralMint: PublicKey,
  reserveDestinationDepositCollateral: PublicKey,
  kaminoProgram: PublicKey,
  farmsProgram: PublicKey,
  tokenProgram: PublicKey,
  liquidityTokenProgram: PublicKey,
  instructionSysvarAccount: PublicKey,
  obligationFarmUserState?: PublicKey,
  reserveFarmState?: PublicKey
): PublicKey[] {
  const accounts = [
    group,
    marginfiAccount,
    authority,
    bank,
    signerTokenAccount,
    liquidityVaultAuthority,
    liquidityVault,
    kaminoObligation,
    lendingMarket,
    lendingMarketAuthority,
    kaminoReserve,
    mint,
    reserveLiquidityMint,
    reserveLiquiditySupply,
    reserveCollateralMint,
    reserveDestinationDepositCollateral,
  ];

  if (obligationFarmUserState) accounts.push(obligationFarmUserState);
  if (reserveFarmState) accounts.push(reserveFarmState);

  accounts.push(
    kaminoProgram,
    farmsProgram,
    tokenProgram,
    liquidityTokenProgram,
    instructionSysvarAccount
  );

  return accounts;
}

// ============================================================================
// Single Instruction Size Calculator
// ============================================================================

interface InstructionSize {
  programIdIndex: number; // 1 byte (index into account keys, always 1 byte for size modeling)
  accountsLength: number; // compact-u16
  accountIndexes: number; // N bytes (1 byte per account)
  dataLength: number; // compact-u16
  data: number; // N bytes
  total: number;
}

function calculateSingleInstructionSize(
  accounts: PublicKey[],
  dataSize: number
): InstructionSize {
  const accountsLength = encodeCompactU16Length(accounts.length);
  const dataLength = encodeCompactU16Length(dataSize);

  return {
    programIdIndex: 1, // Size-only: program ID index is always 1 byte regardless of actual index value
    accountsLength,
    accountIndexes: accounts.length, // 1 byte per account index
    dataLength,
    data: dataSize,
    total: 1 + accountsLength + accounts.length + dataLength + dataSize,
  };
}

function calculateWithdrawSize(params: {
  marginfiAccount: MarginfiAccountType;
  group: PublicKey;
  programId: PublicKey;

  activeBalances: Array<{ active: boolean; bankPk: PublicKey }>;
  allBanks: Map<string, BankType>;
  luts: AddressLookupTableAccount[];

  withdrawAll: boolean;
  withdrawBank: BankType;
  withdrawTokenProgram: PublicKey;
  kaminoReserve?: ReserveRaw;
}): {
  fullWithdrawAccounts: PublicKey[];
  withdrawWritableIndices: number[];
  withdrawIxSize: InstructionSize;
} {
  const withdrawHealthBanks = computeHealthCheckBanks(
    params.activeBalances,
    params.allBanks,
    params.withdrawAll ? [] : [params.withdrawBank.address],
    params.withdrawAll ? [params.withdrawBank.address] : []
  );

  // Build withdraw remaining accounts
  const withdrawRemainingAccounts: PublicKey[] = [];
  if (params.withdrawTokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    withdrawRemainingAccounts.push(params.withdrawBank.mint);
  }
  withdrawHealthBanks.forEach((bank) => {
    withdrawRemainingAccounts.push(bank.address, bank.oracleKey);
    // Only add kamino reserve if it exists (for Kamino banks)
    if (bank.config.assetTag === 3 && bank.kaminoReserve) {
      withdrawRemainingAccounts.push(bank.kaminoReserve);
    }
  });

  // Fetch destination token account
  const destinationTokenAccount = getAssociatedTokenAddressSync(
    params.withdrawBank.mint,
    params.marginfiAccount.authority,
    true,
    params.withdrawTokenProgram
  );

  // Build base withdraw accounts
  let baseWithdrawAccounts: PublicKey[];
  let withdrawDataSize: number;
  const isKaminoWithdraw = params.withdrawBank.config.assetTag === 3;

  // Derive PDAs for liquidity vaults
  const [withdrawLiquidityVaultAuthority] = deriveBankLiquidityVaultAuthority(
    params.programId,
    params.withdrawBank.address
  );
  const [withdrawLiquidityVault] = deriveBankLiquidityVault(
    params.programId,
    params.withdrawBank.address
  );

  if (isKaminoWithdraw && params.kaminoReserve) {
    const {
      lendingMarketAuthority,
      reserveLiquiditySupply,
      reserveCollateralMint,
      reserveDestinationDepositCollateral,
    } = getAllDerivedKaminoAccounts(
      params.kaminoReserve.lendingMarket,
      params.withdrawBank.mint
    );

    const reserveFarm = !params.kaminoReserve.farmCollateral.equals(
      new PublicKey("11111111111111111111111111111111")
    )
      ? params.kaminoReserve.farmCollateral
      : null;

    const [userFarmState] = reserveFarm
      ? deriveUserState(
          FARMS_PROGRAM_ID,
          reserveFarm,
          params.withdrawBank.kaminoObligation
        )
      : [null];

    baseWithdrawAccounts = getKaminoWithdrawBaseAccounts(
      params.group,
      params.marginfiAccount.address,
      params.marginfiAccount.authority,
      params.withdrawBank.address,
      destinationTokenAccount,
      withdrawLiquidityVaultAuthority,
      withdrawLiquidityVault,
      params.withdrawBank.kaminoObligation,
      params.kaminoReserve.lendingMarket,
      lendingMarketAuthority,
      params.withdrawBank.kaminoReserve,
      params.withdrawBank.mint,
      reserveLiquiditySupply,
      reserveCollateralMint,
      reserveDestinationDepositCollateral,
      KLEND_PROGRAM_ID,
      FARMS_PROGRAM_ID,
      params.withdrawTokenProgram,
      params.withdrawTokenProgram,
      new PublicKey("Sysvar1nstructions1111111111111111111111111"),
      userFarmState ?? undefined,
      reserveFarm ?? undefined
    );
    withdrawDataSize = getKaminoWithdrawDataSize();
  } else {
    baseWithdrawAccounts = getWithdrawBaseAccounts(
      params.group,
      params.marginfiAccount.address,
      params.marginfiAccount.authority,
      params.withdrawBank.address,
      destinationTokenAccount,
      withdrawLiquidityVaultAuthority,
      withdrawLiquidityVault,
      params.withdrawTokenProgram
    );
    withdrawDataSize = getWithdrawDataSize();
  }

  // Build full account list - instruction accounts can have duplicates!
  // The global message account list is deduplicated, but instruction account indexes
  // can reference the same account multiple times (e.g., health check banks that are also base accounts)
  const fullWithdrawAccounts = [
    ...baseWithdrawAccounts,
    ...withdrawRemainingAccounts,
  ];

  // Determine writable indices for withdraw
  // For Kamino: base accounts have many writables
  // For regular: simple writable pattern
  // Health check remaining accounts are all READONLY
  let withdrawWritableIndices: number[];
  if (isKaminoWithdraw) {
    // Kamino base accounts writable indices
    withdrawWritableIndices = [1, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14];
    // NOTE: remaining accounts (health check banks) are all readonly
  } else {
    // Regular withdraw: marginfiAccount(1), bank(3), destinationTokenAccount(4), liquidityVault(6)
    withdrawWritableIndices = [1, 3, 4, 6];
    // NOTE: remaining accounts (health check banks) are all readonly
  }

  const withdraw = calculateSingleInstructionSize(
    fullWithdrawAccounts,
    withdrawDataSize
  );

  return {
    fullWithdrawAccounts,
    withdrawWritableIndices,
    withdrawIxSize: withdraw,
  };
}

function calculateRepaySize(params: {
  marginfiAccount: MarginfiAccountType;
  group: PublicKey;
  programId: PublicKey;

  activeBalances: Array<{ active: boolean; bankPk: PublicKey }>;
  allBanks: Map<string, BankType>;
  luts: AddressLookupTableAccount[];

  repayAll: boolean;
  repayBank: BankType;
  repayTokenProgram: PublicKey;
  kaminoReserve?: ReserveRaw;
}): {
  fullRepayAccounts: PublicKey[];
  repayWritableIndices: number[];
  repayIxSize: InstructionSize;
} {
  const repayRemainingAccounts: PublicKey[] = [];
  if (params.repayTokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    repayRemainingAccounts.push(params.repayBank.mint);
  }

  const signerTokenAccount = getAssociatedTokenAddressSync(
    params.repayBank.mint,
    params.marginfiAccount.authority,
    true,
    params.repayTokenProgram
  );

  const [repayLiquidityVault] = deriveBankLiquidityVault(
    params.programId,
    params.repayBank.address
  );

  const baseRepayAccounts = getRepayBaseAccounts(
    params.group,
    params.marginfiAccount.address,
    params.marginfiAccount.authority,
    params.repayBank.address,
    signerTokenAccount,
    repayLiquidityVault,
    params.repayTokenProgram
  );

  const fullRepayAccounts = [...baseRepayAccounts, ...repayRemainingAccounts];
  const repayDataSize = getRepayDataSize();

  const repay = calculateSingleInstructionSize(
    fullRepayAccounts,
    repayDataSize
  );

  return {
    fullRepayAccounts,
    repayWritableIndices: [1, 3, 4, 5],
    repayIxSize: repay,
  };
}

function calculateDepositSize(params: {
  marginfiAccount: MarginfiAccountType;
  group: PublicKey;
  programId: PublicKey;

  activeBalances: Array<{ active: boolean; bankPk: PublicKey }>;
  allBanks: Map<string, BankType>;
  luts: AddressLookupTableAccount[];

  depositBank: BankType;
  depositTokenProgram: PublicKey;
  kaminoReserve?: ReserveRaw;
}): {
  fullDepositAccounts: PublicKey[];
  depositWritableIndices: number[];
  depositIxSize: InstructionSize;
} {
  // Compute health check banks - deposit adds new position
  const depositHealthBanks = computeHealthCheckBanks(
    params.activeBalances,
    params.allBanks,
    [params.depositBank.address], // Adding this bank
    [] // Not removing any banks
  );

  // Build deposit remaining accounts
  const depositRemainingAccounts: PublicKey[] = [];
  if (params.depositTokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    depositRemainingAccounts.push(params.depositBank.mint);
  }
  depositHealthBanks.forEach((bank) => {
    depositRemainingAccounts.push(bank.address, bank.oracleKey);
    // Only add kamino reserve if it exists (for Kamino banks)
    if (bank.config.assetTag === 3 && bank.kaminoReserve) {
      depositRemainingAccounts.push(bank.kaminoReserve);
    }
  });

  // Fetch signer token account
  const signerTokenAccount = getAssociatedTokenAddressSync(
    params.depositBank.mint,
    params.marginfiAccount.authority,
    true,
    params.depositTokenProgram
  );

  // Build base deposit accounts
  let baseDepositAccounts: PublicKey[];
  let depositDataSize: number;
  const isKaminoDeposit = params.depositBank.config.assetTag === 3;

  // Derive PDAs for liquidity vaults
  const [depositLiquidityVaultAuthority] = deriveBankLiquidityVaultAuthority(
    params.programId,
    params.depositBank.address
  );
  const [depositLiquidityVault] = deriveBankLiquidityVault(
    params.programId,
    params.depositBank.address
  );

  if (isKaminoDeposit && params.kaminoReserve) {
    const {
      lendingMarketAuthority,
      reserveLiquiditySupply,
      reserveCollateralMint,
      reserveDestinationDepositCollateral,
    } = getAllDerivedKaminoAccounts(
      params.kaminoReserve.lendingMarket,
      params.depositBank.mint
    );

    const reserveFarm = !params.kaminoReserve.farmCollateral.equals(
      new PublicKey("11111111111111111111111111111111")
    )
      ? params.kaminoReserve.farmCollateral
      : null;

    const [userFarmState] = reserveFarm
      ? deriveUserState(
          FARMS_PROGRAM_ID,
          reserveFarm,
          params.depositBank.kaminoObligation
        )
      : [null];

    baseDepositAccounts = getKaminoDepositBaseAccounts(
      params.group,
      params.marginfiAccount.address,
      params.marginfiAccount.authority,
      params.depositBank.address,
      signerTokenAccount,
      depositLiquidityVaultAuthority,
      depositLiquidityVault,
      params.depositBank.kaminoObligation,
      params.kaminoReserve.lendingMarket,
      lendingMarketAuthority,
      params.depositBank.kaminoReserve,
      params.depositBank.mint,
      params.depositBank.mint, // reserveLiquidityMint
      reserveLiquiditySupply,
      reserveCollateralMint,
      reserveDestinationDepositCollateral,
      KLEND_PROGRAM_ID,
      FARMS_PROGRAM_ID,
      params.depositTokenProgram, // tokenProgram
      params.depositTokenProgram, // liquidityTokenProgram
      new PublicKey("Sysvar1nstructions1111111111111111111111111"),
      userFarmState ?? undefined,
      reserveFarm ?? undefined
    );
    depositDataSize = getKaminoDepositDataSize();
  } else {
    baseDepositAccounts = getDepositBaseAccounts(
      params.group,
      params.marginfiAccount.address,
      params.marginfiAccount.authority,
      params.depositBank.address,
      signerTokenAccount,
      depositLiquidityVault,
      params.depositTokenProgram
    );
    depositDataSize = getDepositDataSize();
  }

  // Build full account list - instruction accounts can have duplicates!
  const fullDepositAccounts = [
    ...baseDepositAccounts,
    ...depositRemainingAccounts,
  ];

  // Determine writable indices for deposit
  // For Kamino: base accounts have many writables
  // For regular: simple writable pattern
  // Health check remaining accounts are all READONLY
  let depositWritableIndices: number[];
  if (isKaminoDeposit) {
    // Kamino base accounts writable indices
    // Similar to withdraw but for deposit: marginfiAccount(1), bank(3), signerTokenAccount(4),
    // liquidityVaultAuthority(5), liquidityVault(6), kaminoObligation(7), kaminoReserve(10),
    // reserveLiquidityMint(12), reserveLiquiditySupply(13), reserveCollateralMint(14),
    // reserveDestinationDepositCollateral(15)
    depositWritableIndices = [1, 3, 4, 5, 6, 7, 10, 12, 13, 14, 15];
    // NOTE: remaining accounts (health check banks) are all readonly
  } else {
    // Regular deposit: marginfiAccount(1), bank(3), signerTokenAccount(4), liquidityVault(5)
    depositWritableIndices = [1, 3, 4, 5];
    // NOTE: remaining accounts (health check banks) are all readonly
  }

  const deposit = calculateSingleInstructionSize(
    fullDepositAccounts,
    depositDataSize
  );

  return {
    fullDepositAccounts,
    depositWritableIndices,
    depositIxSize: deposit,
  };
}

function calculateBorrowSize(params: {
  marginfiAccount: MarginfiAccountType;
  group: PublicKey;
  programId: PublicKey;

  activeBalances: Array<{ active: boolean; bankPk: PublicKey }>;
  allBanks: Map<string, BankType>;
  luts: AddressLookupTableAccount[];

  borrowBank: BankType;
  borrowTokenProgram: PublicKey;
}): {
  fullBorrowAccounts: PublicKey[];
  borrowWritableIndices: number[];
  borrowIxSize: InstructionSize;
} {
  // Compute health check banks - borrow adds new position
  const borrowHealthBanks = computeHealthCheckBanks(
    params.activeBalances,
    params.allBanks,
    [params.borrowBank.address], // Adding this bank
    [] // Not removing any banks
  );

  // Build borrow remaining accounts
  const borrowRemainingAccounts: PublicKey[] = [];
  if (params.borrowTokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    borrowRemainingAccounts.push(params.borrowBank.mint);
  }
  borrowHealthBanks.forEach((bank) => {
    borrowRemainingAccounts.push(bank.address, bank.oracleKey);
    // Only add kamino reserve if it exists (for Kamino banks)
    if (bank.config.assetTag === 3 && bank.kaminoReserve) {
      borrowRemainingAccounts.push(bank.kaminoReserve);
    }
  });

  // Fetch destination token account (where borrowed tokens go)
  const destinationTokenAccount = getAssociatedTokenAddressSync(
    params.borrowBank.mint,
    params.marginfiAccount.authority,
    true,
    params.borrowTokenProgram
  );

  // Derive PDAs for liquidity vaults
  const [borrowLiquidityVaultAuthority] = deriveBankLiquidityVaultAuthority(
    params.programId,
    params.borrowBank.address
  );
  const [borrowLiquidityVault] = deriveBankLiquidityVault(
    params.programId,
    params.borrowBank.address
  );

  // Build base borrow accounts (no Kamino variant for borrow)
  const baseBorrowAccounts = getBorrowBaseAccounts(
    params.group,
    params.marginfiAccount.address,
    params.marginfiAccount.authority,
    params.borrowBank.address,
    destinationTokenAccount,
    borrowLiquidityVaultAuthority,
    borrowLiquidityVault,
    params.borrowTokenProgram
  );

  // Build full account list - instruction accounts can have duplicates!
  const fullBorrowAccounts = [
    ...baseBorrowAccounts,
    ...borrowRemainingAccounts,
  ];

  // Borrow writable indices: marginfiAccount(1), bank(3), destinationTokenAccount(4), liquidityVault(6)
  // Health check remaining accounts are all READONLY
  const borrowWritableIndices = [1, 3, 4, 6];

  const borrowDataSize = getBorrowDataSize();
  const borrow = calculateSingleInstructionSize(
    fullBorrowAccounts,
    borrowDataSize
  );

  return {
    fullBorrowAccounts,
    borrowWritableIndices,
    borrowIxSize: borrow,
  };
}

// ============================================================================
// Main Calculator
// ============================================================================

interface FlashloanTxSizeParams {
  marginfiAccount: MarginfiAccountType;
  group: PublicKey;
  programId: PublicKey;
  actions: {
    bank: BankType;
    tokenProgram: PublicKey;
    fullAmount: boolean;
    kaminoReserve?: ReserveRaw;
    actionType: "withdraw" | "repay" | "deposit" | "borrow";
  }[];
  allBanks: Map<string, BankType>; // All banks for lookups
  activeBalances: Array<{ active: boolean; bankPk: PublicKey }>; // User's balances

  luts: AddressLookupTableAccount[];

  includeInstructions: {
    includeComputeBudget: boolean; // Whether compute budget instruction is included
    includePriorityFee: boolean;
  };

  numSigners?: number;
}

export function calculateFlashloanTxSize(params: FlashloanTxSizeParams): {
  txSize: number;
  staticAccountCount: number;
  availableAccountKeys: number;
  existingAccounts: Set<string>; // For Jupiter to check duplicates
} {
  const numSigners = params.numSigners || 1;
  const overhead = calculateTransactionOverhead(numSigners);

  // Calculate instruction sizes and collect accounts
  const allAccounts = new Set<string>();
  const writableAccounts = new Set<string>(); // Track which accounts are writable
  const programId = new PublicKey(
    "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"
  ); // Marginfi program ID

  // Add fee payer (always present, always writable)
  const feePayer = params.marginfiAccount.authority;
  allAccounts.add(feePayer.toBase58());
  writableAccounts.add(feePayer.toBase58());

  // Add Marginfi program ID - it goes to static accounts when used as instruction program ID
  allAccounts.add(programId.toBase58());

  // NOTE: Kamino and Farms program IDs are NOT added here
  // They remain in LUTs since they're not used as instruction program IDs in flashloan txs
  // (All instructions use Marginfi program ID)

  // 1. Begin flashloan
  const beginFlashloanAccounts = getBeginFlashloanAccounts(
    params.marginfiAccount.address,
    params.marginfiAccount.authority
  );
  const beginFlashloanDataSize = getBeginFlashloanDataSize(
    new BN(beginFlashloanAccounts.length + 4) // endIndex calculation
  );
  const beginFlashloan = calculateSingleInstructionSize(
    beginFlashloanAccounts,
    beginFlashloanDataSize
  );
  // Begin flashloan: marginfiAccount is writable (index 0)
  addAccounts(allAccounts, writableAccounts, beginFlashloanAccounts, [0]);

  const actionTotalIxSize: InstructionSize[] = [];
  for (const action of params.actions) {
    switch (action.actionType) {
      case "withdraw":
        const withdrawSize = calculateWithdrawSize({
          marginfiAccount: params.marginfiAccount,
          group: params.group,
          programId: params.programId,
          activeBalances: params.activeBalances,
          allBanks: params.allBanks,
          luts: params.luts,
          withdrawAll: action.fullAmount,
          withdrawBank: action.bank,
          withdrawTokenProgram: action.tokenProgram,
          kaminoReserve: action.kaminoReserve,
        });

        addAccounts(
          allAccounts,
          writableAccounts,
          withdrawSize.fullWithdrawAccounts,
          withdrawSize.withdrawWritableIndices
        );
        actionTotalIxSize.push(withdrawSize.withdrawIxSize);
        break;
      case "repay":
        const repaySize = calculateRepaySize({
          marginfiAccount: params.marginfiAccount,
          group: params.group,
          programId: params.programId,
          activeBalances: params.activeBalances,
          allBanks: params.allBanks,
          luts: params.luts,
          repayAll: action.fullAmount,
          repayBank: action.bank,
          repayTokenProgram: action.tokenProgram,
        });

        addAccounts(
          allAccounts,
          writableAccounts,
          repaySize.fullRepayAccounts,
          repaySize.repayWritableIndices
        );
        actionTotalIxSize.push(repaySize.repayIxSize);
        break;
      case "deposit":
        const depositSize = calculateDepositSize({
          marginfiAccount: params.marginfiAccount,
          group: params.group,
          programId: params.programId,
          activeBalances: params.activeBalances,
          allBanks: params.allBanks,
          luts: params.luts,
          depositBank: action.bank,
          depositTokenProgram: action.tokenProgram,
          kaminoReserve: action.kaminoReserve,
        });

        addAccounts(
          allAccounts,
          writableAccounts,
          depositSize.fullDepositAccounts,
          depositSize.depositWritableIndices
        );
        actionTotalIxSize.push(depositSize.depositIxSize);
        break;
      case "borrow":
        const borrowSize = calculateBorrowSize({
          marginfiAccount: params.marginfiAccount,
          group: params.group,
          programId: params.programId,
          activeBalances: params.activeBalances,
          allBanks: params.allBanks,
          luts: params.luts,
          borrowBank: action.bank,
          borrowTokenProgram: action.tokenProgram,
        });

        addAccounts(
          allAccounts,
          writableAccounts,
          borrowSize.fullBorrowAccounts,
          borrowSize.borrowWritableIndices
        );
        actionTotalIxSize.push(borrowSize.borrowIxSize);
        break;
    }
  }

  // 4. End flashloan - use projected active banks after withdraw and repay
  const projectedBalances = computeProjectedActiveBanks(
    params.activeBalances,
    params.actions
  );

  const endFlashloanHealthBanks = projectedBalances
    .filter((b) => b.active)
    .map((b) => {
      const bank = params.allBanks.get(b.bankPk.toBase58());
      if (!bank) throw Error(`Bank ${b.bankPk.toBase58()} not found`);
      return bank;
    });

  const endFlashloanAccounts = getEndFlashloanAccounts(
    params.marginfiAccount.address,
    params.marginfiAccount.authority,
    endFlashloanHealthBanks
  );
  const endFlashloanDataSize = getEndFlashloanDataSize();
  const endFlashloan = calculateSingleInstructionSize(
    endFlashloanAccounts,
    endFlashloanDataSize
  );
  // End flashloan: marginfiAccount(0) is writable, rest are readonly
  addAccounts(allAccounts, writableAccounts, endFlashloanAccounts, [0]);

  // 5. Compute budget (SetComputeUnitLimit)
  let computeBudget: InstructionSize | undefined;
  const computeBudgetProgramId = new PublicKey(
    "ComputeBudget111111111111111111111111111111"
  );
  if (params.includeInstructions.includeComputeBudget) {
    allAccounts.add(computeBudgetProgramId.toBase58());
    // SetComputeUnitLimit: 1 byte discriminator + 4 bytes u32
    computeBudget = calculateSingleInstructionSize(
      [], // no accounts
      1 + 4 // discriminator + u32
    );
  }

  // 6. Priority fee (optional)
  let priorityFee: InstructionSize | undefined;
  if (params.includeInstructions.includePriorityFee) {
    if (!params.includeInstructions.includeComputeBudget) {
      allAccounts.add(computeBudgetProgramId.toBase58());
    }
    priorityFee = calculateSingleInstructionSize(
      [], // no accounts
      getPriorityFeeDataSize()
    );
  }

  // Build LUT account maps (split by writable/readonly)
  // Only exclude program IDs that are used as instruction program IDs (Marginfi, ComputeBudget)
  const accountsForLutMapping = new Set(allAccounts);
  accountsForLutMapping.delete(programId.toBase58());
  accountsForLutMapping.delete(computeBudgetProgramId.toBase58());

  // NOTE: Kamino and Farms program IDs stay in LUTs since they're not instruction program IDs

  const lutAccountMaps = buildLutAccountMaps(
    accountsForLutMapping,
    writableAccounts,
    params.luts
  );

  // Calculate which accounts are in LUTs vs static
  let totalLutAccounts = 0;
  lutAccountMaps.writable.forEach((accounts: Set<string>) => {
    totalLutAccounts += accounts.size;
  });
  lutAccountMaps.readonly.forEach((accounts: Set<string>) => {
    totalLutAccounts += accounts.size;
  });

  const staticAccountCount = allAccounts.size - totalLutAccounts;
  const totalAccountCount = allAccounts.size; // ALL accounts count toward 64-key limit!

  // Calculate accounts section (only static accounts, 32 bytes each)
  const accountsSection =
    encodeCompactU16Length(staticAccountCount) + staticAccountCount * 32;

  // Calculate LUT section
  let lutSection = 0;
  if (params.luts.length > 0) {
    // Compact-u16 for number of LUTs
    lutSection += encodeCompactU16Length(params.luts.length);

    // For each LUT
    params.luts.forEach((lut, lutIndex) => {
      const writableAccountsFromLut = lutAccountMaps.writable.get(lutIndex)!;
      const readonlyAccountsFromLut = lutAccountMaps.readonly.get(lutIndex)!;
      const writableCount = writableAccountsFromLut.size;
      const readonlyCount = readonlyAccountsFromLut.size;

      lutSection += 32; // LUT address
      lutSection += encodeCompactU16Length(writableCount); // writable count
      lutSection += writableCount; // writable indexes (1 byte each)
      lutSection += encodeCompactU16Length(readonlyCount); // readonly count
      lutSection += readonlyCount; // readonly indexes (1 byte each)
    });
  } else {
    lutSection = 1; // 1 byte for empty array (compact-u16 of 0)
  }

  // Calculate instructions section
  let numInstructions = 2 + params.actions.length; // base: beginFlashloan, actions, endFlashloan
  if (params.includeInstructions.includeComputeBudget) numInstructions++;
  if (params.includeInstructions.includePriorityFee) numInstructions++;

  const instructionsSection =
    encodeCompactU16Length(numInstructions) +
    (computeBudget?.total || 0) +
    (priorityFee?.total || 0) +
    beginFlashloan.total +
    actionTotalIxSize.reduce((a, b) => a + b.total, 0) +
    endFlashloan.total;

  const totalSize =
    overhead + accountsSection + lutSection + instructionsSection;

  const MAX_ACCOUNT_KEYS = 64;
  const availableAccountKeys = MAX_ACCOUNT_KEYS - totalAccountCount;

  return {
    txSize: totalSize,
    staticAccountCount: totalAccountCount, // Return TOTAL accounts (static + LUT)
    availableAccountKeys,
    existingAccounts: allAccounts, // Pass to Jupiter for deduplication
  };
}

export { MAX_TX_SIZE };
