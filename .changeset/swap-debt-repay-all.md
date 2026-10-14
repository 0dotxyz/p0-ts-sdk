---
"@0dotxyz/p0-ts-sdk": patch
---

Swap debt sends `repay_all` whenever the quoted output covers the debt. It used to decide from a float-rounded total, which missed most debts that weren't a whole number of native units and left dust behind; since marginfi 0.1.12 the program rejects some of those repays. `computeClosePositionTokenAmount` now rounds in decimal, so float error can't add or drop a native unit.
