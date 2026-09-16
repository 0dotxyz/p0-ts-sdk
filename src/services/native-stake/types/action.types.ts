import { AddressLookupTableAccount, PublicKey } from "@solana/web3.js";

import { Amount, SolanaRpc } from "~/types";

// -- Native Stake Actions ----

export interface MakeMintStakedLstIxParams {
  amount: Amount;
  authority: PublicKey;
  stakeAccountPk: PublicKey;
  validator: PublicKey;
  connection: SolanaRpc;
}

export interface MakeMintStakedLstTxParams extends MakeMintStakedLstIxParams {
  luts: AddressLookupTableAccount[];
  blockhash?: string;
}

export interface MakeRedeemStakedLstIxParams {
  amount: Amount;
  authority: PublicKey;
  validator: PublicKey;
  connection: SolanaRpc;
}

export interface MakeRedeemStakedLstTxParams extends MakeRedeemStakedLstIxParams {
  luts: AddressLookupTableAccount[];
  blockhash?: string;
}

export interface MakeMergeStakeAccountsTxParams {
  authority: PublicKey;
  sourceStakeAccount: PublicKey;
  destinationStakeAccount: PublicKey;
  connection: SolanaRpc;
  luts: AddressLookupTableAccount[];
  blockhash?: string;
}
