---
"@0dotxyz/p0-ts-sdk": patch
---

perf(emode): ~80-100x faster emode impact computation

Refactored `computeEmodeImpacts` and `computeActiveEmodePairs` to operate on
base58 string `Set`/`Map` lookups instead of `PublicKey.equals()` / `.toBase58()`
in hot loops, and hoisted the configured-pair index out of the per-bank/per-action
simulation loop (previously rebuilt ~800x per call). Output is byte-identical to
the previous implementation (validated by `scripts/emode-bench.ts`) and all public
signatures are unchanged, so consumers need no code changes.
