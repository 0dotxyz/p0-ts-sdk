---
"@0dotxyz/p0-ts-sdk": patch
---

Fix a few edge cases in bridged looping:

- Corrected inverted borrow-bank oracle-price guard in `makeBridgedLoopTx` (`if (borrowBankPrice)` → `if (borrowBankPrice <= 0)`) that was aborting the direct loop whenever a valid price was available.
- Renamed the misspelled `birdgeBankPrice` local to `bridgeBankPrice` throughout.
- Bridge routing now warns when a candidate fails to build a leg, easing debugging of double-hop fallbacks.
