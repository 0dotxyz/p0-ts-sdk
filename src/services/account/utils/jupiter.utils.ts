import {
  address,
  fetchEncodedAccount,
  getAddressEncoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  type Address,
  type GetAccountInfoApi,
  type Instruction,
  type Rpc,
} from "@solana/kit";

import { SwapApiConfig } from "../types";

import { toAccountRole } from "~/utils";
import { type JupiterClientConfig, type Instruction as JupiterInstruction } from "~/vendor/jupiter";

const REFERRAL_PROGRAM_ID = address("REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3");
const REFERRAL_ACCOUNT_PUBKEY = address("6rQUBEfS3hASrBbviL7rXA5tRYmZmeFUgHgCYsjeDVBm");

export const getJupiterReferralFeeAccount = async (mint: Address): Promise<Address> => {
  const [feeAccount] = await getProgramDerivedAddress({
    programAddress: REFERRAL_PROGRAM_ID,
    seeds: [
      "referral_ata",
      getAddressEncoder().encode(REFERRAL_ACCOUNT_PUBKEY),
      getAddressEncoder().encode(mint),
    ],
  });
  return feeAccount;
};

export const checkJupiterFeeAccount = async (
  rpc: Rpc<GetAccountInfoApi>,
  mint: Address
): Promise<{ feeAccount: Address; hasFeeAccount: boolean }> => {
  const feeAccount = await getJupiterReferralFeeAccount(mint);
  const hasFeeAccount = (await fetchEncodedAccount(rpc, feeAccount)).exists;
  return { feeAccount, hasFeeAccount };
};

export function deserializeJupiterInstruction(instruction: JupiterInstruction): Instruction {
  return {
    programAddress: address(instruction.programId),
    accounts: instruction.accounts.map((key) => ({
      address: address(key.pubkey),
      role: toAccountRole(key.isSigner, key.isWritable),
    })),
    data: getBase64Encoder().encode(instruction.data),
  };
}

export function toJupiterConfig(apiConfig?: SwapApiConfig): JupiterClientConfig | undefined {
  if (!apiConfig) return undefined;
  return {
    basePath: apiConfig.basePath,
    apiKey: apiConfig.apiKey,
    headers: apiConfig.headers,
  };
}
