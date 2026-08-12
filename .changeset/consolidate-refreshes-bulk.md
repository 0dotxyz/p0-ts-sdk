---
"@0dotxyz/p0-ts-sdk": patch
---

Consolidate integration refreshes and bulk tx building across account actions. Introduces two new price actions (`oracle-update`, `refresh-integration-banks`) and reworks `borrow`, `withdraw`, `repay`, `loop`, `swap-collateral`, `swap-debt`, `bridge-swap`, `flash-loan`, `bulk`, `transfer-positions`, and `account-lifecycle` to share common refresh/projection logic. Reduces duplication and improves consistency of transaction projections.
