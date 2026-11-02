---
"@0dotxyz/p0-ts-sdk": patch
---

- **Health cache status:** a successfully simulated health cache now reads `HealthCacheStatus.ONCHAIN`. It used to stay `UNSET`, so every health read after `client.fetchAccount` or `simulateHealthCache` logged "Health cache not computed", and the status couldn't tell a simulated cache from one never computed. `COMPUTED` still marks the local fallback.
- **Wrapper withdrawals:** `MarginfiAccountWrapper.makeWithdrawIx` / `makeWithdrawTx` fill `groupRateLimiterEnabled` from the client's group, as `makeTransferPositionsTx` already did. With the group limiter off, a withdraw-all no longer appends the closed bank's accounts. Passing `opts.groupRateLimiterEnabled` still overrides it.
- **Swap config:** `SwapApiConfig.basePath` is deprecated; the swap engine never used it. The Jupiter adapter calls the Router `/build` endpoint at `https://api.jup.ag/swap/v2`, and Titan quotes over `wsUrl`. The examples no longer set it.
