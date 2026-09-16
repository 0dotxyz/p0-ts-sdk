---
"@0dotxyz/p0-ts-sdk": patch
---

Oracle multipliers split into two steps: `fetchMultiplierAccountStates` / `fetchMultiplierAccountStatesFromAPI` read and decode the multiplier accounts (Marinade state, SPL stake pool, Exponent vault; JSON-safe `MultiplierAccountState`), and the sync `computeOracleMultipliers` maps them onto banks via `OracleMultiplierBankInput` (from `getOracleMultiplierBankInput`). `fetchOracleMultipliersFromChain` / `fetchOracleMultipliersFromAPI` now take inputs instead of `BankType[]`; the api mode sends only `multiplierAccounts` and expects `{ data: MultiplierAccountStates }`. `fetchOracleMultipliers(banks, opts)` is unchanged.
