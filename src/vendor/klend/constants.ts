// Slot timing constants (matches Kamino SDK)
export const SLOTS_PER_SECOND = 2;

export const SLOTS_PER_MINUTE = SLOTS_PER_SECOND * 60;

export const SLOTS_PER_HOUR = SLOTS_PER_MINUTE * 60;

export const SLOTS_PER_DAY = SLOTS_PER_HOUR * 24;

export const SLOTS_PER_YEAR = SLOTS_PER_DAY * 365;

// Wall-clock year used by the klend program for `TrueApr` reserves
// (`SECONDS_PER_YEAR = 60 * 60 * 24 * 365`, no leap-year correction).
export const SECONDS_PER_YEAR = 31_536_000;

// Default slot duration in milliseconds (matches klend-sdk >= 11)
export const DEFAULT_RECENT_SLOT_DURATION_MS = 350;

export const ONE_HUNDRED_PCT_IN_BPS = 10_000;
