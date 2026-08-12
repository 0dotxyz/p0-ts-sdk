---
"@0dotxyz/p0-ts-sdk": patch
---

Fix PT rollover (`makeRollPtTx`) in browser environments:

- Import `Buffer` explicitly (and declare `buffer` as a dependency) in files using the BigInt read/write methods. Bundlers substitute the bare global with polyfills that predate `writeBigUInt64LE` (added in buffer@5.5.0), crashing the Exponent instruction builders under Next.js/Turbopack.
- Add an injectable `simulateTx` quote-sim transport to `MakeRollPtTxParams` (defaults to `connection.simulateTransaction`) for browsers whose RPC proxy disallows `simulateTransaction`.
- Size the merge redeem deterministically from the vault's `pt_redemption_rate` instead of reading `MergeEvent` from a flash-loan quote sim — sim logs truncate before the merge runs, and the quote sim would genuinely fail for indebted positions. The flash loan is now built once.
- Quote the CLMM `trade_pt` from the trader's PT token-balance delta (ground truth reported by bundle-sim transports), falling back to the program return blob — decoded self-validatingly, since the deployed program returns a compact 16-byte pair, not the `TradePtEvent` the committed IDL declares.
