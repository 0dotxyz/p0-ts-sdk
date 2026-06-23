# Exponent vendor

Vendored (not imported) to support `makeRollPtTx` (roll a matured PT into its next
maturity), **entirely within Exponent — no unwrap, no external aggregator**:

```
withdraw PT_old → merge (PT_old → SY, 1:1) → buy (SY → PT_new) → deposit PT_new
```

SY is Exponent's internal unit of account and is **maturity-independent** (the same SY
mint backs every maturity of an underlying), so the SY the `merge` yields is exactly the
SY the successor market trades — the new PT is bought directly with it. The matured side
redeems 1:1 via **`merge`**; the buy leg is venue-agnostic and pays the successor market's
PT pricing.

`makeRollPtTx` is high-level: the caller passes the matured + successor markets via `rollOpts`
and it resolves the `merge` and builds the `strip` buy leg internally (like `makeLoopTx`
internalizes the swap engine). A `rollOpts.buy` escape hatch injects a non-strip buy leg. All
buy legs are **vendored — no `@exponent-labs/exponent-sdk` dependency**:
- **`strip`** (recommended): `resolveExponentStripContext` + `makeExponentStripIx` **mint**
  PT_new (+ YT_new) from SY, 1:1, unbounded by AMM depth — the only way to roll a full
  leveraged position whose successor market has thin liquidity. The validated end-to-end
  roll uses this.
- **legacy `MarketTwo` `trade_pt`**: `resolveExponentTradePtContext` + `makeExponentTradePtIx`
  (AMM swap, pool-depth-bounded).
- **CLMM (`MarketThree`) / orderbook**: not vendored (tick-based pricing); build with the
  official SDK if you need them — but `strip` supersedes them for rolls.

> The earlier design unwrapped SY → base via the SY-program flavor CPI (`wrapper_merge` /
> `ixRedeemSy`) and routed base → PT through Titan/Jupiter. That was dropped: the SY token
> (e.g. wrapped bulkSOL) isn't priced by the external aggregators, and Exponent's own
> venues already trade SY ↔ PT, so the unwrap + external swap is unnecessary.

Everything here mirrors Exponent's own source — IDL + program accounts from
github.com/exponent-finance/exponent-core (`target/idl/exponent_core.json`, copied to
`idl/exponent_core.json`):

- **Program ids** (`constants.ts`): mainnet **core** is `ExponentnaRg…` (= the repo's
  `declare_id!`, and the owner of the `Vault`/`MarketTwo` accounts — verified on mainnet).
  `merge`/`trade_pt` are invoked on it. `XP1BRLn8…` is the **generic SY** program (one of
  the per-flavor SY programs, carried as the `sy_program` account — bulkSOL uses it); it is
  **not** core. `XPC1MM…` is the **CLMM** program, `XPBookg…` the **orderbook**.
  > A prior version had these swapped (core ⇄ generic-SY) and dismissed `ExponentnaRg…` as
  > localnet-only. That misrouted `merge` to `XP1BRLn8…`, which fails since it doesn't own
  > the core `Vault`. Fixed; see the SDK's `environment.js` for the authoritative mapping.
- **`merge`** (`instructions.ts`): discriminator `[5]` + `amount: u64`, **15 fixed accounts
  + SY-program CPI remaining accounts** (`get_sy_state ++ withdraw_sy`). The fixed account
  order/flags match the codama `createMergeInstruction` (verified byte-for-byte against the
  SDK). Post-maturity it burns PT only (YT burn skipped, vault inactive) but still requires
  the YT accounts → the caller passes a valid (empty) YT ATA, which `makeRollPtTx` creates
  in setup. The remaining accounts are resolved from the **vault's** ALT (each is a
  `CpiInterfaceContext` = `alt_index`), and their `is_signer` is forced **false** — the
  context flag marks a PDA the inner SY CPI signs, never a tx-level signer.
- **Vault resolution** (`utils/deserialize.utils.ts` + `utils/resolve.utils.ts`): every
  vault-side `merge` account is a `has_one` field on the `Vault` (`authority`, `sy_program`,
  `escrow_sy`, `address_lookup_table`, `mint_yt`, `mint_pt`, `yield_position`).
  `resolveExponentMergeContext({ connection, owner, market | vault })` decodes the `Vault`
  (via Anchor's `BorshAccountsCoder` + the IDL), derives the owner's PT/YT/SY ATAs, and
  returns the `mergeAccounts`, the SY `underlying`, and a `computeRedeemedAmountNative(pt)` helper.
- **Amount sizing**: `Number` is a LE U256 scaled by 1e12 (`libraries/precise_number`, see
  `EXPONENT_NUMBER_DENOM`). Redeemed SY = `floor(ptAmount × final_sy_exchange_rate)`,
  assuming PT and SY share decimals (true for Exponent vaults).
- **`strip`** (`instructions.ts`): discriminator `[4]` + `amount: u64`, **15 fixed accounts +
  `deposit_sy` CPI remaining accounts** (the inverse of merge — SY in, mints PT + YT). Account
  order matches the SDK `createStripInstruction` (verified byte-for-byte).
  `resolveExponentStripContext({ connection, owner, vault | market })` decodes the (active)
  vault, derives the owner's SY/PT/YT ATAs, resolves the `deposit_sy` remaining accounts from
  the vault ALT (`is_signer` forced false), and exposes `computeStrippedPtNative(syIn) =
  floor(syIn × last_seen_sy_exchange_rate)` for sizing the deposit (strip a hair under the
  merged SY so merge rounding never leaves it short).
- **`trade_pt`** (`instructions.ts`): discriminator `[17]` + `net_trader_pt: i64` +
  `sy_constraint: i64`, 12 fixed accounts (order/flags from the IDL / SDK
  `createTradePtInstruction`) **plus** the SY-program CPI remaining accounts. Buying PT is
  signed from the trader's view: `net_trader_pt = +ptOut`, `sy_constraint = -maxSyIn`
  (`exponentBuyPtArgs`). The trade fills exactly `net_trader_pt` PT and spends ≤ `|sy_constraint|`
  SY (dust SY stays in the SY account), so `ptOut` should be a conservative floor.
- **`MarketTwo` resolution** (`utils/deserialize.utils.ts` + `utils/resolve.utils.ts`):
  `resolveExponentTradePtContext({ connection, owner, market })` decodes the successor
  `MarketTwo` (escrows, `token_fee_treasury_sy`, `sy_program`, `address_lookup_table`,
  mints, `cpi_accounts`) and returns the `trade_pt` accounts + the market ALT to carry on
  the tx. The SY-CPI remaining accounts (`get_sy_state` ++ `deposit_sy` ++ `withdraw_sy`)
  are `CpiInterfaceContext`s — each an **ALT index** (`alt_index`), not an inline pubkey —
  resolved against the market's address lookup table (`is_signer` forced false, as for merge).
  The caller is responsible for the maturity-independent-SY invariant: the buy leg must spend
  from `mergeAccounts.sySrcDstAta` (the SY the merge writes).

## Validation status
- ✅ **Resolver validated against mainnet** (PT-bulkSOL markets `7rRzQ…` / `scSc4o…`):
  `BorshAccountsCoder` decodes `MarketTwo`→`Vault` cleanly, and `mergeAccounts.mintPt` came
  back as the exact PT-bulkSOL mint — confirming account resolution + that the `PT_TOKEN_MARKETS`
  values are on-chain `MarketTwo` addresses.
- ✅ **Core program id fixed + verified.** Building the `merge` ix for matured market
  `scSc4o…` now yields `programId == ExponentnaRg… == the vault's account owner` (was
  `XP1BRLn8…`, a mismatch that would revert). The event-authority PDA derives from the
  corrected core id.
- ✅ **Redemption math fixed via on-chain source.** `merge` computes
  `amount_sy_out = floor(amount_py × pt_redemption_rate)` where
  `pt_redemption_rate = sy_for_pt / pt_supply` (`Vault::pt_redemption_rate`) — NOT
  `final_sy_exchange_rate`. `computeRedeemedAmountNative` now matches (validated: 1 PT →
  0.9195 SY on the live vault).
- ✅ **`merge` execution simulated on mainnet.** Against matured market `scSc4o…`, `merge`
  runs on the core program and **succeeds** once the SY-CPI remaining accounts are included
  (it returns 0xbc4/`MissingAccount` without them) — the vendored ix matches the SDK's
  `vault.ixMerge` byte-for-byte (28 keys, 1 signer).
- ✅ **End-to-end roll simulated on mainnet (two buy-leg venues).**
  - **CLMM `trade_pt`** (SY → PT_new on the AMM): passes as a `simulateBundle` on a healthy
    matured-PT account. AMM-bounded by pool depth. See `examples/16-roll-pt-simulate.ts`.
  - **`strip`** (SY → PT_new + YT_new, *minted* 1:1, **not** AMM-bounded): rolls the **full**
    position of a leveraged, "underwater-on-paper" account (matured bank `ReduceOnly`,
    weight 0) and **clears the end-flashloan init-health check** — i.e. converts the
    zero-weight matured PT into eMode-weighted new PT and restores the account above water.
    See `examples/17-roll-pt-strip-simulate.ts`.
- **Strip-roll transaction size.** A strip roll carries two SY-program CPI account sets
  (merge + strip) and overflows a single legacy tx; a dedicated **PT-roll address lookup
  table** (Exponent programs + both vaults' merge/strip accounts + SPL programs + the PT
  banks/mints) compresses it back under the limit. Build/create one with
  `examples/create-pt-roll-lut.ts`. Strip a hair under the merged SY (`syIn × 0.99999`) so
  on-chain merge rounding never leaves the strip short (SPL `InsufficientFunds`).
- Encoding/wiring are also locked down offline in `tests/vendor/exponent/trade-pt.test.ts`
  and `tests/services/account/actions/roll-pt.test.ts`.
