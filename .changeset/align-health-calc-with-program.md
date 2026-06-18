---
"@0dotxyz/p0-ts-sdk": patch
---

Align the off-chain health calculation with the on-chain program's risk engine.

- ReduceOnly banks now contribute 0 asset value to the **Initial** requirement (Maintenance/Equity unchanged), matching the program. Fixes inflated available collateral for accounts holding ReduceOnly collateral.
- Isolated risk-tier banks now contribute 0 asset value for all requirement types.
- Price type is now derived purely from the requirement type (`isWeightedPrice` returns true for Initial **and** Equity), mirroring the program's `RequirementType::get_oracle_price_type`. Equity health-cache values now use the time-weighted price and the conservative confidence bias (Lowest for assets, Highest for liabilities), matching the program.

Removed the divergent, unbiased equity aggregate helper:
- `computeHealthComponentsWithoutBiasFromBalances` (function and the `ComputeHealthComponentsWithoutBiasParams` type)
- `MarginfiAccount.computeHealthComponentsWithoutBiasFromBalances` (model method)

Use `computeHealthComponentsFromBalances` for program-faithful (biased) health values, or `computeBalanceUsdValue` for per-balance neutral/mid-price display values.
