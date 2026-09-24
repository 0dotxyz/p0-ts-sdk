import { address, type ReadonlyUint8Array } from "@solana/kit";
import BigNumber from "bignumber.js";

export const SPL_STAKE_POOL_PROGRAM_ADDRESS = address(
  "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy"
);
export const SANCTUM_SPL_STAKE_POOL_PROGRAM_ADDRESS = address(
  "SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY"
);
export const SANCTUM_SPL_MULTI_STAKE_POOL_PROGRAM_ADDRESS = address(
  "SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn"
);

// StakePool is borsh-serialized from byte 0: account_type u8 @0, then 8 pubkeys + a bump byte,
// then total_lamports u64 @258, pool_token_supply u64 @266, last_update_epoch u64 @274.
const ACCOUNT_TYPE_STAKE_POOL = 1;
const TOTAL_LAMPORTS_OFFSET = 258;
const POOL_TOKEN_SUPPLY_OFFSET = 266;
const LAST_UPDATE_EPOCH_OFFSET = 274;
const MAX_LST_SOL_RATE = 3;

export interface StakePool {
  totalLamports: bigint;
  poolTokenSupply: bigint;
  lastUpdateEpoch: number;
  /** LST/SOL exchange rate, i.e. `total_lamports / pool_token_supply` */
  exchangeRate: BigNumber;
}

/**
 * Decodes the balances and LST/SOL rate of an SPL (or Sanctum) stake pool account.
 * @throws if the account is undersized, is not a StakePool, has no token supply, or yields a rate
 * outside (0, 3)
 */
export function decodeStakePool(data: ReadonlyUint8Array): StakePool {
  if (data.length < LAST_UPDATE_EPOCH_OFFSET + 8) {
    throw new Error(`Invalid StakePool account size: ${data.length}`);
  }
  if (data[0] !== ACCOUNT_TYPE_STAKE_POOL) {
    throw new Error(`Invalid StakePool account type: ${data[0]}`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const totalLamports = view.getBigUint64(TOTAL_LAMPORTS_OFFSET, true);
  const poolTokenSupply = view.getBigUint64(POOL_TOKEN_SUPPLY_OFFSET, true);
  const lastUpdateEpoch = Number(view.getBigUint64(LAST_UPDATE_EPOCH_OFFSET, true));

  if (poolTokenSupply === 0n) {
    throw new Error("StakePool has zero token supply");
  }

  const exchangeRate = new BigNumber(totalLamports.toString()).div(poolTokenSupply.toString());

  // Same sanity bounds as the program's MAX_LST_SOL_RATE
  if (!exchangeRate.gt(0) || exchangeRate.gte(MAX_LST_SOL_RATE)) {
    throw new Error(`StakePool LST/SOL rate out of bounds: ${exchangeRate.toString()}`);
  }

  return { totalLamports, poolTokenSupply, lastUpdateEpoch, exchangeRate };
}
