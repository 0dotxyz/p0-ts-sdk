import type {
  Address,
  GetAccountInfoApi,
  GetLatestBlockhashApi,
  GetMinimumBalanceForRentExemptionApi,
  Rpc,
  TransactionSigner,
} from "@solana/kit";

import type { ActionTxParams } from "~/services/account/types";
import type { Amount } from "~/types";

export interface MakeMintStakedLstIxParams {
  rpc: Rpc<GetAccountInfoApi & GetMinimumBalanceForRentExemptionApi>;
  /** SOL (UI units) to move into the pool; the whole account when it's at least its delegation. */
  amount: Amount;
  /** Staker and withdrawer of `stakeAccount`; receives the LST, signs and pays. */
  authority: TransactionSigner;
  stakeAccount: Address;
  /** Vote account of the pool's validator. */
  validator: Address;
}

export interface MakeMintStakedLstTxParams
  extends Omit<MakeMintStakedLstIxParams, "rpc">, ActionTxParams {
  rpc: Rpc<GetAccountInfoApi & GetLatestBlockhashApi & GetMinimumBalanceForRentExemptionApi>;
}

export interface MakeRedeemStakedLstIxParams {
  rpc: Rpc<GetMinimumBalanceForRentExemptionApi>;
  /** LST (UI units) to redeem. */
  amount: Amount;
  /** Holds the LST and owns the new stake account; signs and pays. */
  authority: TransactionSigner;
  /** Vote account of the pool's validator. */
  validator: Address;
}

export interface MakeRedeemStakedLstTxParams
  extends Omit<MakeRedeemStakedLstIxParams, "rpc">, ActionTxParams {
  rpc: Rpc<GetLatestBlockhashApi & GetMinimumBalanceForRentExemptionApi>;
}

export interface MakeMergeStakeAccountsTxParams extends ActionTxParams {
  /** Stake authority of both accounts; signs and pays. */
  authority: TransactionSigner;
  /** Drained into `destinationStakeAccount`. */
  sourceStakeAccount: Address;
  destinationStakeAccount: Address;
}
