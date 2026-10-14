---
"@0dotxyz/p0-ts-sdk": patch
---

The `Bank` model keeps `stakedOracleDisabled`, `stakedOracleUsesOnramp` and `stakedIntegrationAccounts`. Banks fetched through `Project0Client` lost them, so staked banks with on-ramp pricing were treated as pre-transition when building health accounts and computing the LST multiplier.
