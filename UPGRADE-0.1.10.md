# Program upgrade 0.1.9 → 0.1.10

**TL;DR:** program 0.1.10 inserts required accounts into six instructions — a positional
wire break in both directions. The SDK builds 0.1.10-style and, for the three affected
instructions it actually uses, inline-removes the inserted account while the target
program still runs 0.1.9. The switch is the announced upgrade timestamp (per program id,
in [`src/dialect.ts`](src/dialect.ts)). Integrators upgrade the SDK any time **before the
flip** with zero code changes.

## ⚠️ What must be updated, and when

| When | What |
|---|---|
| **Now (timestamp is set: Tuesday 2026-08-25 17:00 CEST / 15:00 UTC / `1787670000`)** | Publish the release carrying it; integrators must be on that release before the flip. |
| **Upgrade is rescheduled** | Publish a patch release with the new timestamp; integrators must update before the originally announced time. |
| **Upgrade is final** | Delete `src/dialect.ts`, remove its `export * from "./dialect"` line in `src/index.ts`, remove the three `// TEMPORARY (0.1.10 upgrade)` inline checks in `src/instructions.ts` (grep `TEMPORARY (0.1.10`), delete this file. |

Deployments:

| | Program | Group | Status |
|---|---|---|---|
| 0.1.9 | `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` | `4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8` | mainnet prod (until upgrade) |
| 0.1.10 | `stag8sTKds2h4KzjUw3zKTsxbqvT4XKHdaR9X9E6Rct` | `FCPfpHA69EbS8f9KKSreTRkXbzFpunsKuYf5qNmnJjpo` | staging (since 2026-08-03), mainnet after upgrade |

---

## 1. What changed in the program (0.1.9 → 0.1.10)

### Account resizes

| Account | Size (excl. 8-byte discriminator) | Detail |
|---|---|---|
| `MarginfiGroup` | 1,056 → **9,248** | +8,192B reserved padding; old mid-struct padding repurposed into `same_asset_emode_init/maint_leverage` (u32×2) |
| `FeeState` | 256 → **512** | +256B reserved; new `account_transfer_fee: u32` carved from an old placeholder (0 ⇒ legacy default) |

Both new layouts are **byte-identical prefixes** of the old ones. The upgraded program
cannot load unresized accounts, so the mainnet deploy includes a short outage while the
new resize instructions run. `Bank` was NOT resized — new fields consumed existing padding.

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
by position. Inserting a required account mid-list shifts every later index — that's why
the six instructions above are a hard wire break in BOTH directions. Everything else
survives. All cells verified against the live deployed programs:

| Operation | 0.1.9 IDL → 0.1.10 program | 0.1.10 IDL → 0.1.9 program |
|---|---|---|
| **Decode any account** (group, bank, account, FeeState) | ✅ layouts are prefix-identical | ✅ verified live, incl. 264B FeeState and 1,064B group |
| **Decode a `CircuitBroken` bank** | ❌ **crashes** — unknown enum variant (can only occur on 0.1.10) | ✅ |
| **gPA / memcmp discovery** (account@8, bank@41) | ✅ prefix-stable | ✅ |
| deposit / withdraw / borrow / repay / account create·close | ✅ unchanged | ✅ unchanged |
| **end_flashloan** (all loops, repay-w/-collat, swaps) | ❌ `AccountNotEnoughKeys: group` | ❌ `group` lands in the `authority` signer slot |
| **pulse_health** | ❌ `AccountNotEnoughKeys: group` | ❌ misaligns the trailing bank/oracle list |
| **transfer_to_new_account(_pda)** | ❌ missing `fee_state` | ❌ `fee_state` lands in the `system_program` slot |
| **start/end_liquidation** | ❌ missing `group` | ❌ shifted accounts |
| **admin ixs with appended `Option` args** | ⚠️ shorter args → new program reads garbage for the new options — don't send old-IDL admin ixs to 0.1.10 | ✅ **verified**: 0.1.9 tolerates the trailing bytes |

---

## 3. The workaround

Deliberately minimal — one constants file plus three inline checks:

- **[`src/dialect.ts`](src/dialect.ts)** (~35 lines): `MARGINFI_V0_1_10_ACTIVATION`
  (program id → unix activation time; staging `0`, mainnet `1787670000` = 2026-08-25 17:00 CEST) and
  `isMarginfiV0110Live(programId)`. A synchronous clock check — no RPC, no caching, no
  IDL juggling.
- **Three inline checks in `instructions.ts`** — the only changed instructions the SDK
  executes or simulates: `makeEndFlashLoanIx` (executed: every loop / repay-with-collat /
  swap), `makeAccountTransferToNewAccountIx` (executed: account transfer), and
  `makePulseHealthIx` (embedded in `simulateBundle` health simulations). Each builds
  0.1.10-style and, when the target program is pre-flip, removes the inserted account
  (`ix.keys.splice(...)` at its known index — we bundle the IDL, so positions are fixed).
  Marked `// TEMPORARY (0.1.10 upgrade)`.

Deliberately **not** handled:

- **Sync builders** (`sync-instructions.ts`) — simulation-only disclaimer; used solely for
  transaction **size estimation** (every `isSync: true` lives in
  `flashloan-size.utils.ts`; output is never sent or simulated). They always emit the
  0.1.10 layout: pre-upgrade that overestimates a legacy tx by ~34 bytes — conservative,
  harmless.
- **Admin instructions** — appended `Option` args are tolerated by 0.1.9 (verified), so
  new-IDL encodings work against both programs.
- **`start/end_liquidation`, `transfer_to_new_account_pda`** — no SDK builders exist.
- **Direct `program.methods.<oneOfTheSix>()` calls** bypassing the SDK builders —
  uninterceptable; fails cleanly on-chain, same as without this layer.

### For integrators

Upgrade the SDK any time **before the announced flip**; it speaks 0.1.9 to mainnet until
the timestamp and 0.1.10 after. Be on the release that carries the announced timestamp.
Reads never break in any combination. The timestamp encodes the plan, not the chain: if
the date moves, a patch release carries the new one — update before the originally
announced time.

---

## 4. Verification evidence (all against live mainnet)

- **Binary diff of deployed programs**: prod (2026-07-14) has none of the 0.1.10 marker
  strings; staging (2026-08-03) has all of them.
- **Positional break live**: old-style `pulse_health` on staging fails
  `AnchorError caused by account: group. AccountNotEnoughKeys`; new-style succeeds.
- **Inline check verified**: Programs built from the static `MARGINFI_IDL` against both
  chains → prod emits `[account]` (spliced), staging `[account, group]`; simulation
  SUCCESS on both.
- **Trailing-arg tolerance**: `configure_bank` with 16- vs 26-field `BankConfigOpt`
  encodings → identical account-validation error on prod (arg deserialization succeeded).
- **Cross-IDL decode**: group (1,064B / 9,256B) and FeeState (264B) decode correctly under
  the 0.1.10 IDL.
