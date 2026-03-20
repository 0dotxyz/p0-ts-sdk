/**
 * R&D: Measure flashloan non-swap TX sizes
 *
 * This script builds flashloan TXs with all non-swap IXs (no actual swap instructions)
 * to measure how much byte budget remains for swap IXs.
 *
 * Goal: Validate that sizeConstraint = MAX_TX_SIZE - nonSwapBytes is deterministic
 * and can be computed synchronously from known inputs.
 *
 * Run: tsx rnd-flashloan-size.ts
 */

// Import directly from specific modules to avoid pulling in titan.utils.ts
// (which requires the uninstalled @titanexchange/sdk-ts package)
import { Project0Client } from "../src/models/client";
import { MarginfiAccount } from "../src/models/account";
import { Bank } from "../src/models/bank";
import { AssetTag } from "../src/services/bank";
import { makeBorrowIx } from "../src/services/account/actions/borrow";
import {
  makeDepositIx,
  makeKaminoDepositIx,
  makeDriftDepositIx,
  makeJuplendDepositIx,
} from "../src/services/account/actions/deposit";
import { makeRepayIx } from "../src/services/account/actions/repay";
import {
  makeWithdrawIx,
  makeKaminoWithdrawIx,
  makeDriftWithdrawIx,
  makeJuplendWithdrawIx,
} from "../src/services/account/actions/withdraw";
import { makeFlashLoanTx } from "../src/services/account/actions/flash-loan";
import { getTxSize, getAccountKeys } from "../src/services/transaction/helpers/tx-size";
import {
  computeHealthAccountMetas,
  computeProjectedActiveBanksNoCpi,
} from "../src/services/account/utils/compute";
import {
  computeV0TxSize,
  computeFlashLoanNonSwapBudget,
  computeFlashloanSwapConstraints,
  MAX_TX_SIZE,
} from "../src/services/account/utils/flashloan-size.utils";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "../src/vendor/spl";
import { getConnection, getMarginfiConfig, getAccountAddress, getWalletPubkey } from "./config";

// ============================================================================
// Types
// ============================================================================

interface MeasurementResult {
  action: string;
  variant: string;
  txSize: number;
  swapBudget: number;
  accountKeys: number;
  healthMetaCount: number;
  activeBalances: number;
  ixCount: number;
  tx: VersionedTransaction;
  nonSwapIxs: TransactionInstruction[]; // IXs passed to makeFlashLoanTx (before BeginFL/EndFL wrapping)
}

// ============================================================================
// Helpers
// ============================================================================

const KNOWN_PROGRAMS: Record<string, string> = {
  MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA: "MarginfiProgram",
  ComputeBudget111111111111111111111111111111: "ComputeBudget",
  "11111111111111111111111111111111": "SystemProgram",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "TokenProgram",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token22",
  Sysvar1nstructions1111111111111111111111111: "SysvarInstructions",
  SysvarRent111111111111111111111111111111111: "SysvarRent",
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD: "KaminoLending",
  FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr: "KaminoFarms",
  dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH: "DriftProgram",
  "5zpq7DvB6UdFFvpmBPspGPNfUGoBRRCE2HHg5u3gxcsN": "DriftState",
  jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9: "JupLending",
  So11111111111111111111111111111111111111112: "WrappedSOL",
};

function identifyKey(key: PublicKey, client: Project0Client, account: MarginfiAccount): string {
  const addr = key.toBase58();

  // Known programs
  if (KNOWN_PROGRAMS[addr]) return `← ${KNOWN_PROGRAMS[addr]}`;

  // Account-specific
  if (key.equals(account.authority)) return "← authority (SIGNER)";
  if (key.equals(account.address)) return "← marginfiAccount";
  if (key.equals(account.group)) return "← marginfiGroup";

  // Check if it's a bank address, mint, vault, or integration account
  for (const [, bank] of client.bankMap) {
    const sym = bank.tokenSymbol ?? bank.mint.toBase58().slice(0, 8);
    const tag = assetTagName(bank.config.assetTag);
    if (key.equals(bank.address)) return `← bank:${sym}`;
    if (key.equals(bank.mint)) return `← mint:${sym}`;
    if (key.equals(bank.liquidityVault)) return `← vault:${sym}`;
    if (bank.kaminoIntegrationAccounts) {
      if (key.equals(bank.kaminoIntegrationAccounts.kaminoReserve)) return `← kaminoReserve:${sym}`;
      if (key.equals(bank.kaminoIntegrationAccounts.kaminoObligation))
        return `← kaminoObligation:${sym}`;
    }
    if (bank.driftIntegrationAccounts) {
      if (key.equals(bank.driftIntegrationAccounts.driftSpotMarket))
        return `← driftSpotMarket:${sym}`;
      if (key.equals(bank.driftIntegrationAccounts.driftUser)) return `← driftUser:${sym}`;
      if (key.equals(bank.driftIntegrationAccounts.driftUserStats))
        return `← driftUserStats:${sym}`;
    }
    if (bank.jupLendIntegrationAccounts) {
      if (key.equals(bank.jupLendIntegrationAccounts.jupLendingState))
        return `← jupLendState:${sym}`;
      if (key.equals(bank.jupLendIntegrationAccounts.jupFTokenVault))
        return `← jupFTokenVault:${sym}`;
      if (key.equals(bank.jupLendIntegrationAccounts.jupFTokenAta)) return `← jupFTokenAta:${sym}`;
    }
    for (const okey of bank.config.oracleKeys) {
      if (!okey.equals(PublicKey.default) && key.equals(okey)) return `← oracle:${sym}`;
    }
  }

  // Check bankIntegrationMap for deeper state accounts (reserve data, drift rewards, etc.)
  for (const [bankAddr, integration] of Object.entries(client.bankIntegrationMap)) {
    const meta = integration as any;
    if (meta?.kaminoStates) {
      const ks = meta.kaminoStates;
      if (ks.reserveState?.address && key.equals(ks.reserveState.address))
        return `← kaminoReserveState (bank:${bankAddr.slice(0, 8)})`;
      if (ks.reserveState?.data) {
        const rd = ks.reserveState.data;
        if (rd.lendingMarket && key.equals(rd.lendingMarket)) return `← kaminoLendingMarket`;
        if (rd.farmCollateral && key.equals(rd.farmCollateral)) return `← kaminoFarmCollateral`;
        if (rd.liquidity?.mintPubkey && key.equals(rd.liquidity.mintPubkey))
          return `← kaminoLiquidityMint`;
      }
    }
    if (meta?.driftStates) {
      const ds = meta.driftStates;
      if (ds.spotMarketState?.address && key.equals(ds.spotMarketState.address))
        return `← driftSpotMarketState (bank:${bankAddr.slice(0, 8)})`;
      if (ds.userRewards) {
        for (const [rKey, rVal] of Object.entries(ds.userRewards)) {
          if (
            rVal &&
            typeof rVal === "object" &&
            "toBase58" in rVal &&
            key.equals(rVal as PublicKey)
          )
            return `← driftReward:${rKey}`;
        }
      }
    }
  }

  // Check if it's a user ATA for any bank mint
  const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  for (const [, bank] of client.bankMap) {
    const sym = bank.tokenSymbol ?? bank.mint.toBase58().slice(0, 8);
    // User ATA
    const [userAta] = PublicKey.findProgramAddressSync(
      [account.authority.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), bank.mint.toBuffer()],
      ATA_PROGRAM
    );
    if (key.equals(userAta)) return `← userATA:${sym} (per-user)`;

    // Vault authority ATA (for integrations)
    const vaultAuth = PublicKey.findProgramAddressSync(
      [Buffer.from("liquidity_vault_auth"), bank.address.toBuffer()],
      client.program.programId
    )[0];
    const [vaultAta] = PublicKey.findProgramAddressSync(
      [vaultAuth.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), bank.mint.toBuffer()],
      ATA_PROGRAM
    );
    if (key.equals(vaultAta)) return `← vaultAuthATA:${sym}`;
    if (key.equals(vaultAuth)) return `← vaultAuthority:${sym}`;
  }

  return "← ???";
}

function assetTagName(tag: AssetTag): string {
  switch (tag) {
    case AssetTag.DEFAULT:
      return "Standard";
    case AssetTag.SOL:
      return "SOL";
    case AssetTag.STAKED:
      return "Staked";
    case AssetTag.KAMINO:
      return "Kamino";
    case AssetTag.DRIFT:
      return "Drift";
    case AssetTag.SOLEND:
      return "Solend";
    case AssetTag.JUPLEND:
      return "Juplend";
    default:
      return `Unknown(${tag})`;
  }
}

/**
 * Find a bank by asset tag, preferring one that is NOT the same as excludeMint
 */
function findBankByTag(banks: Bank[], tag: AssetTag, excludeMint?: PublicKey): Bank | undefined {
  return banks.find(
    (b) => b.config.assetTag === tag && (!excludeMint || !b.mint.equals(excludeMint))
  );
}

/**
 * Build CU budget instructions (always 2, always same size)
 */
/**
 * Compute compact-u16 encoded size
 */
function compactU16Size(value: number): number {
  return value < 128 ? 1 : value < 16384 ? 2 : 3;
}

/**
 * Compute per-IX byte size in V0 message
 */
function compiledIxSize(ix: { accountKeyIndexes: number[]; data: Uint8Array }): number {
  return (
    1 + // programId index
    compactU16Size(ix.accountKeyIndexes.length) +
    ix.accountKeyIndexes.length + // account indices
    compactU16Size(ix.data.length) +
    ix.data.length // data
  );
}

/**
 * IX names by position in flashloan TX
 */
const FL_IX_NAMES = ["BeginFL", "CU_limit", "CU_price", "Primary", "Secondary", "EndFL"];

/**
 * Fixed account counts per IX type (without remaining accounts)
 */
const FIXED_ACCOUNTS: Record<string, number> = {
  BeginFL: 3,
  CU_limit: 0,
  CU_price: 0,
  Borrow: 8,
  StandardDeposit: 7,
  StandardWithdraw: 8,
  StandardRepay: 7,
  KaminoDeposit: 20, // 15 base + 0-2 farm + 5 trailing
  KaminoWithdraw: 20, // 15 base + 0-2 farm + 5 trailing
  DriftDeposit: 16, // 4 base + 0-1 oracle + 12 trailing
  DriftWithdraw: 17, // 4 base + 0-1 oracle + 0-6 rewards + 5 trailing
  JuplendDeposit: 19,
  JuplendWithdraw: 21,
  EndFL: 2,
};

function buildCuIxs(): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];
}

// ============================================================================
// Measurement functions
// ============================================================================

/**
 * Measure a loop flashloan TX: Begin FL + CU×2 + Borrow + Deposit(variant) + End FL
 */
async function measureLoop(
  client: Project0Client,
  account: MarginfiAccount,
  borrowBank: Bank,
  depositBank: Bank,
  blockhash: string
): Promise<MeasurementResult | null> {
  const variant = assetTagName(depositBank.config.assetTag);
  const tag = `Loop (deposit=${variant})`;

  try {
    const cuIxs = buildCuIxs();

    // Build borrow IX
    const borrowIxs = await makeBorrowIx({
      program: client.program,
      bank: borrowBank,
      bankMap: client.bankMap,
      tokenProgram: TOKEN_PROGRAM_ID,
      amount: 1.0, // dummy amount - data size is fixed regardless
      marginfiAccount: account,
      authority: account.authority,
      isSync: true,
      opts: {
        createAtas: false,
        wrapAndUnwrapSol: false,
      },
    });

    // Build deposit IX based on asset tag
    let depositIxs;
    switch (depositBank.config.assetTag) {
      case AssetTag.KAMINO: {
        const reserve =
          client.bankIntegrationMap[depositBank.address.toBase58()]?.kaminoStates?.reserveState;
        if (!reserve) {
          console.log(`   ⚠️  Skipping ${tag}: no Kamino reserve state`);
          return null;
        }
        depositIxs = await makeKaminoDepositIx({
          program: client.program,
          bank: depositBank,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          accountAddress: account.address,
          authority: account.authority,
          group: account.group,
          reserve,
          isSync: true,
          opts: { wrapAndUnwrapSol: false },
        });
        break;
      }
      case AssetTag.DRIFT: {
        const driftState = client.bankIntegrationMap[depositBank.address.toBase58()]?.driftStates;
        if (!driftState) {
          console.log(`   ⚠️  Skipping ${tag}: no Drift state`);
          return null;
        }
        depositIxs = await makeDriftDepositIx({
          program: client.program,
          bank: depositBank,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          accountAddress: account.address,
          authority: account.authority,
          group: account.group,
          driftMarketIndex: driftState.spotMarketState.marketIndex,
          driftOracle: driftState.spotMarketState.oracle,
          isSync: true,
          opts: { wrapAndUnwrapSol: false },
        });
        break;
      }
      case AssetTag.JUPLEND: {
        depositIxs = await makeJuplendDepositIx({
          program: client.program,
          bank: depositBank,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          accountAddress: account.address,
          authority: account.authority,
          group: account.group,
          isSync: false, // No sync builder for Juplend yet
          opts: { wrapAndUnwrapSol: false },
        });
        break;
      }
      default: {
        depositIxs = await makeDepositIx({
          program: client.program,
          bank: depositBank,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          accountAddress: account.address,
          authority: account.authority,
          group: account.group,
          isSync: true,
          opts: { wrapAndUnwrapSol: false },
        });
        break;
      }
    }

    // Build flashloan TX with all non-swap IXs (no swap IXs)
    const allIxs = [
      ...cuIxs,
      ...borrowIxs.instructions,
      // No swap instructions - this is what we're measuring
      ...depositIxs.instructions,
    ];

    const luts = client.addressLookupTables;

    const flashloanTx = await makeFlashLoanTx({
      program: client.program,
      marginfiAccount: account,
      bankMap: client.bankMap,
      addressLookupTableAccounts: luts,
      blockhash,
      ixs: allIxs,
      isSync: true,
    });

    const txSize = getTxSize(flashloanTx);
    const keyCount = getAccountKeys(flashloanTx, luts);

    // Count health metas for reference
    const projectedBankKeys = computeProjectedActiveBanksNoCpi(
      account.balances,
      allIxs,
      client.program
    );
    const projectedBanks = projectedBankKeys
      .map((pk) => client.bankMap.get(pk.toBase58()))
      .filter((b): b is Bank => !!b);
    const healthMetas = computeHealthAccountMetas(projectedBanks);

    return {
      action: "Loop",
      variant,
      txSize,
      swapBudget: MAX_TX_SIZE - txSize,
      accountKeys: keyCount,
      healthMetaCount: healthMetas.length,
      activeBalances: account.balances.filter((b) => b.active).length,
      ixCount: flashloanTx.message.compiledInstructions.length,
      tx: flashloanTx,
      nonSwapIxs: allIxs,
    };
  } catch (error: any) {
    console.log(`   ⚠️  Error measuring ${tag}: ${error.message}`);
    return null;
  }
}

/**
 * Measure a repay flashloan TX: Begin FL + CU×2 + Withdraw(variant) + Repay + End FL
 */
async function measureRepay(
  client: Project0Client,
  account: MarginfiAccount,
  withdrawBank: Bank,
  repayBank: Bank,
  blockhash: string
): Promise<MeasurementResult | null> {
  const variant = assetTagName(withdrawBank.config.assetTag);
  const tag = `Repay (withdraw=${variant})`;

  try {
    const cuIxs = buildCuIxs();

    // Build withdraw IX based on asset tag
    let withdrawIxs;
    switch (withdrawBank.config.assetTag) {
      case AssetTag.KAMINO: {
        const reserve =
          client.bankIntegrationMap[withdrawBank.address.toBase58()]?.kaminoStates?.reserveState;
        if (!reserve) {
          console.log(`   ⚠️  Skipping ${tag}: no Kamino reserve state`);
          return null;
        }
        withdrawIxs = await makeKaminoWithdrawIx({
          program: client.program,
          bank: withdrawBank,
          bankMap: client.bankMap,
          tokenProgram: TOKEN_PROGRAM_ID,
          cTokenAmount: 1.0,
          marginfiAccount: account,
          authority: account.authority,
          reserve,
          bankMetadataMap: client.bankIntegrationMap,
          withdrawAll: false,
          isSync: true,
          opts: { createAtas: false, wrapAndUnwrapSol: false },
        });
        break;
      }
      case AssetTag.DRIFT: {
        const driftState = client.bankIntegrationMap[withdrawBank.address.toBase58()]?.driftStates;
        if (!driftState) {
          console.log(`   ⚠️  Skipping ${tag}: no Drift state`);
          return null;
        }
        withdrawIxs = await makeDriftWithdrawIx({
          program: client.program,
          bank: withdrawBank,
          bankMap: client.bankMap,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          marginfiAccount: account,
          authority: account.authority,
          driftSpotMarket: driftState.spotMarketState,
          userRewards: driftState.userRewards,
          bankMetadataMap: client.bankIntegrationMap,
          withdrawAll: false,
          isSync: true,
          opts: { createAtas: false, wrapAndUnwrapSol: false },
        });
        break;
      }
      case AssetTag.JUPLEND: {
        const jupLendState =
          client.bankIntegrationMap[withdrawBank.address.toBase58()]?.jupLendStates;
        if (!jupLendState) {
          console.log(`   ⚠️  Skipping ${tag}: no JupLend state`);
          return null;
        }
        withdrawIxs = await makeJuplendWithdrawIx({
          program: client.program,
          bank: withdrawBank,
          bankMap: client.bankMap,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          marginfiAccount: account,
          authority: account.authority,
          jupLendingState: jupLendState.jupLendingState,
          bankMetadataMap: client.bankIntegrationMap,
          withdrawAll: false,
          isSync: false,
          opts: { createAtas: false, wrapAndUnwrapSol: false },
        });
        break;
      }
      default: {
        withdrawIxs = await makeWithdrawIx({
          program: client.program,
          bank: withdrawBank,
          bankMap: client.bankMap,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          marginfiAccount: account,
          authority: account.authority,
          withdrawAll: false,
          bankMetadataMap: client.bankIntegrationMap,
          isSync: true,
          opts: { createAtas: false, wrapAndUnwrapSol: false },
        });
        break;
      }
    }

    // Build repay IX (always standard)
    const repayIxs = await makeRepayIx({
      program: client.program,
      bank: repayBank,
      tokenProgram: TOKEN_PROGRAM_ID,
      amount: 1.0,
      accountAddress: account.address,
      authority: account.authority,
      isSync: true,
      opts: { wrapAndUnwrapSol: false },
    });

    const allIxs = [
      ...cuIxs,
      ...withdrawIxs.instructions,
      // No swap instructions
      ...repayIxs.instructions,
    ];

    const luts = client.addressLookupTables;

    const flashloanTx = await makeFlashLoanTx({
      program: client.program,
      marginfiAccount: account,
      bankMap: client.bankMap,
      addressLookupTableAccounts: luts,
      blockhash,
      ixs: allIxs,
      isSync: true,
    });

    const txSize = getTxSize(flashloanTx);
    const keyCount = getAccountKeys(flashloanTx, luts);

    const projectedBankKeys = computeProjectedActiveBanksNoCpi(
      account.balances,
      allIxs,
      client.program
    );
    const projectedBanks = projectedBankKeys
      .map((pk) => client.bankMap.get(pk.toBase58()))
      .filter((b): b is Bank => !!b);
    const healthMetas = computeHealthAccountMetas(projectedBanks);

    return {
      action: "Repay",
      variant,
      txSize,
      swapBudget: MAX_TX_SIZE - txSize,
      accountKeys: keyCount,
      healthMetaCount: healthMetas.length,
      activeBalances: account.balances.filter((b) => b.active).length,
      ixCount: flashloanTx.message.compiledInstructions.length,
      tx: flashloanTx,
      nonSwapIxs: allIxs,
    };
  } catch (error: any) {
    console.log(`   ⚠️  Error measuring ${tag}: ${error.message}`);
    return null;
  }
}

/**
 * Measure a swap-collateral flashloan TX: Begin FL + CU×2 + Withdraw(variant) + Deposit(variant) + End FL
 */
async function measureSwapCollateral(
  client: Project0Client,
  account: MarginfiAccount,
  withdrawBank: Bank,
  depositBank: Bank,
  blockhash: string
): Promise<MeasurementResult | null> {
  const wVariant = assetTagName(withdrawBank.config.assetTag);
  const dVariant = assetTagName(depositBank.config.assetTag);
  const tag = `SwapCollateral (w=${wVariant}, d=${dVariant})`;

  try {
    const cuIxs = buildCuIxs();

    // Build withdraw IX (reuse helper from measureRepay pattern)
    let withdrawIxs;
    switch (withdrawBank.config.assetTag) {
      case AssetTag.KAMINO: {
        const reserve =
          client.bankIntegrationMap[withdrawBank.address.toBase58()]?.kaminoStates?.reserveState;
        if (!reserve) return null;
        withdrawIxs = await makeKaminoWithdrawIx({
          program: client.program,
          bank: withdrawBank,
          bankMap: client.bankMap,
          tokenProgram: TOKEN_PROGRAM_ID,
          cTokenAmount: 1.0,
          marginfiAccount: account,
          authority: account.authority,
          reserve,
          bankMetadataMap: client.bankIntegrationMap,
          withdrawAll: false,
          isSync: true,
          opts: { createAtas: false, wrapAndUnwrapSol: false },
        });
        break;
      }
      case AssetTag.DRIFT: {
        const driftState = client.bankIntegrationMap[withdrawBank.address.toBase58()]?.driftStates;
        if (!driftState) return null;
        withdrawIxs = await makeDriftWithdrawIx({
          program: client.program,
          bank: withdrawBank,
          bankMap: client.bankMap,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          marginfiAccount: account,
          authority: account.authority,
          driftSpotMarket: driftState.spotMarketState,
          userRewards: driftState.userRewards,
          bankMetadataMap: client.bankIntegrationMap,
          withdrawAll: false,
          isSync: true,
          opts: { createAtas: false, wrapAndUnwrapSol: false },
        });
        break;
      }
      case AssetTag.JUPLEND: {
        const jupLendState =
          client.bankIntegrationMap[withdrawBank.address.toBase58()]?.jupLendStates;
        if (!jupLendState) return null;
        withdrawIxs = await makeJuplendWithdrawIx({
          program: client.program,
          bank: withdrawBank,
          bankMap: client.bankMap,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          marginfiAccount: account,
          authority: account.authority,
          jupLendingState: jupLendState.jupLendingState,
          bankMetadataMap: client.bankIntegrationMap,
          withdrawAll: false,
          isSync: false,
          opts: { createAtas: false, wrapAndUnwrapSol: false },
        });
        break;
      }
      default: {
        withdrawIxs = await makeWithdrawIx({
          program: client.program,
          bank: withdrawBank,
          bankMap: client.bankMap,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          marginfiAccount: account,
          authority: account.authority,
          withdrawAll: false,
          bankMetadataMap: client.bankIntegrationMap,
          isSync: true,
          opts: { createAtas: false, wrapAndUnwrapSol: false },
        });
        break;
      }
    }

    // Build deposit IX
    let depositIxs;
    switch (depositBank.config.assetTag) {
      case AssetTag.KAMINO: {
        const reserve =
          client.bankIntegrationMap[depositBank.address.toBase58()]?.kaminoStates?.reserveState;
        if (!reserve) return null;
        depositIxs = await makeKaminoDepositIx({
          program: client.program,
          bank: depositBank,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          accountAddress: account.address,
          authority: account.authority,
          group: account.group,
          reserve,
          isSync: true,
          opts: { wrapAndUnwrapSol: false },
        });
        break;
      }
      case AssetTag.DRIFT: {
        const driftState = client.bankIntegrationMap[depositBank.address.toBase58()]?.driftStates;
        if (!driftState) return null;
        depositIxs = await makeDriftDepositIx({
          program: client.program,
          bank: depositBank,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          accountAddress: account.address,
          authority: account.authority,
          group: account.group,
          driftMarketIndex: driftState.spotMarketState.marketIndex,
          driftOracle: driftState.spotMarketState.oracle,
          isSync: true,
          opts: { wrapAndUnwrapSol: false },
        });
        break;
      }
      case AssetTag.JUPLEND: {
        depositIxs = await makeJuplendDepositIx({
          program: client.program,
          bank: depositBank,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          accountAddress: account.address,
          authority: account.authority,
          group: account.group,
          isSync: false,
          opts: { wrapAndUnwrapSol: false },
        });
        break;
      }
      default: {
        depositIxs = await makeDepositIx({
          program: client.program,
          bank: depositBank,
          tokenProgram: TOKEN_PROGRAM_ID,
          amount: 1.0,
          accountAddress: account.address,
          authority: account.authority,
          group: account.group,
          isSync: true,
          opts: { wrapAndUnwrapSol: false },
        });
        break;
      }
    }

    const allIxs = [...cuIxs, ...withdrawIxs.instructions, ...depositIxs.instructions];

    const luts = client.addressLookupTables;

    const flashloanTx = await makeFlashLoanTx({
      program: client.program,
      marginfiAccount: account,
      bankMap: client.bankMap,
      addressLookupTableAccounts: luts,
      blockhash,
      ixs: allIxs,
      isSync: true,
    });

    const txSize = getTxSize(flashloanTx);
    const keyCount = getAccountKeys(flashloanTx, luts);

    const projectedBankKeys = computeProjectedActiveBanksNoCpi(
      account.balances,
      allIxs,
      client.program
    );
    const projectedBanks = projectedBankKeys
      .map((pk) => client.bankMap.get(pk.toBase58()))
      .filter((b): b is Bank => !!b);
    const healthMetas = computeHealthAccountMetas(projectedBanks);

    return {
      action: "SwapCollateral",
      variant: `w=${wVariant}, d=${dVariant}`,
      txSize,
      swapBudget: MAX_TX_SIZE - txSize,
      accountKeys: keyCount,
      healthMetaCount: healthMetas.length,
      activeBalances: account.balances.filter((b) => b.active).length,
      ixCount: flashloanTx.message.compiledInstructions.length,
      tx: flashloanTx,
      nonSwapIxs: allIxs,
    };
  } catch (error: any) {
    console.log(`   ⚠️  Error measuring ${tag}: ${error.message}`);
    return null;
  }
}

/**
 * Measure a swap-debt flashloan TX: Begin FL + CU×2 + Borrow + Repay + End FL
 */
async function measureSwapDebt(
  client: Project0Client,
  account: MarginfiAccount,
  borrowBank: Bank,
  repayBank: Bank,
  blockhash: string
): Promise<MeasurementResult | null> {
  const tag = "SwapDebt (borrow+repay=Standard)";

  try {
    const cuIxs = buildCuIxs();

    const borrowIxs = await makeBorrowIx({
      program: client.program,
      bank: borrowBank,
      bankMap: client.bankMap,
      tokenProgram: TOKEN_PROGRAM_ID,
      amount: 1.0,
      marginfiAccount: account,
      authority: account.authority,
      isSync: true,
      opts: { createAtas: false, wrapAndUnwrapSol: false },
    });

    const repayIxs = await makeRepayIx({
      program: client.program,
      bank: repayBank,
      tokenProgram: TOKEN_PROGRAM_ID,
      amount: 1.0,
      accountAddress: account.address,
      authority: account.authority,
      isSync: true,
      opts: { wrapAndUnwrapSol: false },
    });

    const allIxs = [...cuIxs, ...borrowIxs.instructions, ...repayIxs.instructions];

    const luts = client.addressLookupTables;

    const flashloanTx = await makeFlashLoanTx({
      program: client.program,
      marginfiAccount: account,
      bankMap: client.bankMap,
      addressLookupTableAccounts: luts,
      blockhash,
      ixs: allIxs,
      isSync: true,
    });

    const txSize = getTxSize(flashloanTx);
    const keyCount = getAccountKeys(flashloanTx, luts);

    const projectedBankKeys = computeProjectedActiveBanksNoCpi(
      account.balances,
      allIxs,
      client.program
    );
    const projectedBanks = projectedBankKeys
      .map((pk) => client.bankMap.get(pk.toBase58()))
      .filter((b): b is Bank => !!b);
    const healthMetas = computeHealthAccountMetas(projectedBanks);

    return {
      action: "SwapDebt",
      variant: "Standard",
      txSize,
      swapBudget: MAX_TX_SIZE - txSize,
      accountKeys: keyCount,
      healthMetaCount: healthMetas.length,
      activeBalances: account.balances.filter((b) => b.active).length,
      ixCount: flashloanTx.message.compiledInstructions.length,
      tx: flashloanTx,
      nonSwapIxs: allIxs,
    };
  } catch (error: any) {
    console.log(`   ⚠️  Error measuring ${tag}: ${error.message}`);
    return null;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  R&D: Flashloan Non-Swap TX Size Measurement");
  console.log("═══════════════════════════════════════════════════════════");

  // Load client
  const connection = getConnection();
  const config = getMarginfiConfig();
  const client = await Project0Client.initialize(connection, config);

  console.log(`\n📊 Loaded ${client.banks.length} banks`);
  console.log(`📋 LUTs: ${client.addressLookupTables.length}`);

  // Load account
  const accountAddress = getAccountAddress();
  const account = await MarginfiAccount.fetch(accountAddress, client.program);
  const activeBalances = account.balances.filter((b) => b.active);
  console.log(`\n👤 Account: ${account.address.toBase58()}`);
  console.log(`   Active balances: ${activeBalances.length}`);

  // Get blockhash
  const { blockhash } = await connection.getLatestBlockhash();

  // Categorize banks by asset tag
  const banksByTag = new Map<AssetTag, Bank[]>();
  for (const bank of client.banks) {
    const tag = bank.config.assetTag;
    if (!banksByTag.has(tag)) banksByTag.set(tag, []);
    banksByTag.get(tag)!.push(bank);
  }

  console.log("\n📦 Banks by asset tag:");
  for (const [tag, banks] of banksByTag) {
    console.log(`   ${assetTagName(tag)}: ${banks.length} banks`);
  }

  // Pick representative banks for each variant
  const standardBanks = banksByTag.get(AssetTag.DEFAULT) ?? [];
  const kaminoBanks = banksByTag.get(AssetTag.KAMINO) ?? [];
  const driftBanks = banksByTag.get(AssetTag.DRIFT) ?? [];
  const juplendBanks = banksByTag.get(AssetTag.JUPLEND) ?? [];
  const solBanks = banksByTag.get(AssetTag.SOL) ?? [];

  // We need at least 2 different banks for each measurement
  // Pick a "base" bank (standard SOL or USDC) for borrow/repay side
  const baseBank = solBanks[0] ?? standardBanks[0];
  if (!baseBank) {
    throw new Error("No standard or SOL bank found");
  }
  console.log(
    `\n🏦 Base bank (for borrow/repay): ${baseBank.tokenSymbol} (${assetTagName(baseBank.config.assetTag)})`
  );

  // Use USDC as the second bank
  const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const secondStdBank = standardBanks.find((b) => b.mint.equals(USDC_MINT));
  if (!secondStdBank) {
    throw new Error("No USDC bank found");
  }

  // Helper: check if a bank has an active position in the account
  const hasActivePosition = (bank: Bank) =>
    account.balances.some((b) => b.active && b.bankPk.equals(bank.address));

  // For withdraw/repay: bank must have an active position
  // For borrow/deposit: any bank works (creates new position)
  const activeStdBank = [...standardBanks, ...solBanks].find(hasActivePosition);
  const activeKaminoBank = kaminoBanks.find(hasActivePosition);
  const activeDriftBank = driftBanks.find(hasActivePosition);
  const activeJuplendBank = juplendBanks.find(hasActivePosition);

  console.log("\n📦 Active position banks:");
  if (activeStdBank) console.log(`   Standard/SOL: ${activeStdBank.tokenSymbol}`);
  if (activeKaminoBank) console.log(`   Kamino: ${activeKaminoBank.tokenSymbol}`);
  if (activeDriftBank) console.log(`   Drift: ${activeDriftBank.tokenSymbol}`);
  if (activeJuplendBank) console.log(`   Juplend: ${activeJuplendBank.tokenSymbol}`);

  // ============================================================================
  // Run measurements
  // ============================================================================

  const results: MeasurementResult[] = [];

  console.log("\n───────────────────────────────────────────────────────────");
  console.log("  Running measurements...");
  console.log("───────────────────────────────────────────────────────────");

  // --- Loop: Borrow(any) + Deposit(variant) ---
  console.log("\n📐 Loop measurements (Borrow + Deposit):");

  const loopStd = await measureLoop(client, account, baseBank, secondStdBank!, blockhash);
  if (loopStd) results.push(loopStd);

  if (kaminoBanks.length > 0) {
    const loopKamino = await measureLoop(client, account, baseBank, kaminoBanks[0]!, blockhash);
    if (loopKamino) results.push(loopKamino);
  }

  if (driftBanks.length > 0) {
    const loopDrift = await measureLoop(client, account, baseBank, driftBanks[0]!, blockhash);
    if (loopDrift) results.push(loopDrift);
  }

  if (juplendBanks.length > 0) {
    const loopJuplend = await measureLoop(client, account, baseBank, juplendBanks[0]!, blockhash);
    if (loopJuplend) results.push(loopJuplend);
  }

  // --- Repay: Withdraw(active) + Repay(active) ---
  console.log("\n📐 Repay measurements (Withdraw + Repay):");

  if (activeStdBank) {
    // Find a second active bank for the repay side
    const secondActiveBank = [...standardBanks, ...solBanks].find(
      (b) => hasActivePosition(b) && !b.address.equals(activeStdBank.address)
    );
    if (secondActiveBank) {
      const repayStd = await measureRepay(
        client,
        account,
        activeStdBank,
        secondActiveBank,
        blockhash
      );
      if (repayStd) results.push(repayStd);
    }
  }

  if (activeKaminoBank && activeStdBank) {
    const repayKamino = await measureRepay(
      client,
      account,
      activeKaminoBank,
      activeStdBank,
      blockhash
    );
    if (repayKamino) results.push(repayKamino);
  }

  if (activeDriftBank && activeStdBank) {
    const repayDrift = await measureRepay(
      client,
      account,
      activeDriftBank,
      activeStdBank,
      blockhash
    );
    if (repayDrift) results.push(repayDrift);
  }

  if (activeJuplendBank && activeStdBank) {
    const repayJuplend = await measureRepay(
      client,
      account,
      activeJuplendBank,
      activeStdBank,
      blockhash
    );
    if (repayJuplend) results.push(repayJuplend);
  }

  // --- SwapCollateral: Withdraw(active) + Deposit(any) ---
  console.log("\n📐 SwapCollateral measurements (Withdraw + Deposit):");

  if (activeStdBank) {
    const scStd = await measureSwapCollateral(
      client,
      account,
      activeStdBank,
      secondStdBank!,
      blockhash
    );
    if (scStd) results.push(scStd);

    if (kaminoBanks.length > 0) {
      const scKamino = await measureSwapCollateral(
        client,
        account,
        activeStdBank,
        kaminoBanks[0]!,
        blockhash
      );
      if (scKamino) results.push(scKamino);
    }

    if (driftBanks.length > 0) {
      const scDrift = await measureSwapCollateral(
        client,
        account,
        activeStdBank,
        driftBanks[0]!,
        blockhash
      );
      if (scDrift) results.push(scDrift);
    }

    if (juplendBanks.length > 0) {
      const scJuplend = await measureSwapCollateral(
        client,
        account,
        activeStdBank,
        juplendBanks[0]!,
        blockhash
      );
      if (scJuplend) results.push(scJuplend);
    }
  }

  if (activeKaminoBank) {
    const scKamino2 = await measureSwapCollateral(
      client,
      account,
      activeKaminoBank,
      secondStdBank!,
      blockhash
    );
    if (scKamino2) results.push(scKamino2);
  }

  // --- SwapDebt: Borrow(any) + Repay(active) ---
  console.log("\n📐 SwapDebt measurements (Borrow + Repay):");

  if (activeStdBank) {
    const sdStd = await measureSwapDebt(client, account, baseBank, activeStdBank, blockhash);
    if (sdStd) results.push(sdStd);
  }

  // ============================================================================
  // Print results table
  // ============================================================================

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  RESULTS");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  MAX_TX_SIZE = ${MAX_TX_SIZE}`);
  console.log(`  Active balances = ${activeBalances.length}`);
  console.log("");

  // Table header
  const header = [
    "Action".padEnd(16),
    "Variant".padEnd(28),
    "TxSize".padStart(7),
    "SwapBudget".padStart(11),
    "Keys".padStart(5),
    "HealthMetas".padStart(12),
    "IXs".padStart(4),
  ].join(" | ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of results) {
    const row = [
      r.action.padEnd(16),
      r.variant.padEnd(28),
      String(r.txSize).padStart(7),
      String(r.swapBudget).padStart(11),
      String(r.accountKeys).padStart(5),
      String(r.healthMetaCount).padStart(12),
      String(r.ixCount).padStart(4),
    ].join(" | ");
    console.log(row);
  }

  console.log("");
  console.log("───────────────────────────────────────────────────────────");
  console.log("  ANALYSIS");
  console.log("───────────────────────────────────────────────────────────");

  // Group by action type and show min/max swap budgets
  const byAction = new Map<string, MeasurementResult[]>();
  for (const r of results) {
    if (!byAction.has(r.action)) byAction.set(r.action, []);
    byAction.get(r.action)!.push(r);
  }

  for (const [action, rs] of byAction) {
    const budgets = rs.map((r) => r.swapBudget);
    const min = Math.min(...budgets);
    const max = Math.max(...budgets);
    const range = max - min;
    console.log(`\n  ${action}:`);
    console.log(`    Swap budget range: ${min} - ${max} bytes (spread: ${range})`);
    console.log(`    Variants: ${rs.map((r) => `${r.variant}=${r.swapBudget}`).join(", ")}`);
  }

  // ============================================================================
  // Per-IX byte breakdown
  // ============================================================================

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  PER-IX BYTE BREAKDOWN");
  console.log("═══════════════════════════════════════════════════════════");

  for (const r of results) {
    const msg = r.tx.message;
    const cixs = msg.compiledInstructions;

    // Compute per-IX sizes
    let totalIxBytes = 0;
    const ixDetails: string[] = [];
    for (let i = 0; i < cixs.length; i++) {
      const cix = cixs[i]!;
      const bytes = compiledIxSize(cix);
      totalIxBytes += bytes;
      const name = FL_IX_NAMES[i] ?? `IX${i}`;
      ixDetails.push(
        `${name}(${cix.accountKeyIndexes.length}accs,${cix.data.length}data)=${bytes}b`
      );
    }

    // IX count compact-u16
    const ixCountBytes = compactU16Size(cixs.length);
    totalIxBytes += ixCountBytes;

    // Static keys section
    const numStaticKeys = msg.staticAccountKeys.length;
    const staticKeysBytes = compactU16Size(numStaticKeys) + numStaticKeys * 32;

    // LUT section
    const lutEntries = msg.addressTableLookups;
    let lutBytes = compactU16Size(lutEntries.length);
    for (const lut of lutEntries) {
      lutBytes += 32; // LUT address
      lutBytes += compactU16Size(lut.writableIndexes.length) + lut.writableIndexes.length;
      lutBytes += compactU16Size(lut.readonlyIndexes.length) + lut.readonlyIndexes.length;
    }
    const totalLutKeys = lutEntries.reduce(
      (sum, l) => sum + l.writableIndexes.length + l.readonlyIndexes.length,
      0
    );

    // Fixed overhead: 1 (sigCount) + 64 (sig) + 1 (version) + 3 (header) + 32 (blockhash)
    const fixedOverhead = 1 + 64 + 1 + 3 + 32;

    const computed = fixedOverhead + staticKeysBytes + totalIxBytes + lutBytes;

    console.log(`\n  ${r.action} / ${r.variant} (txSize=${r.txSize}, computed=${computed})`);
    console.log(`    Fixed overhead:  ${fixedOverhead}b`);
    console.log(
      `    Static keys:     ${staticKeysBytes}b (${numStaticKeys} keys × 32 + ${compactU16Size(numStaticKeys)}b count)`
    );
    console.log(
      `    LUT section:     ${lutBytes}b (${totalLutKeys} keys across ${lutEntries.length} LUTs)`
    );
    console.log(`    IX count:        ${ixCountBytes}b`);
    console.log(`    IXs:             ${ixDetails.join(", ")}`);
    console.log(`    Total IX bytes:  ${totalIxBytes}b`);
    console.log(`    Static keys (not in LUT):`);
    for (const key of msg.staticAccountKeys) {
      const label = identifyKey(key, client, account);
      console.log(`      ${key.toBase58()} ${label}`);
    }
  }

  // ============================================================================
  // computeV0TxSize VERIFICATION
  // ============================================================================

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  computeV0TxSize VERIFICATION");
  console.log("═══════════════════════════════════════════════════════════");

  const luts = client.addressLookupTables;

  for (const r of results) {
    // computeV0TxSize needs the full IX list including BeginFL/EndFL.
    // We use computeFlashLoanNonSwapBudget which builds BeginFL/EndFL internally
    // and calls computeV0TxSize under the hood.
    const estimated = computeFlashLoanNonSwapBudget({
      program: client.program,
      marginfiAccount: account,
      ixs: r.nonSwapIxs,
      bankMap: client.bankMap,
      addressLookupTableAccounts: luts,
    });

    const actualBudget = r.swapBudget;
    const diff = estimated.sizeConstraint - actualBudget;
    const match = diff === 0 ? "✅" : `❌ off by ${diff}`;

    console.log(
      `  ${r.action.padEnd(16)} ${r.variant.padEnd(28)} ` +
        `actual=${String(actualBudget).padStart(4)}  estimated=${String(estimated.sizeConstraint).padStart(4)}  maxSwapAccounts=${String(estimated.maxSwapAccounts).padStart(3)}  ${match}`
    );
  }

  // ============================================================================
  // computeFlashloanSwapConstraints VERIFICATION
  // ============================================================================

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  computeFlashloanSwapConstraints VERIFICATION");
  console.log("  (unified helper used by action files)");
  console.log("═══════════════════════════════════════════════════════════");

  // Define test cases matching the measurements above
  type SwapConstraintTestCase = {
    label: string;
    primaryIx: Parameters<typeof computeFlashloanSwapConstraints>[0]["primaryIx"];
    secondaryIx: Parameters<typeof computeFlashloanSwapConstraints>[0]["secondaryIx"];
    expectedResult: MeasurementResult | null;
  };

  const swapConstraintTests: SwapConstraintTestCase[] = [];

  // Loop variants: borrow + deposit
  swapConstraintTests.push({
    label: "Loop Standard",
    primaryIx: { type: "borrow", bank: baseBank, tokenProgram: TOKEN_PROGRAM_ID },
    secondaryIx: { type: "deposit", bank: secondStdBank!, tokenProgram: TOKEN_PROGRAM_ID },
    expectedResult: results.find((r) => r.action === "Loop" && r.variant === "Standard") ?? null,
  });
  if (kaminoBanks.length > 0) {
    swapConstraintTests.push({
      label: "Loop Kamino",
      primaryIx: { type: "borrow", bank: baseBank, tokenProgram: TOKEN_PROGRAM_ID },
      secondaryIx: { type: "deposit", bank: kaminoBanks[0]!, tokenProgram: TOKEN_PROGRAM_ID },
      expectedResult: results.find((r) => r.action === "Loop" && r.variant === "Kamino") ?? null,
    });
  }
  if (driftBanks.length > 0) {
    swapConstraintTests.push({
      label: "Loop Drift",
      primaryIx: { type: "borrow", bank: baseBank, tokenProgram: TOKEN_PROGRAM_ID },
      secondaryIx: { type: "deposit", bank: driftBanks[0]!, tokenProgram: TOKEN_PROGRAM_ID },
      expectedResult: results.find((r) => r.action === "Loop" && r.variant === "Drift") ?? null,
    });
  }

  // Repay variants: withdraw + repay
  if (activeStdBank) {
    const secondActiveBank = [...standardBanks, ...solBanks].find(
      (b) =>
        account.balances.some((bal) => bal.active && bal.bankPk.equals(b.address)) &&
        !b.address.equals(activeStdBank.address)
    );
    if (secondActiveBank) {
      swapConstraintTests.push({
        label: "Repay Standard",
        primaryIx: { type: "withdraw", bank: activeStdBank, tokenProgram: TOKEN_PROGRAM_ID },
        secondaryIx: { type: "repay", bank: secondActiveBank, tokenProgram: TOKEN_PROGRAM_ID },
        expectedResult:
          results.find((r) => r.action === "Repay" && r.variant === "Standard") ?? null,
      });
    }
  }
  if (activeKaminoBank && activeStdBank) {
    swapConstraintTests.push({
      label: "Repay Kamino",
      primaryIx: { type: "withdraw", bank: activeKaminoBank, tokenProgram: TOKEN_PROGRAM_ID },
      secondaryIx: { type: "repay", bank: activeStdBank, tokenProgram: TOKEN_PROGRAM_ID },
      expectedResult: results.find((r) => r.action === "Repay" && r.variant === "Kamino") ?? null,
    });
  }
  if (activeDriftBank && activeStdBank) {
    swapConstraintTests.push({
      label: "Repay Drift",
      primaryIx: { type: "withdraw", bank: activeDriftBank, tokenProgram: TOKEN_PROGRAM_ID },
      secondaryIx: { type: "repay", bank: activeStdBank, tokenProgram: TOKEN_PROGRAM_ID },
      expectedResult: results.find((r) => r.action === "Repay" && r.variant === "Drift") ?? null,
    });
  }

  // SwapCollateral variants: withdraw + deposit
  if (activeStdBank) {
    swapConstraintTests.push({
      label: "SwapCollateral Std→Std",
      primaryIx: { type: "withdraw", bank: activeStdBank, tokenProgram: TOKEN_PROGRAM_ID },
      secondaryIx: { type: "deposit", bank: secondStdBank!, tokenProgram: TOKEN_PROGRAM_ID },
      expectedResult:
        results.find(
          (r) => r.action === "SwapCollateral" && r.variant === "w=Standard, d=Standard"
        ) ?? null,
    });
    if (kaminoBanks.length > 0) {
      swapConstraintTests.push({
        label: "SwapCollateral Std→Kamino",
        primaryIx: { type: "withdraw", bank: activeStdBank, tokenProgram: TOKEN_PROGRAM_ID },
        secondaryIx: { type: "deposit", bank: kaminoBanks[0]!, tokenProgram: TOKEN_PROGRAM_ID },
        expectedResult:
          results.find(
            (r) => r.action === "SwapCollateral" && r.variant === "w=Standard, d=Kamino"
          ) ?? null,
      });
    }
    if (driftBanks.length > 0) {
      swapConstraintTests.push({
        label: "SwapCollateral Std→Drift",
        primaryIx: { type: "withdraw", bank: activeStdBank, tokenProgram: TOKEN_PROGRAM_ID },
        secondaryIx: { type: "deposit", bank: driftBanks[0]!, tokenProgram: TOKEN_PROGRAM_ID },
        expectedResult:
          results.find(
            (r) => r.action === "SwapCollateral" && r.variant === "w=Standard, d=Drift"
          ) ?? null,
      });
    }
  }
  if (activeKaminoBank) {
    swapConstraintTests.push({
      label: "SwapCollateral Kamino→Std",
      primaryIx: { type: "withdraw", bank: activeKaminoBank, tokenProgram: TOKEN_PROGRAM_ID },
      secondaryIx: { type: "deposit", bank: secondStdBank!, tokenProgram: TOKEN_PROGRAM_ID },
      expectedResult:
        results.find(
          (r) => r.action === "SwapCollateral" && r.variant === "w=Kamino, d=Standard"
        ) ?? null,
    });
  }

  // SwapDebt: borrow + repay
  if (activeStdBank) {
    swapConstraintTests.push({
      label: "SwapDebt Standard",
      primaryIx: { type: "borrow", bank: baseBank, tokenProgram: TOKEN_PROGRAM_ID },
      secondaryIx: { type: "repay", bank: activeStdBank, tokenProgram: TOKEN_PROGRAM_ID },
      expectedResult:
        results.find((r) => r.action === "SwapDebt" && r.variant === "Standard") ?? null,
    });
  }

  let swapConstraintPassed = 0;
  let swapConstraintFailed = 0;

  for (const tc of swapConstraintTests) {
    if (!tc.expectedResult) {
      console.log(`  ${tc.label.padEnd(30)} ⏭️  skipped (no measurement result)`);
      continue;
    }

    try {
      const constraints = await computeFlashloanSwapConstraints({
        program: client.program,
        marginfiAccount: account,
        bankMap: client.bankMap,
        addressLookupTableAccounts: luts,
        bankMetadataMap: client.bankIntegrationMap,
        primaryIx: tc.primaryIx,
        secondaryIx: tc.secondaryIx,
      });

      const expectedBudget = tc.expectedResult.swapBudget;
      const sizeDiff = constraints.sizeConstraint - expectedBudget;
      const sizeMatch = sizeDiff === 0;

      const status = sizeMatch ? "✅" : `❌ size off by ${sizeDiff}`;

      if (sizeMatch) {
        swapConstraintPassed++;
      } else {
        swapConstraintFailed++;
      }

      console.log(
        `  ${tc.label.padEnd(30)} ` +
          `expected=${String(expectedBudget).padStart(4)}  got=${String(constraints.sizeConstraint).padStart(4)}  ` +
          `maxAccounts=${String(constraints.maxSwapAccounts).padStart(3)}  ${status}`
      );
    } catch (error: any) {
      swapConstraintFailed++;
      console.log(`  ${tc.label.padEnd(30)} ❌ ERROR: ${error.message}`);
    }
  }

  console.log(
    `\n  Summary: ${swapConstraintPassed} passed, ${swapConstraintFailed} failed out of ${swapConstraintTests.length} tests`
  );

  console.log("\n═══════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
