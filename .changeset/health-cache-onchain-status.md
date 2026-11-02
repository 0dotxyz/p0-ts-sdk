---
"@0dotxyz/p0-ts-sdk": patch
---

A successfully simulated health cache now reads `HealthCacheStatus.ONCHAIN`. It used to stay `UNSET`, so every health read after `client.fetchAccount` or `simulateHealthCache` logged "Health cache not computed", and the status couldn't tell a simulated cache from one never computed. `COMPUTED` still marks the local fallback.
