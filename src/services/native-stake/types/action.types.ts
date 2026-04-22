import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
} from "@solana/web3.js";

import { Amount } from "~/types";

// -- Native Stake Actions ----

export interface MakeMintStakedLstIxParams {
  amount: Amount;
  authority: PublicKey;
  stakeAccountPk: PublicKey;
  validator: PublicKey;
  connection: Connection;
}

export interface MakeMintStakedLstTxParams extends MakeMintStakedLstIxParams {
  luts: AddressLookupTableAccount[];
  blockhash?: string;
}

export interface MakeRedeemStakedLstIxParams {
  amount: Amount;
  authority: PublicKey;
  validator: PublicKey;
  connection: Connection;
}

export interface MakeRedeemStakedLstTxParams extends MakeRedeemStakedLstIxParams {
  luts: AddressLookupTableAccount[];
  blockhash?: string;
}

export interface MakeMergeStakeAccountsTxParams {
  authority: PublicKey;
  sourceStakeAccount: PublicKey;
  destinationStakeAccount: PublicKey;
  connection: Connection;
  luts: AddressLookupTableAccount[];
  blockhash?: string;
}
