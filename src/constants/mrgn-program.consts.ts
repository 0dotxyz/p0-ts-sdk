import { PublicKey } from "@solana/web3.js";

export const DISABLED_FLAG: number = 1 << 0;
export const FLASHLOAN_ENABLED_FLAG: number = 1 << 2;
export const TRANSFER_ACCOUNT_AUTHORITY_FLAG: number = 1 << 3;

// Bank flags (0.1.9 SVSP transition)
/** Bank flags bit 9: staked oracle pricing is temporarily disabled */
export const STAKED_ORACLE_DISABLED_FLAG: number = 1 << 9;
/** Bank flags bit 10: staked oracle pricing includes the SPL single-pool on-ramp in NAV */
export const STAKED_ORACLE_USES_ONRAMP_FLAG: number = 1 << 10;

// Program keys
export const MARGINFI_PROGRAM = new PublicKey("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
export const MARGINFI_PROGRAM_STAGING = new PublicKey(
  "stag8sTKds2h4KzjUw3zKTsxbqvT4XKHdaR9X9E6Rct"
);
export const MARGINFI_PROGRAM_STAGING_ALT = new PublicKey(
  "5UDghkpgW1HfYSrmEj2iAApHShqU44H6PKTAar9LL9bY"
);
