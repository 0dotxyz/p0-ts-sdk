---
"@0dotxyz/p0-ts-sdk": patch
---

Convert the bank-level rate-limit remaining capacity into underlying units before clamping max borrow/withdraw. The program records the limiter outflow in the withdraw instruction's own denomination: cToken collateral amounts for Kamino banks and LST amounts for staked banks, but underlying token amounts for default, Drift and JupLend banks. The clamp previously compared the raw bank-mint amount against underlying-unit bounds, understating max withdraw on Kamino and staked banks by the exchange-rate factor whenever the rate limiter was the binding constraint.
