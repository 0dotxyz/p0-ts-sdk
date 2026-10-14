---
"@0dotxyz/p0-ts-sdk": patch
---

`computeStakedBankMultipliers` prices staked collateral the way the program does. Pre-transition pools use the delegated stake above the 1 SOL bootstrap instead of the stake account's lamports, which also counted rent and undelegated SOL and overvalued some LSTs by up to ~17%. Banks with on-ramp pricing (`stakedOracleUsesOnramp`) use both pool accounts above rent over the supply plus the 1 SOL phantom supply.
