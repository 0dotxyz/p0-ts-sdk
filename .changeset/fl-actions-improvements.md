---
"@0dotxyz/p0-ts-sdk": minor
---

Flashloan actions improvements (merged from feat/fl-actions-improvements):

- Add Titan swap provider support with WebSocket and HTTP proxy paths, including vendored SDK client
- Add swap provider fallback system with configurable primary/fallback providers
- Add provider field to SwapQuoteResult to expose which swap provider was used
- Add flashloan TX size estimator for computing swap byte/account budgets without serialization
- Add exact-out estimate routing for swap-debt actions via Titan and Jupiter
- Remove writable account checks for flashloan transactions
- Support market pricing instead of oracle for swap quotes
