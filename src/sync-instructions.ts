import {
  AccountMeta,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

import { TOKEN_PROGRAM_ID } from "~/vendor/spl";

import { deriveBankLiquidityVault, deriveBankLiquidityVaultAuthority } from "./utils";

// Hardcoded addresses from Marginfi IDL
const KAMINO_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const FARMS_PROGRAM_ID = new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");

// ============================================================================
// Encoding Utilities
// ============================================================================

function encodeU64(value: BN): Buffer {
  const buf = Buffer.alloc(8);
  value.toArrayLike(Buffer, "le", 8).copy(buf);
  return buf;
}

function encodeU8(value: number): Buffer {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(value, 0);
  return buf;
}

function encodeBool(value: boolean): Buffer {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(value ? 1 : 0, 0);
  return buf;
}

function encodeOptionBool(value: boolean | null | undefined): Buffer {
  if (value === null || value === undefined) {
    return Buffer.from([0]);
  }
  return Buffer.concat([Buffer.from([1]), encodeBool(value)]);
}

function encodePublicKey(pubkey: PublicKey): Buffer {
  return Buffer.from(pubkey.toBytes());
}

// ============================================================================
// Discriminators
// ============================================================================

const DISCRIMINATORS = {
  MARGINFI_ACCOUNT_INITIALIZE: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154]),
  KAMINO_DEPOSIT: Buffer.from([237, 8, 188, 187, 115, 99, 49, 85]),
  LENDING_ACCOUNT_DEPOSIT: Buffer.from([171, 94, 235, 103, 82, 64, 212, 140]),
  LENDING_ACCOUNT_REPAY: Buffer.from([79, 209, 172, 177, 222, 51, 173, 151]),
  KAMINO_WITHDRAW: Buffer.from([199, 101, 41, 45, 213, 98, 224, 200]),
  LENDING_ACCOUNT_WITHDRAW: Buffer.from([36, 72, 74, 19, 210, 210, 192, 192]),
  LENDING_ACCOUNT_BORROW: Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]),
  LENDING_ACCOUNT_LIQUIDATE: Buffer.from([214, 169, 151, 213, 251, 167, 86, 219]),
  LENDING_ACCOUNT_WITHDRAW_EMISSIONS: Buffer.from([234, 22, 84, 214, 118, 176, 140, 170]),
  LENDING_POOL_ADD_BANK: Buffer.from([215, 68, 72, 78, 208, 218, 103, 182]),
  LENDING_POOL_CONFIGURE_BANK: Buffer.from([121, 173, 156, 40, 93, 148, 56, 237]),
  LENDING_ACCOUNT_START_FLASHLOAN: Buffer.from([14, 131, 33, 220, 81, 186, 180, 107]),
  LENDING_ACCOUNT_END_FLASHLOAN: Buffer.from([105, 124, 201, 106, 153, 2, 8, 156]),
  TRANSFER_TO_NEW_ACCOUNT: Buffer.from([28, 79, 129, 231, 169, 69, 69, 65]),
  MARGINFI_GROUP_INITIALIZE: Buffer.from([255, 67, 67, 26, 94, 31, 34, 20]),
  MARGINFI_ACCOUNT_CLOSE: Buffer.from([186, 221, 93, 34, 50, 97, 194, 241]),
  LENDING_POOL_ADD_BANK_PERMISSIONLESS: Buffer.from([127, 187, 121, 34, 187, 167, 238, 102]),
  LENDING_POOL_CONFIGURE_BANK_ORACLE: Buffer.from([209, 82, 255, 171, 124, 21, 71, 81]),
  LENDING_ACCOUNT_PULSE_HEALTH: Buffer.from([186, 52, 117, 97, 34, 74, 39, 253]),
  LENDING_ACCOUNT_SORT_BALANCES: Buffer.from([187, 194, 110, 84, 82, 170, 204, 9]),
  DRIFT_DEPOSIT: Buffer.from([252, 63, 250, 201, 98, 55, 130, 12]),
  DRIFT_WITHDRAW: Buffer.from([86, 59, 186, 123, 183, 181, 234, 137]),
};

// ============================================================================
// Sync Instruction Builders
// ============================================================================

function makeInitMarginfiAccountIx(
  programId: PublicKey,
  accounts: {
    marginfiGroup: PublicKey;
    marginfiAccount: PublicKey;
    authority: PublicKey;
    feePayer: PublicKey;
    systemProgram?: PublicKey;
  }
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.marginfiGroup, isSigner: false, isWritable: false },
    { pubkey: accounts.marginfiAccount, isSigner: true, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.feePayer, isSigner: true, isWritable: true },
    {
      pubkey: accounts.systemProgram || SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
  ];

  return new TransactionInstruction({
    keys,
    programId,
    data: DISCRIMINATORS.MARGINFI_ACCOUNT_INITIALIZE,
  });
}

function makeDepositIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey; // relations: ["marginfiAccount", "bank"] - caller must provide
    marginfiAccount: PublicKey;
    authority: PublicKey; // signer: true, relations: ["marginfiAccount"] - caller must provide
    signerTokenAccount: PublicKey;
    bank: PublicKey;
    liquidityVault?: PublicKey; // relations: ["bank"] - caller must provide
    tokenProgram: PublicKey;
  },
  args: {
    amount: BN;
    depositUpToLimit?: boolean;
  },
  remainingAccounts: AccountMeta[] = []
): TransactionInstruction {
  const [liquidityVault] = deriveBankLiquidityVault(programId, accounts.bank);
  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: false },
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.bank, isSigner: false, isWritable: true },
    { pubkey: accounts.signerTokenAccount, isSigner: false, isWritable: true },
    {
      pubkey: accounts.liquidityVault ?? liquidityVault,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
  ];

  keys.push(...remainingAccounts);

  const data = Buffer.concat([
    DISCRIMINATORS.LENDING_ACCOUNT_DEPOSIT,
    encodeU64(args.amount),
    encodeOptionBool(args.depositUpToLimit ?? null),
  ]);

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

function makeRepayIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey; // relations - caller must provide
    marginfiAccount: PublicKey;
    authority: PublicKey; // signer, relations - caller must provide
    signerTokenAccount: PublicKey;
    bank: PublicKey;
    tokenProgram: PublicKey;
  },
  args: {
    amount: BN;
    repayAll?: boolean;
  },
  remainingAccounts: AccountMeta[] = []
): TransactionInstruction {
  const [liquidityVault] = deriveBankLiquidityVault(programId, accounts.bank);

  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: false },
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.bank, isSigner: false, isWritable: true },
    { pubkey: accounts.signerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: liquidityVault, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
  ];

  keys.push(...remainingAccounts);

  const data = Buffer.concat([
    DISCRIMINATORS.LENDING_ACCOUNT_REPAY,
    encodeU64(args.amount),
    encodeOptionBool(args.repayAll ?? null),
  ]);

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

function makeWithdrawIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey; // relations - caller must provide
    marginfiAccount: PublicKey;
    authority: PublicKey; // signer, relations - caller must provide
    bank: PublicKey;
    destinationTokenAccount: PublicKey;
    tokenProgram: PublicKey;
  },
  args: {
    amount: BN;
    withdrawAll?: boolean;
  },
  remainingAccounts: AccountMeta[] = []
): TransactionInstruction {
  // Derive PDAs
  const [bankLiquidityVaultAuthority] = deriveBankLiquidityVaultAuthority(programId, accounts.bank);
  const [liquidityVault] = deriveBankLiquidityVault(programId, accounts.bank);

  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: true },
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.bank, isSigner: false, isWritable: true },
    {
      pubkey: accounts.destinationTokenAccount,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: bankLiquidityVaultAuthority, isSigner: false, isWritable: false },
    { pubkey: liquidityVault, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
  ];

  keys.push(...remainingAccounts);

  const data = Buffer.concat([
    DISCRIMINATORS.LENDING_ACCOUNT_WITHDRAW,
    encodeU64(args.amount),
    encodeOptionBool(args.withdrawAll ?? null),
  ]);

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

function makeBorrowIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey; // relations - caller must provide
    marginfiAccount: PublicKey;
    authority: PublicKey; // signer, relations - caller must provide
    bank: PublicKey;
    destinationTokenAccount: PublicKey;
    tokenProgram: PublicKey;
  },
  args: {
    amount: BN;
  },
  remainingAccounts: AccountMeta[] = []
): TransactionInstruction {
  // Derive PDAs
  const [bankLiquidityVaultAuthority] = deriveBankLiquidityVaultAuthority(programId, accounts.bank);
  const [liquidityVault] = deriveBankLiquidityVault(programId, accounts.bank);

  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: false },
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.bank, isSigner: false, isWritable: true },
    {
      pubkey: accounts.destinationTokenAccount,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: bankLiquidityVaultAuthority, isSigner: false, isWritable: false },
    { pubkey: liquidityVault, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
  ];

  keys.push(...remainingAccounts);

  const data = Buffer.concat([DISCRIMINATORS.LENDING_ACCOUNT_BORROW, encodeU64(args.amount)]);

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

function makeBeginFlashLoanIx(
  programId: PublicKey,
  accounts: {
    marginfiAccount: PublicKey;
    authority: PublicKey; // signer, relations: ["marginfiAccount"] - caller must provide
  },
  args: {
    endIndex: BN;
  }
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    {
      pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, // hardcoded address from IDL
      isSigner: false,
      isWritable: false,
    },
  ];

  const data = Buffer.concat([
    DISCRIMINATORS.LENDING_ACCOUNT_START_FLASHLOAN,
    encodeU64(args.endIndex),
  ]);

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

function makeEndFlashLoanIx(
  programId: PublicKey,
  accounts: {
    marginfiAccount: PublicKey;
    authority: PublicKey; // signer, relations: ["marginfiAccount"] - caller must provide
  },
  remainingAccounts: AccountMeta[] = []
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
  ];

  keys.push(...remainingAccounts);

  return new TransactionInstruction({
    keys,
    programId,
    data: DISCRIMINATORS.LENDING_ACCOUNT_END_FLASHLOAN,
  });
}

function makeKaminoDepositIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey; // relations - caller must provide
    marginfiAccount: PublicKey;
    authority: PublicKey; // signer - caller must provide
    bank: PublicKey;
    signerTokenAccount: PublicKey;
    integrationAcc2: PublicKey; // Kamino Obligation
    lendingMarket: PublicKey;
    lendingMarketAuthority: PublicKey;
    integrationAcc1: PublicKey; // The Kamino reserve that holds liquidity
    mint: PublicKey; // relations: ["bank"] - Bank's liquidity token mint (Kamino calls this reserve_liquidity_mint)
    reserveLiquiditySupply: PublicKey;
    reserveCollateralMint: PublicKey;
    reserveDestinationDepositCollateral: PublicKey;
    obligationFarmUserState: PublicKey | null; // optional in IDL
    reserveFarmState: PublicKey | null; // optional in IDL
    liquidityTokenProgram: PublicKey;
  },
  args: {
    amount: BN;
  },
  remainingAccounts: AccountMeta[] = []
): TransactionInstruction {
  const liquidityVaultAuthority = deriveBankLiquidityVaultAuthority(programId, accounts.bank)[0];
  const liquidityVault = deriveBankLiquidityVault(programId, accounts.bank)[0];

  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: false },
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.bank, isSigner: false, isWritable: true },
    { pubkey: accounts.signerTokenAccount, isSigner: false, isWritable: true },
    {
      pubkey: liquidityVaultAuthority,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: liquidityVault, isSigner: false, isWritable: true },
    { pubkey: accounts.integrationAcc2, isSigner: false, isWritable: true },
    { pubkey: accounts.lendingMarket, isSigner: false, isWritable: false },
    {
      pubkey: accounts.lendingMarketAuthority,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: accounts.integrationAcc1, isSigner: false, isWritable: true },
    { pubkey: accounts.mint, isSigner: false, isWritable: false },
    {
      pubkey: accounts.reserveLiquiditySupply,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: accounts.reserveCollateralMint,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: accounts.reserveDestinationDepositCollateral,
      isSigner: false,
      isWritable: true,
    },
  ];

  if (accounts.obligationFarmUserState) {
    keys.push({
      pubkey: accounts.obligationFarmUserState,
      isSigner: false,
      isWritable: true,
    });
  }
  if (accounts.reserveFarmState) {
    keys.push({
      pubkey: accounts.reserveFarmState,
      isSigner: false,
      isWritable: true,
    });
  }

  keys.push(
    { pubkey: KAMINO_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: FARMS_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: accounts.liquidityTokenProgram,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false }
  );

  keys.push(...remainingAccounts);

  const data = Buffer.concat([DISCRIMINATORS.KAMINO_DEPOSIT, encodeU64(args.amount)]);

  return new TransactionInstruction({ keys, programId, data });
}

function makeKaminoWithdrawIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey; // relations - caller must provide
    marginfiAccount: PublicKey;
    authority: PublicKey; // signer - caller must provide
    bank: PublicKey;
    destinationTokenAccount: PublicKey;
    integrationAcc2: PublicKey; // Kamino Obligation
    lendingMarket: PublicKey;
    lendingMarketAuthority: PublicKey;
    integrationAcc1: PublicKey; // The Kamino reserve that holds liquidity
    reserveLiquidityMint: PublicKey;
    reserveLiquiditySupply: PublicKey;
    reserveCollateralMint: PublicKey;
    reserveSourceCollateral: PublicKey;
    obligationFarmUserState: PublicKey | null; // optional in IDL
    reserveFarmState: PublicKey | null; // optional in IDL
    liquidityTokenProgram: PublicKey;
  },
  args: {
    amount: BN;
    isFinalWithdrawal: boolean;
  },
  remainingAccounts: AccountMeta[] = []
): TransactionInstruction {
  const liquidityVaultAuthority = deriveBankLiquidityVaultAuthority(programId, accounts.bank)[0];
  const liquidityVault = deriveBankLiquidityVault(programId, accounts.bank)[0];

  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: true },
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.bank, isSigner: false, isWritable: true },
    {
      pubkey: accounts.destinationTokenAccount,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: liquidityVaultAuthority, isSigner: false, isWritable: true },
    { pubkey: liquidityVault, isSigner: false, isWritable: true },
    { pubkey: accounts.integrationAcc2, isSigner: false, isWritable: true },
    { pubkey: accounts.lendingMarket, isSigner: false, isWritable: false },
    {
      pubkey: accounts.lendingMarketAuthority,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: accounts.integrationAcc1, isSigner: false, isWritable: true },
    {
      pubkey: accounts.reserveLiquidityMint,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: accounts.reserveLiquiditySupply,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: accounts.reserveCollateralMint,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: accounts.reserveSourceCollateral,
      isSigner: false,
      isWritable: true,
    },
  ];

  if (accounts.obligationFarmUserState) {
    keys.push({
      pubkey: accounts.obligationFarmUserState,
      isSigner: false,
      isWritable: true,
    });
  }
  if (accounts.reserveFarmState) {
    keys.push({
      pubkey: accounts.reserveFarmState,
      isSigner: false,
      isWritable: true,
    });
  }

  keys.push(
    { pubkey: KAMINO_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: FARMS_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: accounts.liquidityTokenProgram,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false }
  );

  keys.push(...remainingAccounts);

  const data = Buffer.concat([
    DISCRIMINATORS.KAMINO_WITHDRAW,
    encodeU64(args.amount),
    encodeOptionBool(args.isFinalWithdrawal),
  ]);

  return new TransactionInstruction({ keys, programId, data });
}

function makeLendingAccountLiquidateIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey; // relations - caller must provide
    assetBank: PublicKey;
    liabBank: PublicKey;
    liquidatorMarginfiAccount: PublicKey;
    authority: PublicKey; // signer, relations: ["liquidatorMarginfiAccount"] - caller must provide
    liquidateeMarginfiAccount: PublicKey;
    bankLiquidityVaultAuthority: PublicKey; // PDA - caller must derive
    bankLiquidityVault: PublicKey; // PDA - caller must derive
    bankInsuranceVault: PublicKey; // PDA - caller must derive
    tokenProgram: PublicKey;
  },
  args: {
    assetAmount: BN;
    liquidateeAccounts: number;
    liquidatorAccounts: number;
  },
  remainingAccounts: AccountMeta[] = []
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: false },
    { pubkey: accounts.assetBank, isSigner: false, isWritable: true },
    { pubkey: accounts.liabBank, isSigner: false, isWritable: true },
    {
      pubkey: accounts.liquidatorMarginfiAccount,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    {
      pubkey: accounts.liquidateeMarginfiAccount,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: accounts.bankLiquidityVaultAuthority,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: accounts.bankLiquidityVault, isSigner: false, isWritable: true },
    { pubkey: accounts.bankInsuranceVault, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
  ];

  keys.push(...remainingAccounts);

  const data = Buffer.concat([
    DISCRIMINATORS.LENDING_ACCOUNT_LIQUIDATE,
    encodeU64(args.assetAmount),
    Buffer.from([args.liquidateeAccounts]),
    Buffer.from([args.liquidatorAccounts]),
  ]);

  return new TransactionInstruction({ keys, programId, data });
}

function makelendingAccountWithdrawEmissionIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey; // relations - caller must provide
    marginfiAccount: PublicKey;
    authority: PublicKey; // signer, relations: ["marginfiAccount"] - caller must provide
    bank: PublicKey;
    emissionsMint: PublicKey; // relations: ["bank"] - caller must provide
    emissionsAuth: PublicKey; // PDA - caller must derive
    emissionsVault: PublicKey; // PDA - caller must derive
    destinationAccount: PublicKey;
    tokenProgram: PublicKey;
  }
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: false },
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.bank, isSigner: false, isWritable: true },
    { pubkey: accounts.emissionsMint, isSigner: false, isWritable: false },
    { pubkey: accounts.emissionsAuth, isSigner: false, isWritable: false },
    { pubkey: accounts.emissionsVault, isSigner: false, isWritable: true },
    { pubkey: accounts.destinationAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId,
    data: DISCRIMINATORS.LENDING_ACCOUNT_WITHDRAW_EMISSIONS,
  });
}

function makeCloseAccountIx(
  programId: PublicKey,
  accounts: {
    marginfiAccount: PublicKey;
    authority: PublicKey; // signer, relations: ["marginfiAccount"] - caller must provide
    feePayer: PublicKey;
  }
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.feePayer, isSigner: true, isWritable: true },
  ];

  return new TransactionInstruction({
    keys,
    programId,
    data: DISCRIMINATORS.MARGINFI_ACCOUNT_CLOSE,
  });
}

// Deprecated
// function makeLendingAccountSortBalancesIx(
//   programId: PublicKey,
//   accounts: {
//     marginfiAccount: PublicKey;
//   }
// ): TransactionInstruction {
//   const keys: AccountMeta[] = [
//     { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
//   ];

//   return new TransactionInstruction({
//     keys,
//     programId,
//     data: DISCRIMINATORS.LENDING_ACCOUNT_SORT_BALANCES,
//   });
// }

function makePulseHealthIx(
  programId: PublicKey,
  accounts: {
    marginfiAccount: PublicKey;
  },
  remainingAccounts: AccountMeta[] = []
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
  ];

  keys.push(...remainingAccounts);

  return new TransactionInstruction({
    keys,
    programId,
    data: DISCRIMINATORS.LENDING_ACCOUNT_PULSE_HEALTH,
  });
}

function makeAccountTransferToNewAccountIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey; // relations: ["oldMarginfiAccount"] - caller must provide
    oldMarginfiAccount: PublicKey;
    newMarginfiAccount: PublicKey;
    authority: PublicKey; // signer, relations: ["oldMarginfiAccount"] - caller must provide
    feePayer: PublicKey;
    newAuthority: PublicKey;
    globalFeeWallet: PublicKey; // caller must provide
  }
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: false },
    { pubkey: accounts.oldMarginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.newMarginfiAccount, isSigner: true, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.feePayer, isSigner: true, isWritable: true },
    { pubkey: accounts.newAuthority, isSigner: false, isWritable: false },
    { pubkey: accounts.globalFeeWallet, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId,
    data: DISCRIMINATORS.TRANSFER_TO_NEW_ACCOUNT,
  });
}

function makeGroupInitIx(
  programId: PublicKey,
  accounts: {
    marginfiGroup: PublicKey;
    admin: PublicKey;
    feeState: PublicKey; // PDA with seeds: ["feestate"] - caller must derive
  },
  args?: {
    isArenaGroup?: boolean;
  }
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.marginfiGroup, isSigner: true, isWritable: true },
    { pubkey: accounts.admin, isSigner: true, isWritable: true },
    { pubkey: accounts.feeState, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = Buffer.concat([
    DISCRIMINATORS.MARGINFI_GROUP_INITIALIZE,
    encodeBool(args?.isArenaGroup ?? false),
  ]);

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

function makePoolConfigureBankIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey; // relations: ["bank"] - caller must provide
    admin: PublicKey; // signer, relations: ["group"] - caller must provide
    bank: PublicKey;
  },
  args: {
    bankConfigOpt: any; // Complex type - caller must handle serialization
  }
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: false },
    { pubkey: accounts.admin, isSigner: true, isWritable: false },
    { pubkey: accounts.bank, isSigner: false, isWritable: true },
  ];

  // Note: Complex bankConfigOpt encoding not implemented
  // Caller should construct full data buffer themselves
  return new TransactionInstruction({
    keys,
    programId,
    data: DISCRIMINATORS.LENDING_POOL_CONFIGURE_BANK,
  });
}

function makeLendingPoolConfigureBankOracleIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey; // relations: ["bank"] - caller must provide
    admin: PublicKey; // signer, relations: ["group"] - caller must provide
    bank: PublicKey;
  },
  args: {
    setup: number;
    feedId: PublicKey;
  },
  remainingAccounts: AccountMeta[] = []
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: false },
    { pubkey: accounts.admin, isSigner: true, isWritable: false },
    { pubkey: accounts.bank, isSigner: false, isWritable: true },
  ];

  keys.push(...remainingAccounts);

  const data = Buffer.concat([
    DISCRIMINATORS.LENDING_POOL_CONFIGURE_BANK_ORACLE,
    encodeU8(args.setup),
    encodePublicKey(args.feedId),
  ]);

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

function makePoolAddBankIx(
  programId: PublicKey,
  accounts: {
    marginfiGroup: PublicKey;
    admin: PublicKey; // signer, relations: ["marginfiGroup"] - caller must provide
    feePayer: PublicKey;
    feeState: PublicKey; // PDA - caller must derive
    globalFeeWallet: PublicKey; // relations: ["feeState"] - caller must provide
    bankMint: PublicKey;
    bank: PublicKey;
    liquidityVaultAuthority: PublicKey; // PDA - caller must derive
    liquidityVault: PublicKey; // PDA - caller must derive
    insuranceVaultAuthority: PublicKey; // PDA - caller must derive
    insuranceVault: PublicKey; // PDA - caller must derive
    feeVaultAuthority: PublicKey; // PDA - caller must derive
    feeVault: PublicKey; // PDA - caller must derive
    tokenProgram: PublicKey;
  },
  args: {
    bankConfig: any; // Complex BankConfigCompactRaw type
  }
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.marginfiGroup, isSigner: false, isWritable: true },
    { pubkey: accounts.admin, isSigner: true, isWritable: false },
    { pubkey: accounts.feePayer, isSigner: true, isWritable: true },
    { pubkey: accounts.feeState, isSigner: false, isWritable: false },
    { pubkey: accounts.globalFeeWallet, isSigner: false, isWritable: true },
    { pubkey: accounts.bankMint, isSigner: false, isWritable: false },
    { pubkey: accounts.bank, isSigner: true, isWritable: true },
    {
      pubkey: accounts.liquidityVaultAuthority,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: accounts.liquidityVault, isSigner: false, isWritable: true },
    {
      pubkey: accounts.insuranceVaultAuthority,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: accounts.insuranceVault, isSigner: false, isWritable: true },
    { pubkey: accounts.feeVaultAuthority, isSigner: false, isWritable: false },
    { pubkey: accounts.feeVault, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Note: Complex bankConfig encoding not implemented
  // Caller should construct full data buffer themselves
  return new TransactionInstruction({
    keys,
    programId,
    data: DISCRIMINATORS.LENDING_POOL_ADD_BANK,
  });
}

function makeDriftDepositIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey; // relations - caller must provide
    marginfiAccount: PublicKey;
    authority: PublicKey; // signer - caller must provide
    bank: PublicKey;
    driftOracle: PublicKey | null; // optional in IDL
    liquidityVault: PublicKey; // relations: ["bank"] - caller must provide
    signerTokenAccount: PublicKey;
    driftState: PublicKey; // caller must provide
    integrationAcc2: PublicKey; // The Drift user account owned by liquidity_vault_authority
    integrationAcc3: PublicKey; // The Drift user stats account owned by liquidity_vault_authority
    integrationAcc1: PublicKey; // The Drift spot market for this asset
    driftSpotMarketVault: PublicKey;
    mint: PublicKey; // relations: ["bank"] - caller must provide
    driftProgram: PublicKey; // fixed address - caller must provide
    tokenProgram: PublicKey;
    systemProgram: PublicKey; // fixed address - caller must provide
  },
  args: {
    amount: BN;
  }
): TransactionInstruction {
  // Derive PDA for liquidity vault authority
  const liquidityVaultAuthority = deriveBankLiquidityVaultAuthority(programId, accounts.bank)[0];

  // Build keys in exact IDL order
  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: false },
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.bank, isSigner: false, isWritable: true },
  ];

  // drift_oracle is optional
  if (accounts.driftOracle) {
    keys.push({
      pubkey: accounts.driftOracle,
      isSigner: false,
      isWritable: false,
    });
  }

  keys.push(
    { pubkey: liquidityVaultAuthority, isSigner: false, isWritable: false },
    { pubkey: accounts.liquidityVault, isSigner: false, isWritable: true },
    { pubkey: accounts.signerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.driftState, isSigner: false, isWritable: false },
    { pubkey: accounts.integrationAcc2, isSigner: false, isWritable: true },
    { pubkey: accounts.integrationAcc3, isSigner: false, isWritable: true },
    { pubkey: accounts.integrationAcc1, isSigner: false, isWritable: true },
    {
      pubkey: accounts.driftSpotMarketVault,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: accounts.mint, isSigner: false, isWritable: false },
    { pubkey: accounts.driftProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.systemProgram, isSigner: false, isWritable: false }
  );

  const data = Buffer.concat([DISCRIMINATORS.DRIFT_DEPOSIT, encodeU64(args.amount)]);

  return new TransactionInstruction({ keys, programId, data });
}

function makeDriftWithdrawIx(
  programId: PublicKey,
  accounts: {
    group: PublicKey;
    marginfiAccount: PublicKey;
    authority: PublicKey;
    bank: PublicKey;
    liquidityVault: PublicKey;
    destinationTokenAccount: PublicKey;
    driftState: PublicKey;
    integrationAcc2: PublicKey; // The Drift user account owned by liquidity_vault_authority
    integrationAcc3: PublicKey; // The Drift user stats account owned by liquidity_vault_authority"
    integrationAcc1: PublicKey; // The Drift spot market for this asset
    driftSpotMarketVault: PublicKey;
    driftSigner: PublicKey;
    mint: PublicKey;
    tokenProgram: PublicKey;
    driftOracle?: PublicKey | null;
    driftRewardOracle?: PublicKey | null;
    driftRewardSpotMarket?: PublicKey | null;
    driftRewardMint?: PublicKey | null;
    driftRewardOracle2?: PublicKey | null;
    driftRewardSpotMarket2?: PublicKey | null;
    driftRewardMint2?: PublicKey | null;
  },
  args: {
    amount: BN;
    withdrawAll: boolean;
  },
  remainingAccounts: AccountMeta[] = []
): TransactionInstruction {
  // Derive PDA for liquidity vault authority
  const liquidityVaultAuthority = deriveBankLiquidityVaultAuthority(programId, accounts.bank)[0];

  // Drift program address
  const DRIFT_PROGRAM_ID = new PublicKey("dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH");
  const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

  // Build keys in exact IDL order
  const keys: AccountMeta[] = [
    { pubkey: accounts.group, isSigner: false, isWritable: true },
    { pubkey: accounts.marginfiAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: accounts.bank, isSigner: false, isWritable: true },
  ];

  // Add optional driftOracle
  if (accounts.driftOracle) {
    keys.push({
      pubkey: accounts.driftOracle,
      isSigner: false,
      isWritable: false,
    });
  }

  // Add required accounts in IDL order
  keys.push(
    { pubkey: liquidityVaultAuthority, isSigner: false, isWritable: false },
    { pubkey: accounts.liquidityVault, isSigner: false, isWritable: true },
    {
      pubkey: accounts.destinationTokenAccount,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: accounts.driftState, isSigner: false, isWritable: false },
    { pubkey: accounts.integrationAcc2, isSigner: false, isWritable: true },
    { pubkey: accounts.integrationAcc3, isSigner: false, isWritable: true },
    { pubkey: accounts.integrationAcc1, isSigner: false, isWritable: true },
    { pubkey: accounts.driftSpotMarketVault, isSigner: false, isWritable: true }
  );

  // Add optional reward accounts (in IDL order)
  if (accounts.driftRewardOracle) {
    keys.push({
      pubkey: accounts.driftRewardOracle,
      isSigner: false,
      isWritable: false,
    });
  }

  if (accounts.driftRewardSpotMarket) {
    keys.push({
      pubkey: accounts.driftRewardSpotMarket,
      isSigner: false,
      isWritable: false,
    });
  }

  if (accounts.driftRewardMint) {
    keys.push({
      pubkey: accounts.driftRewardMint,
      isSigner: false,
      isWritable: false,
    });
  }

  if (accounts.driftRewardOracle2) {
    keys.push({
      pubkey: accounts.driftRewardOracle2,
      isSigner: false,
      isWritable: false,
    });
  }

  if (accounts.driftRewardSpotMarket2) {
    keys.push({
      pubkey: accounts.driftRewardSpotMarket2,
      isSigner: false,
      isWritable: false,
    });
  }

  if (accounts.driftRewardMint2) {
    keys.push({
      pubkey: accounts.driftRewardMint2,
      isSigner: false,
      isWritable: false,
    });
  }

  // Add final required accounts
  keys.push(
    { pubkey: accounts.driftSigner, isSigner: false, isWritable: false },
    { pubkey: accounts.mint, isSigner: false, isWritable: false },
    { pubkey: DRIFT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }
  );

  // Add remaining accounts for health checks
  keys.push(...remainingAccounts);

  const data = Buffer.concat([
    DISCRIMINATORS.DRIFT_WITHDRAW,
    encodeU64(args.amount),
    encodeBool(args.withdrawAll),
  ]);

  return new TransactionInstruction({ keys, programId, data });
}

function makePoolAddPermissionlessStakedBankIx(
  programId: PublicKey,
  accounts: {
    marginfiGroup: PublicKey; // relations: ["stakedSettings"] - caller must provide
    stakedSettings: PublicKey;
    feePayer: PublicKey;
    bankMint: PublicKey;
    solPool: PublicKey;
    stakePool: PublicKey;
    bank: PublicKey; // PDA - caller must derive using seeds: [marginfiGroup, bankMint, bankSeed]
    liquidityVaultAuthority: PublicKey; // PDA - caller must derive
    liquidityVault: PublicKey; // PDA - caller must derive
    insuranceVaultAuthority: PublicKey; // PDA - caller must derive
    insuranceVault: PublicKey; // PDA - caller must derive
    feeVaultAuthority: PublicKey; // PDA - caller must derive
    feeVault: PublicKey; // PDA - caller must derive
    tokenProgram?: PublicKey;
  },
  remainingAccounts: AccountMeta[] = [],
  args: {
    seed?: BN;
  }
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: accounts.marginfiGroup, isSigner: false, isWritable: true },
    { pubkey: accounts.stakedSettings, isSigner: false, isWritable: false },
    { pubkey: accounts.feePayer, isSigner: true, isWritable: true },
    { pubkey: accounts.bankMint, isSigner: false, isWritable: false },
    { pubkey: accounts.solPool, isSigner: false, isWritable: false },
    { pubkey: accounts.stakePool, isSigner: false, isWritable: false },
    { pubkey: accounts.bank, isSigner: false, isWritable: true },
    {
      pubkey: accounts.liquidityVaultAuthority,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: accounts.liquidityVault, isSigner: false, isWritable: true },
    {
      pubkey: accounts.insuranceVaultAuthority,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: accounts.insuranceVault, isSigner: false, isWritable: true },
    { pubkey: accounts.feeVaultAuthority, isSigner: false, isWritable: false },
    { pubkey: accounts.feeVault, isSigner: false, isWritable: true },
    {
      pubkey: accounts.tokenProgram || TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  keys.push(...remainingAccounts);

  const data = Buffer.concat([
    DISCRIMINATORS.LENDING_POOL_ADD_BANK_PERMISSIONLESS,
    encodeU64(args.seed || new BN(0)),
  ]);

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

const syncInstructions = {
  makeInitMarginfiAccountIx,
  makeDepositIx,
  makeDriftDepositIx,
  makeKaminoDepositIx,
  makeRepayIx,
  makeWithdrawIx,
  makeDriftWithdrawIx,
  makeKaminoWithdrawIx,
  makeBorrowIx,
  makeLendingAccountLiquidateIx,
  makelendingAccountWithdrawEmissionIx,
  makePoolAddBankIx,
  makePoolConfigureBankIx,
  makeBeginFlashLoanIx,
  makeEndFlashLoanIx,
  makeAccountTransferToNewAccountIx,
  makeGroupInitIx,
  makeCloseAccountIx,
  makePoolAddPermissionlessStakedBankIx,
  makeLendingPoolConfigureBankOracleIx,
  makePulseHealthIx,
};

export default syncInstructions;
