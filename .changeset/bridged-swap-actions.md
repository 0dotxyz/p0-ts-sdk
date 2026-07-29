---
"@0dotxyz/p0-ts-sdk": patch
---

Add bridged-swap support to `loop`, `swapCollateral`, and `swapDebt` actions: when the collateral/debt legs span assets on different routing groups, the SDK now composes the bridge automatically via the new `bridge-routing.utils`. Includes a new `16b-loop-bridged.ts` example, a refactored `16a-loop.ts`, and tests for bridge routing.
