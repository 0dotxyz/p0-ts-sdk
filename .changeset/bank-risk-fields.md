---
"@0dotxyz/p0-ts-sdk": minor
---

Banks now carry their per-bank classic-liquidation fees (`liquidationLiquidatorFee`, `liquidationInsuranceFee`) and circuit-breaker state (`isCircuitBreakerEnabled`, `cbTier`, `cbHaltEndedAt`, plus `config.cbWindowMaxUpBps` / `cbWindowMaxDownBps` / `cbWindowSeconds`), decoded on-chain and carried through the DTO. New `getBankLiquidationFees` decodes the fees with the program's 2.5% default, and `isBankCircuitBreakerHalted` mirrors the program's halt check.
