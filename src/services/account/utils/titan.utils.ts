import {
  address,
  fetchEncodedAccount,
  type Address,
  type GetAccountInfoApi,
  type Rpc,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const TITAN_FEE_WALLET = address("FEES6XLN7dMz2iBwKab9Hri9Kwc4WJ6TmDAiT4BNhyej");

export const checkTitanFeeAccount = async (
  rpc: Rpc<GetAccountInfoApi>,
  mint: Address
): Promise<{ feeAccount: Address; hasFeeAccount: boolean; feeWallet: Address }> => {
  const [feeAccount] = await findAssociatedTokenPda({
    mint,
    owner: TITAN_FEE_WALLET,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const hasFeeAccount = (await fetchEncodedAccount(rpc, feeAccount)).exists;
  return { feeAccount, hasFeeAccount, feeWallet: TITAN_FEE_WALLET };
};
