import BigNumber from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

export const SPL_STAKE_POOL_PROGRAM_ID = new PublicKey(
  "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy"
);
export const SANCTUM_SPL_STAKE_POOL_PROGRAM_ID = new PublicKey(
  "SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY"
);
export const SANCTUM_SPL_MULTI_STAKE_POOL_PROGRAM_ID = new PublicKey(
  "SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn"
);

// StakePool is borsh-serialized from byte 0: account_type u8 @0, then 8 pubkeys + a bump byte,
// then total_lamports u64 @258, pool_token_supply u64 @266, last_update_epoch u64 @274.
const ACCOUNT_TYPE_STAKE_POOL = 1;
const TOTAL_LAMPORTS_OFFSET = 258;
const POOL_TOKEN_SUPPLY_OFFSET = 266;
const LAST_UPDATE_EPOCH_OFFSET = 274;

export interface StakePool {
  totalLamports: bigint;
  poolTokenSupply: bigint;
  lastUpdateEpoch: number;
  /** LST/SOL exchange rate, i.e. `total_lamports / pool_token_supply` */
  exchangeRate: BigNumber;
}

export function decodeStakePool(data: Buffer): StakePool {
  if (data.length < LAST_UPDATE_EPOCH_OFFSET + 8) {
    throw new Error(`Invalid StakePool account size: ${data.length}`);
  }
  if (data[0] !== ACCOUNT_TYPE_STAKE_POOL) {
    throw new Error(`Invalid StakePool account type: ${data[0]}`);
  }

  const totalLamports = data.readBigUInt64LE(TOTAL_LAMPORTS_OFFSET);
  const poolTokenSupply = data.readBigUInt64LE(POOL_TOKEN_SUPPLY_OFFSET);
  const lastUpdateEpoch = Number(data.readBigUInt64LE(LAST_UPDATE_EPOCH_OFFSET));

  if (poolTokenSupply === 0n) {
    throw new Error("StakePool has zero token supply");
  }

  return {
    totalLamports,
    poolTokenSupply,
    lastUpdateEpoch,
    exchangeRate: new BigNumber(totalLamports.toString()).div(
      new BigNumber(poolTokenSupply.toString())
    ),
  };
}
