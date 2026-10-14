---
"@0dotxyz/p0-ts-sdk": patch
---

Health accounts for a staked bank always include the on-ramp slot. A bank whose `oracleKeys[3]` isn't backfilled yet used to get one account too few, so any transaction that health-checked it failed with `WrongNumberOfOracleAccounts`; it now passes the empty key as the placeholder the program expects.
