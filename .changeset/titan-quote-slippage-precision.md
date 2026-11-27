---
"@0dotxyz/p0-ts-sdk": patch
---

Compute Titan quote slippage thresholds with decimal arithmetic so bigint native amounts retain their precision and binary floating-point error cannot add an extra native unit when rounding ExactOut quotes.
