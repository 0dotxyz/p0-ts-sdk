---
"@0dotxyz/p0-ts-sdk": minor
---

Support marginfi program 0.1.10 (staging: `stag8sTKds2h4KzjUw3zKTsxbqvT4XKHdaR9X9E6Rct`, group `FCPfpHA69EbS8f9KKSreTRkXbzFpunsKuYf5qNmnJjpo`).

- Bundle the 0.1.10 IDL (built from `marginfi-v2@mrgn-0.1.10-rc1`) and regenerated types; `MARGINFI_IDL` / `MarginfiIdlType` now point at 0.1.10.
- `lending_account_end_flashloan` and `lending_account_pulse_health` now require the `group` account; `transfer_to_new_account` (+ PDA variant) and `end_liquidation` now require the `fee_state` PDA. The Anchor-based builders resolve these automatically; the sync (simulation) builders take them as new required params, threaded through `makeEndFlashLoanIx` and friends.
- New `OperationalState.CircuitBroken` bank state (per-bank oracle circuit breaker) — parsed instead of throwing.
- `BankConfigOptRaw` gains the 0.1.10 liquidation-fee and circuit-breaker fields (serialized as `null` until surfaced in `BankConfigOpt`).

Breaking for callers of the sync `makeEndFlashLoanIx` / `makePulseHealthIx` / `makeAccountTransferToNewAccountIx` builders (new required accounts).

**Adaptive dual-program support** — this release works against BOTH the 0.1.9 (current mainnet) and 0.1.10 programs, so integrators can upgrade ahead of the mainnet program upgrade:

- `Project0Client.initialize` detects the deployed program version from the group account size (1,056 vs 9,248 bytes) and constructs the Anchor `Program` from the matching IDL variant; exposed as `client.programVersion`. Force with `initialize(conn, config, { programVersion })`.
- Consumers constructing their own `Program` use `detectMarginfiProgramVersion(connection, groupPk)` + `marginfiIdlFor(version, programId)` — every builder (Anchor and sync paths) then emits the right wire format automatically, since the service layer derives the dialect from the passed program's runtime IDL (`isLegacyMarginfiProgram`).
- The legacy IDL is computed at runtime from the bundled 0.1.10 IDL (`getMarginfiLegacyIdl()`, ~50-line transform) — no second 450KB JSON in the package.
- Caveat: detection is snapshot-at-construction; long-lived processes should re-instantiate the client after the mainnet upgrade window.

**Zero-config safety net**: the builders for the changed instructions (`makeEndFlashLoanIx`, `makePulseHealthIx`, `makeAccountTransferToNewAccountIx`) additionally self-correct at build time — they detect the deployed program version from the FeeState PDA size (264 vs 520 bytes; cached per program id, 60s TTL) and transparently rebuild through the matching IDL variant if the caller's `Program` carries the wrong one. Integrators who construct their `Program` straight from `MARGINFI_IDL` are therefore NOT bricked against the 0.1.9 program. The sync (simulation) builders are covered too: every internal path that reaches them runs through an async wrapper that awaits exact detection first (`makeEndFlashLoanIx` service, `makeRollPtTx` warms the cache before the sync size estimator), so no cold-cache guess is ever used internally. Direct external callers of the raw sync builders can pass `opts.legacyProgram` or pre-warm via `resolveMarginfiProgramVersion`.

Verified live against both deployed programs, including deliberately wrong `Program` constructions in both directions (auto-detect → build → simulate: success on each).
