---
"@0dotxyz/p0-ts-sdk": patch
---

Fix: gate `feeAccount` on a non-zero `platformFeeBps` for both Jupiter and
Titan swap paths. Previously, callers passing `platformFeeBps: 0` (or
`undefined`) while a referral ATA existed on-chain would still attach
`feeAccount` to the swap request, causing Jupiter to reject with
`platformFee must be greater than 0 when feeAccount is set`. Both
`getJupiterSwapIxsForFlashloan` and `getTitanSwapIxsForFlashloan` now strip
`platformFeeBps` and omit `feeAccount` together when either prerequisite is
missing.
