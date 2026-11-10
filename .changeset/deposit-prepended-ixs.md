---
"@0dotxyz/p0-ts-sdk": minor
---

`makeDepositTx` takes `prependedIxs`, put in the deposit transaction ahead of the deposit's own instructions. Pass `makeCreateAccountIx` (with the account from `makeCreateAccountIxWithProjection`) to create an account and make its first deposit in one transaction.
