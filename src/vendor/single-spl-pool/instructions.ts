import {
  AccountRole,
  address,
  getAddressEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import {
  findPoolMintAddress,
  findPoolMintAuthorityAddress,
  findPoolOnRampAddress,
  findPoolStakeAddress,
  findPoolStakeAuthorityAddress,
  SINGLE_POOL_PROGRAM_ADDRESS,
} from "./addresses";

const STAKE_PROGRAM_ADDRESS = address("Stake11111111111111111111111111111111111111");
const SYSVAR_CLOCK_ADDRESS = address("SysvarC1ock11111111111111111111111111111111");
const SYSVAR_STAKE_HISTORY_ADDRESS = address("SysvarStakeHistory1111111111111111111111111");

const DEPOSIT_STAKE = 2;
const WITHDRAW_STAKE = 3;

async function poolAccounts(pool: Address) {
  const [stake, onRamp, mint, stakeAuthority, mintAuthority] = await Promise.all([
    findPoolStakeAddress(pool),
    findPoolOnRampAddress(pool),
    findPoolMintAddress(pool),
    findPoolStakeAuthorityAddress(pool),
    findPoolMintAuthorityAddress(pool),
  ]);
  return [
    { address: pool, role: AccountRole.READONLY },
    { address: stake, role: AccountRole.WRITABLE },
    { address: onRamp, role: AccountRole.READONLY },
    { address: mint, role: AccountRole.WRITABLE },
    { address: stakeAuthority, role: AccountRole.READONLY },
    { address: mintAuthority, role: AccountRole.READONLY },
  ];
}

/**
 * Deposits an active stake account into a single pool, minting pool tokens to `userTokenAccount`;
 * the stake account's excess lamports go to `userLamportAccount`.
 */
export async function makeSinglePoolDepositStakeIx(
  pool: Address,
  userStakeAccount: Address,
  userTokenAccount: Address,
  userLamportAccount: Address
): Promise<Instruction> {
  return {
    programAddress: SINGLE_POOL_PROGRAM_ADDRESS,
    accounts: [
      ...(await poolAccounts(pool)),
      { address: userStakeAccount, role: AccountRole.WRITABLE },
      { address: userTokenAccount, role: AccountRole.WRITABLE },
      { address: userLamportAccount, role: AccountRole.WRITABLE },
      { address: SYSVAR_CLOCK_ADDRESS, role: AccountRole.READONLY },
      { address: SYSVAR_STAKE_HISTORY_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: STAKE_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([DEPOSIT_STAKE]),
  };
}

/**
 * Burns `tokenAmount` pool tokens (native units, 9 decimals) from `userTokenAccount` and splits that
 * stake into `userStakeAccount`, owned by `userStakeAuthority`.
 */
export async function makeSinglePoolWithdrawStakeIx(
  pool: Address,
  userStakeAccount: Address,
  userStakeAuthority: Address,
  userTokenAccount: Address,
  tokenAmount: bigint
): Promise<Instruction> {
  return {
    programAddress: SINGLE_POOL_PROGRAM_ADDRESS,
    accounts: [
      ...(await poolAccounts(pool)),
      { address: userStakeAccount, role: AccountRole.WRITABLE },
      { address: userTokenAccount, role: AccountRole.WRITABLE },
      { address: SYSVAR_CLOCK_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: STAKE_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([
      WITHDRAW_STAKE,
      ...getAddressEncoder().encode(userStakeAuthority),
      ...getU64Encoder().encode(tokenAmount),
    ]),
  };
}
