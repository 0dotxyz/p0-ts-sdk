import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";

/** SPL Single Pool program. */
export const SINGLE_POOL_PROGRAM_ADDRESS = address("SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE");

async function findPda(baseAddress: Address, prefix: string): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: SINGLE_POOL_PROGRAM_ADDRESS,
    seeds: [prefix, getAddressEncoder().encode(baseAddress)],
  });
  return pda;
}

/** Single pool of a validator vote account. */
export function findPoolAddress(voteAccount: Address): Promise<Address> {
  return findPda(voteAccount, "pool");
}

/** Pool's main stake account. */
export function findPoolStakeAddress(pool: Address): Promise<Address> {
  return findPda(pool, "stake");
}

/** Pool's on-ramp stake account (activates new deposits). */
export function findPoolOnRampAddress(pool: Address): Promise<Address> {
  return findPda(pool, "onramp");
}

/** Pool token (LST) mint. */
export function findPoolMintAddress(pool: Address): Promise<Address> {
  return findPda(pool, "mint");
}

/** Pool stake authority. */
export function findPoolStakeAuthorityAddress(pool: Address): Promise<Address> {
  return findPda(pool, "stake_authority");
}

/** Pool token mint authority. */
export function findPoolMintAuthorityAddress(pool: Address): Promise<Address> {
  return findPda(pool, "mint_authority");
}
