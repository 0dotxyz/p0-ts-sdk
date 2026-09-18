---
"@0dotxyz/p0-ts-sdk": patch
---

Pass `group` to the non-sync end-flash-loan instruction so loops on a not-yet-created (projected) account build. Previously Anchor resolved `group` by fetching the marginfi account, which fails with "Reached maximum depth for account resolution" before the account exists. `instructions.makeEndFlashLoanIx` now accepts an optional `group`.
