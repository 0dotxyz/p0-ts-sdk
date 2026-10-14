---
"@0dotxyz/p0-ts-sdk": patch
---

`computeStakedBankMultipliers`, `fetchStakePoolMev` and `fetchStakePoolActiveStates` keep each pool's accounts aligned when one of them doesn't exist. A missing account used to shift every later account onto the wrong pool (and crashed `fetchStakePoolActiveStates`); now that pool alone falls back.
