---
"@0dotxyz/p0-ts-sdk": minor
---

Add a multi-provider swap engine for flashloan flows (loop, swap-collateral, swap-debt).

- New `services/account/swap-engine` module: `runSwapEngine` fans out to all configured
  providers in parallel (Titan Swap V3 + Jupiter Router `/swap/v2/build` at a maxAccounts
  ladder), keeps only routes that fit the remaining flashloan budget, and returns the
  highest-output route. Adding a provider = one adapter + one registry entry.
- Titan upgraded to Swap V3 with a full-footprint `transactionTemplate` for precise route
  sizing (`vendor/titan/gateway.ts`); Jupiter upgraded from Metis to the Router `/build`
  endpoint (`vendor/jupiter`).
- `makeLoopTx` / `makeSwapCollateralTx` / `makeSwapDebtTx` route their swap through the
  engine. They accept an optional `swapEngineRunner` (default in-process) so the provider
  fan-out can be executed server-side; `serialize*`/`deserialize*` helpers support that seam.
- `makeLoopTx` `depositOpts`/`borrowOpts` now require `marketPrice` (USD/UI) to seed the
  pre-swap deposit estimate.
- All four flashloan-swap flows (loop, swap-collateral, swap-debt, repay-with-collateral)
  route through the engine and accept `swapEngineRunner`.
- **Removed provider ExactOut.** Jupiter Router `/build` is ExactIn-only and provider
  ExactOut quotes are unreliable, so swap-debt now sizes the borrow from a market-price
  calculation (`repayOpts`/`borrowOpts.marketPrice`) and routes ExactIn. The engine's
  ExactOut path + provider ExactOut adapter methods are removed; `getExactOutEstimate` /
  `getTitanExactOutEstimate` are deprecated.
