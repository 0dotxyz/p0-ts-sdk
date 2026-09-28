import type {
  Address,
  GetAccountInfoApi,
  GetLatestBlockhashApi,
  Rpc,
  TransactionSigner,
} from "@solana/kit";

import type { ActionTxParams, SwapEngineRunner, SwapFlowRpc, SwapOpts } from "~/services/account";
import type { Amount } from "~/types";

/** Shared by every Gamma vault action. */
interface VaultActionIxParams {
  rpc: Rpc<GetAccountInfoApi>;
  /** The vault user; signs and pays. */
  authority: TransactionSigner;
  /** The vault's `LpVault` account. */
  lpVault: Address;
  /** Token program of the vault's mints; read from the asset mint's owner when omitted. */
  tokenProgram?: Address;
}

interface VaultActionTxParams extends Omit<VaultActionIxParams, "rpc">, ActionTxParams {
  rpc: Rpc<GetAccountInfoApi & GetLatestBlockhashApi>;
}

export interface MakeVaultDepositIxParams extends VaultActionIxParams {
  /** Asset mint base units. */
  amount: Amount;
}

export interface MakeVaultDepositTxParams
  extends Omit<MakeVaultDepositIxParams, "rpc">, VaultActionTxParams {}

export interface MakeVaultWithdrawIxParams extends VaultActionIxParams {
  /** Share mint base units. */
  sharesAmount: Amount;
}

export interface MakeVaultWithdrawTxParams
  extends Omit<MakeVaultWithdrawIxParams, "rpc">, VaultActionTxParams {}

export type MakeVaultCompleteWithdrawalIxParams = VaultActionIxParams;

export type MakeVaultCompleteWithdrawalTxParams = VaultActionTxParams;

/** Swaps `inputAmount` (UI units of `inputMint`) into the vault's asset mint, then deposits it. */
export interface MakeVaultDepositWithSwapTxParams
  extends Omit<VaultActionIxParams, "rpc">, Omit<ActionTxParams, "rpc"> {
  rpc: SwapFlowRpc;
  inputMint: Address;
  inputAmount: Amount;
  inputDecimals: number;
  swapOpts: SwapOpts;
  swapEngineRunner?: SwapEngineRunner;
}
