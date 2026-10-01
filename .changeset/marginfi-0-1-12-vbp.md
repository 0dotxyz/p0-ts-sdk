---
"@0dotxyz/p0-ts-sdk": minor
---

Support marginfi program **0.1.12** and the new **variable borrow premium (VBP)** mechanic end-to-end:

- **IDL / decoding:** bump bundled IDL from `marginfi_0.1.11` to `marginfi_0.1.12` (`marginfi-types_0.1.12.ts`), decode VBP fields on `Bank` / `Group` / balances, and update `OracleSetup` / detection accordingly. Also removes the now-unused `emissions-compute.utils.ts` helpers that 0.1.12 obsoletes.
- **Compute:** `premium-compute.utils.ts` extended with VBP accrual helpers; `balance-value-compute.utils` (`computeBalanceLiabilityUsdValue`), `account-metrics.utils`, and `transaction-projection.utils` now include VBP in liabilities, health, and APY computations.
- **Actions:** `deposit`, `repay`, `bulk`, and `account-lifecycle` now refresh VBP after deposits and repays (new helper on `MarginfiAccountWrapper`). Includes a new `premium-refresh.test.ts` and expanded `premium-compute.test.ts`.
- **Misc:** new `pda.utils` helpers and `close-account-instruction.test.ts` wiring for 0.1.12.
