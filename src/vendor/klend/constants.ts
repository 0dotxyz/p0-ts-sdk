import { PublicKey } from "@solana/web3.js";

export const KLEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);
export const FARMS_PROGRAM_ID = new PublicKey(
  "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"
);

const MAIN_MARKET: PublicKey = new PublicKey(
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
);
const MAIN_MARKET_LUT: PublicKey = new PublicKey(
  "284iwGtA9X9aLy3KsyV8uT2pXLARhYbiSi5SiM2g47M2"
);

// Slot timing constants (matches Kamino SDK)
export const SLOTS_PER_SECOND = 2;

export const SLOTS_PER_MINUTE = SLOTS_PER_SECOND * 60;

export const SLOTS_PER_HOUR = SLOTS_PER_MINUTE * 60;

export const SLOTS_PER_DAY = SLOTS_PER_HOUR * 24;

export const SLOTS_PER_YEAR = SLOTS_PER_DAY * 365;

// Default slot duration in milliseconds
export const DEFAULT_RECENT_SLOT_DURATION_MS = 450;

export const ONE_HUNDRED_PCT_IN_BPS = 10_000;

const klendConstants = {
  MAIN_MARKET,
  MAIN_MARKET_LUT,
  KLEND_PROGRAM_ID,
  FARMS_PROGRAM_ID,
};

export default klendConstants;
