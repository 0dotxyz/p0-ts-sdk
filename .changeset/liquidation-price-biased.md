---
"@0dotxyz/p0-ts-sdk": patch
---

`computeLiquidationPriceForBank` subtracts the bank's price-biased value from the price-biased health cache, and counts collateral in venue banks (Kamino, Juplend, Drift, staked) in underlying tokens. It used to subtract the unbiased value and divide by the cToken quantity, which put the liquidation price of collateral too high.
