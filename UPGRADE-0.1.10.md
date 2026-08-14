# Program upgrade 0.1.9 → 0.1.10 — what breaks, and how this SDK handles it

**TL;DR:** program 0.1.10 changes the wire format of six instructions and grows two
accounts. Old SDK ↔ new program (and vice versa) fail on those six instructions; nothing
else breaks. This SDK release detects the deployed program version on-chain and emits the
right wire format automatically, so integrators can upgrade the SDK **whenever they want**,
before or after the program upgrade, with zero code changes.

**Status of the compatibility layer: TEMPORARY.** Remove after the mainnet upgrade is
confirmed final — see [Reverting](#reverting-after-the-mainnet-upgrade).

Deployments:

| | Program | Group | Status |
|---|---|---|---|
| 0.1.9 | `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` | `4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8` | mainnet prod (until upgrade) |
| 0.1.10 | `stag8sTKds2h4KzjUw3zKTsxbqvT4XKHdaR9X9E6Rct` | `FCPfpHA69EbS8f9KKSreTRkXbzFpunsKuYf5qNmnJjpo` | staging (deployed 2026-08-03), mainnet after upgrade |

---

## 1. What changed in the program (0.1.9 → 0.1.10)

### Account resizes

| Account | Size (excl. 8-byte discriminator) | Detail |
|---|---|---|
| `MarginfiGroup` | 1,056 → **9,248** | +8,192B reserved padding; old mid-struct padding repurposed into `same_asset_emode_init/maint_leverage` (u32×2) |
| `FeeState` | 256 → **512** | +256B reserved; new `account_transfer_fee: u32` carved from an old placeholder (0 ⇒ legacy default) |

Both new layouts are **byte-identical prefixes** of the old ones. The upgraded program
cannot load unresized accounts, so the mainnet deploy includes a short outage while the new
resize instructions run. `Bank` was NOT resized — new fields consumed existing padding.

### New features

- **Per-bank oracle circuit breaker** — config in `BankConfig` (deviation tiers, windows,
  EMA), state in `Bank` (`cb_*` fields), new `BankOperationalState::CircuitBroken` variant,
  admin instruction `lending_pool_clear_circuit_breaker`, `CIRCUIT_BREAKER_ENABLED` bank
  flag, three `CircuitBreaker*Event`s, errors 6600–6604.
- **Same-asset e-mode** — new `SameAssetEmodeRegistry` account (9,040B per group; ≤32
  mint/oracle groups, ≤128 banks), two admin instructions, group-level leverage params,
  `BANK_SAME_ASSET_EMODE_ELIGIBLE` flag. Restricted by oracle-feed-family equivalence.
- **Configurable fees** — per-liability-bank liquidation fees
  (`liquidation_liquidator_fee` / `liquidation_insurance_fee`), configurable
  account-transfer fee (`FeeState.account_transfer_fee`), optional separate `fee_payer` on
  `end_liquidation`.

### Instruction interface changes

**Accounts inserted (THE breaking change — see §2):**

| Instruction | Inserted account | Position |
|---|---|---|
| `lending_account_end_flashloan` | `group` | before `authority` (displaces the signer slot) |
| `lending_account_pulse_health` | `group` | after `marginfi_account` |
| `transfer_to_new_account` / `_pda` | `fee_state` | before `system_program` |
| `start_liquidation` | `group` | after `liquidation_record` |
| `end_liquidation` | `group` (+ optional trailing `fee_payer`) | after `liquidation_record` |

**Args appended (all trailing `Option`s — non-breaking, see §2):**
`lending_pool_configure_bank` (`BankConfigOpt` +10 fields), `marginfi_group_configure`
(+2 leverage params), `lending_pool_close_bank` (+`force_close`), `edit_global_fee_state`
(+`account_transfer_fee`).

**Added instructions:** `lending_pool_resize_group_account`, `resize_global_fee_state`,
`lending_pool_clear_circuit_breaker`, `lending_pool_init_same_asset_emode_registry`,
`lending_pool_set_bank_same_asset_emode_eligibility`.

**Removed:** `init_global_fee_state_v2`, `copy_fee_state_to_v2`, and the `FeeStateV2`
account type entirely.

**New errors:** `InvalidResize` 6513; `BankCircuitBreakerHalted` 6600,
`CircuitBreakerAdminOnly` 6601, `CircuitBreakerInvalidConfig` 6602,
`CircuitBreakerRequiresWarmCache` 6603, `CircuitBreakerPriceJump` 6604.

**Fixes in the range:** Switchboard `std_dev` → config-driven confidence intervals;
repay/withdraw-all share-dust fix; wrapped-bank withdraw rate-limit fix; circuit-breaker
frozen-interest/reset audit fixes; SVSP phantom-token accounting.

---

## 2. What breaks, per IDL × program combination

Solana instructions carry accounts as an **ordered, unnamed array**; programs match them
by position. Inserting a required account mid-list shifts every later index, and neither
side can detect or adapt — that's why the six instructions above are a hard wire break in
BOTH directions. Everything else survives. All cells below were verified against the live
deployed programs (not just source):

| Operation | 0.1.9 IDL → 0.1.10 program | 0.1.10 IDL → 0.1.9 program |
|---|---|---|
| **Decode any account** (group, bank, account, FeeState) | ✅ layouts are prefix-identical; extra bytes ignored | ✅ verified live, incl. 264B FeeState and 1,064B group under the new IDL |
| **Decode a `CircuitBroken` bank** | ❌ **crashes** — unknown enum variant (old IDL only; can only occur on 0.1.10) | ✅ (variant exists in new IDL) |
| **gPA / memcmp discovery** (account@8, bank@41) | ✅ prefix-stable | ✅ |
| deposit / withdraw / borrow / repay / account create·close | ✅ unchanged | ✅ unchanged |
| **end_flashloan** (all loops, repay-w/-collat, swaps) | ❌ `AccountNotEnoughKeys: group` | ❌ `group` lands in the `authority` signer slot → signer check fails |
| **pulse_health** | ❌ `AccountNotEnoughKeys: group` | ❌ misaligns the trailing bank/oracle list |
| **transfer_to_new_account(_pda)** | ❌ missing `fee_state` | ❌ `fee_state` lands in the `system_program` slot |
| **start/end_liquidation** | ❌ missing `group` | ❌ shifted accounts |
| **configure_bank / group_configure / close_bank / edit_global_fee_state** (appended `Option` args) | ⚠️ shorter args → new program reads garbage for the new options — don't send old-IDL admin ixs to 0.1.10 | ✅ **verified**: 0.1.9 tolerates the trailing bytes (identical account-validation error with 16- vs 26-field `BankConfigOpt`) |

So: with a fixed single IDL there is **no safe upgrade ordering** — old SDKs break the
moment mainnet upgrades, new SDKs break if deployed early. That's the problem this release
removes.

---

## 3. How this SDK works around it

Three additive pieces; consumers see none of them:

1. **Runtime legacy IDL** — `src/idl/legacy.ts`. `getMarginfiLegacyIdl()` derives the
   0.1.9 IDL from the bundled 0.1.10 one (strips the six inserted accounts + the ten
   appended `BankConfigOpt` fields; ~50 lines, no second 450KB JSON shipped). Also
   `marginfiIdlFor(version, programId)`, `detectMarginfiProgramVersion` and
   `isLegacyMarginfiProgram`.

2. **On-chain version detection** — `src/dialect.ts`. Detector: the FeeState PDA size
   (264B = 0.1.9, 520B = 0.1.10), derivable from the program id alone; cached per program
   with a 60s TTL so the mainnet flip propagates within a minute.
   `ensureMarginfiDialectProgram(program)` swaps in a (cached) Program carrying the
   matching IDL whenever the caller's carries the wrong one.

3. **Hooks in the six instructions' builders** — the only places that needed them:
   - `instructions.ts`: `makeEndFlashLoanIx` / `makePulseHealthIx` /
     `makeAccountTransferToNewAccountIx` call `ensureMarginfiDialectProgram` first.
   - `services/…/flash-loan.ts`: the async wrapper awaits exact detection and passes
     `legacyProgram` to the sync (simulation) builder — never a cold-cache guess.
   - `services/…/roll-pt.ts`: warms the cache before the synchronous size estimator.
   - `sync-instructions.ts`: the three changed builders take `opts.legacyProgram`.
   - `models/client.ts`: `initialize` detects (group size), builds the Program with the
     matching IDL, seeds the cache, exposes `client.programVersion`
     (force with `initialize(conn, config, { programVersion })`).

The invariant: **the dialect travels with the `Program` object** — and where a consumer's
Program might carry the wrong IDL, the builders correct it against the chain. Admin arg
changes need no handling (see §2: trailing Options are tolerated by 0.1.9, and the
`BankConfigOpt` strip in the legacy transform makes legacy encodings exact anyway).

### What this means for integrators

**Upgrade the SDK whenever you like.** It speaks 0.1.9 to today's mainnet and flips
automatically (per program id, within ≤60s) when the upgrade lands. No release
coordination, no env flags, no code changes. Reads never break in any combination.

### Coverage matrix — every way the SDK can be used

| Usage | Covered by |
|---|---|
| `Project0Client.initialize` + wrapper/model methods | init-time detection, Program built with matching IDL, cache seeded |
| Own `Program` from `MARGINFI_IDL` (or any variant) + services / `instructions.*` | the three builders self-correct via `ensureMarginfiDialectProgram` |
| Health-cache simulation (`simulateHealthCache`) | routes through the ensure-wrapped pulse builder |
| Flashloan flows incl. the `isSync` simulation path | async wrapper awaits exact detection |
| `makeRollPtTx` (sync size estimator inside) | cache warmed at the top of the action |
| Account transfer (`makeAccountTransferToNewAccountTx`) | ensure-wrapped builder; `feeState.fetch` decodes both sizes (verified) |
| Admin ixs (`configureBank`; direct `program.methods` for the other three) | trailing-Option args tolerated by 0.1.9 (verified) |
| All fetch/decode/gPA paths, websocket `decodeAccountRaw` | prefix-compatible layouts (verified live, both directions) |
| `start/end_liquidation`, `transfer_to_new_account_pda` | no SDK builders exist; nothing to cover |

**Known limits:**

- `program.methods.<oneOfTheSix>()` called **directly** on a wrong-IDL Program (bypassing
  every SDK builder) — uninterceptable; fails cleanly on-chain, identical to the status quo.
- The **raw sync builders** imported directly with a cold cache — pass `opts.legacyProgram`
  or `await resolveMarginfiProgramVersion(...)` first (every internal path is warmed).
- Long-lived processes across the upgrade moment: the 60s TTL covers it; re-instantiate
  clients on persistent failure as belt-and-braces. Never build 0.1.10-only admin ixs with
  the 0.1.9 IDL (the one ⚠️ cell above) — admin flows should use a current SDK.

---

## 4. Verification evidence (all against live mainnet)

- **Binary diff of deployed programs**: prod (deployed 2026-07-14) contains none of the
  0.1.10 marker strings (resize error, circuit breaker, same-asset e-mode); staging
  (2026-08-03) contains all of them.
- **Positional break demonstrated live**: old-style `pulse_health` against staging fails
  `AnchorError caused by account: group. AccountNotEnoughKeys`; new-style succeeds.
- **Auto-detect → build → simulate** `pulse_health`: SUCCESS on prod (detected 0.1.9,
  emitted `[account]`) and staging (detected 0.1.10, emitted `[account, group]`).
- **Deliberately wrong Programs in both directions** (static 0.1.10 IDL → prod; legacy IDL
  → staging): builders auto-corrected, simulation SUCCESS both times.
- **Trailing-arg tolerance**: `configure_bank` with 16- vs 26-field `BankConfigOpt`
  encodings → byte-identical `Unauthorized` account-validation error on prod (i.e. arg
  deserialization succeeded in both).
- **Cross-IDL decode**: group (1,064B and 9,256B) and FeeState (264B) decode correctly
  under both IDL variants.

---

## Reverting after the mainnet upgrade

Once mainnet runs 0.1.10 and rollback is off the table, the legacy dialect is dead code.
Everything below is deletion — no behavior changes for 0.1.10-only operation.

1. **Delete `src/dialect.ts`** and remove `export * from "./dialect"` from `src/index.ts`.
2. **Delete `src/idl/legacy.ts`** and remove its re-export block from `src/idl/index.ts`.
3. **`src/instructions.ts`**: remove the three `ensureMarginfiDialectProgram` calls (and the
   import); `makeEndFlashLoanIx` can drop its added `async` if desired.
4. **`src/services/account/actions/flash-loan.ts`**: remove the
   `resolveMarginfiProgramVersion` import and the `legacyProgram` opts argument.
5. **`src/services/account/actions/roll-pt.ts`**: remove the cache-warm line + import.
6. **`src/sync-instructions.ts`**: remove the `opts?: { legacyProgram?: boolean }` params
   and the three conditional spreads (make the 0.1.10 accounts unconditional).
7. **`src/services/account/utils/flashloan-size.utils.ts`**: remove the
   `isLegacyMarginfiDialect` import and the opts argument.
8. **`src/models/client.ts`**: optional — group-size detection becomes inert (always
   "0.1.10"). Leave it (harmless, and the pattern is reusable for the next resize-style
   upgrade) or remove detection + the `programVersion` field.

Quick audit for leftovers:
`grep -rn "dialect\|legacyProgram\|LegacyIdl\|MarginfiProgramVersion" src/`

Also delete this file once reverted. Keep the detection *pattern* in mind for the next
breaking upgrade — the same size-probe + IDL-transform approach applies to any future
account-layout change.
