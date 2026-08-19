---
"@0dotxyz/p0-ts-sdk": patch
---

feat: bank-aware max amounts

- `computeMaxBorrowForBank` / `computeMaxWithdrawForBank` now clamp the health-based amount by the bank's remaining borrow cap (borrow only), available liquidity projected through interest accrual, the bank net-outflow rate limiter and (when `groupRateLimiter` is passed — auto-injected by `MarginfiAccountWrapper`) the group USD rate limiter. Borrow bounds account for `protocolOriginationFee`. Pass `ignoreBankLimits: true` for the previous purely health-based number (e.g. liquidation / flashloan flows, which skip rate limits on-chain).
- New `computeMaxDepositForBank` (remaining deposit cap in underlying UI units, optionally min'd with a wallet balance) on the utils, `MarginfiAccount` and `MarginfiAccountWrapper`.
- New bank utils: `computeBankAvailableLiquidity`, `computeBankProjectedAvailableLiquidity`, rate-limiter helpers (`computeRateLimitWindowRemainingCapacity`, `computeRateLimiterRemainingCapacity`, `computeBankRateLimitRemaining`, `computeGroupRateLimitRemainingUsd`), `isDepositLimitActive` / `isBorrowLimitActive` / `getEffectiveDepositLimit`, `computeAccrualProjectionSeconds`, `U64_MAX`, `SECONDS_PER_YEAR`.
- `computeRemainingCapacity` now mirrors the program exactly: strict caps (`floor(limit - total - 1)`), `u64::MAX` = no limit, Drift limits scaled to 9-decimal balance units, and an interest buffer of `max(2 × age, age + 120s)` (365-day year). `computeBankDepositCapRemaining` / `computeBankBorrowCapRemaining` return `Infinity` for inactive limits.
