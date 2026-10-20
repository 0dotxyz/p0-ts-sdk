# Exponent vendor

Vendored (not imported — **no `@exponent-labs/exponent-sdk` dependency**) to support
`makeRollPtTx`: roll a matured PT into its next maturity so the user's **full deposit ends up
as new PT** (no leftover), in one flash-loan-wrapped bundle:

```
withdraw PT_old → merge (PT_old → SY) → CLMM trade_pt (SY → PT_new) → deposit PT_new
```

The matured PT is redeemed 1:1 to its **SY**, then the successor PT is bought **directly on its
CLMM (`MarketThree`) PT/SY pool** — no base-token round-trip and no external aggregator. The
caller passes the matured Exponent market/vault + the successor CLMM pool (`rollOpts`); everything
Exponent is resolved internally. The buy is bounded by the successor pool's depth.

> **Why direct on the CLMM (not via Titan/base):** the SY mint (e.g. wrapped bulkSOL,
> `Fy7Si…`) is shared across maturities and is exactly the CLMM pool's quote token, so the
> redeemed SY feeds the buy directly. The newer maturities (e.g. October bulkSOL, `HgyW…`) list
> **only** a CLMM pool — there is **no `MarketTwo`** (scanned all core MarketTwo accounts) and
> **no order book** for them — so `trade_pt`-on-MarketTwo and order-book routes don't apply.
> External aggregators (Titan) won't quote SY as an *input* token (it's a protocol-internal
> wrapper), so the old roll redeemed SY→base and let Titan route base→SY→PT — a redundant
> `SY→base→SY` round-trip whose extra accounts pushed the flash loan toward the 64-lock ceiling
> (~600 PT cap). Going direct removes the round-trip and the aggregator: the CLMM swap is a
> **fixed, compact account set** (single `ticks` account, no Raydium-style per-tick-array
> accounts), so the cap is now bounded by pool liquidity/slippage, not account locks (a full
> roll of a previously-too-big, underwater position now fits and heals — measured ~43/64 locks).
> Only `merge` + CLMM `trade_pt` are wrapped here. The generated clients (`src/generated/exponent-core`,
> `src/generated/exponent-clmm`) still expose `strip`, MarketTwo `trade_pt` and `wrapper_merge` if a
> future route needs them; the earlier hand-written versions were dropped in the Kit migration.

Clients are Codama-generated from Exponent's IDLs — core from
github.com/exponent-finance/exponent-core (`idls/exponent_core.json`) and CLMM from
`@exponent-labs/exponent-clmm-idl` (`idls/exponent_clmm.json`). The IDLs predate Anchor's event-CPI
annotations, so `instructions.ts` derives `event_authority` and passes the program account itself.

- **Program ids**: mainnet **core** is `ExponentnaRg…` (owns `Vault`/`MarketTwo`; runs `merge`).
  **CLMM** ("MarketThree") is `XPC1MM…` (owns the PT/SY pools; runs the CLMM `trade_pt`). The SY
  program (`XP1BRLn8…` generic flavor for bulkSOL) is carried per vault/pool as `sy_program`.

- **CLMM `trade_pt`** (`makeExponentClmmTradePtIx`, the roll's buy leg): `amount_in: u64` +
  `swap_direction` (`SyToPt`) + `amount_out_constraint: Option<u64>` (min PT out) +
  `price_spot_limit: Option<f64>` (unset). 14 fixed accounts, then the deduplicated SY CPI accounts
  (`get_sy_state ++ get_position_state ++ deposit_sy ++ withdraw_sy`) from
  `resolveExponentClmmTradePtContext({ rpc, owner, market })`, which reads the `MarketThree` pool and
  resolves each `CpiInterfaceContext` (an `alt_index`) against the pool's lookup table.

- **`merge`** (`makeExponentMergeIx`, the roll's redeem leg): redeem PT → SY (15 fixed accounts +
  `get_sy_state ++ withdraw_sy`). `resolveExponentMergeContext` exposes `mergeInput`, the SY
  `underlying`, and `computeRedeemedAmountNative` (an *estimate*; the roll reads the **exact** SY out
  from the on-chain `MergeEvent.amount_sy_out`, see below).

- **`PreciseNumber`** (renamed from the IDL's `Number`): a LE U256 scaled by 1e12
  (`exponentNumberToBigNumber`). CPI contexts' `is_signer` is dropped when resolving (the inner SY CPI
  signs via PDA seeds, never the transaction).

## Sizing the roll (no tick-math port, no aggregator quote)
`makeRollPtTx` quotes both legs by **simulating** (no tick-math port), then sizes the deposit to
the guaranteed minimum out:
- **exact SY** from `merge` = `MergeEvent.amount_sy_out` (u64 @ offset 296), read from a flash-loan
  sim of `[setup, withdraw, merge]` (the sim omits the deposit so its end-of-loan health check
  "fails" — but `merge` runs and `set_return_data` first, so the value is in the logs). The buy
  spends this SY *in full* (not a rate estimate), so there's no SY dust and no over-spend
  (`Custom:1` = SPL "insufficient funds"). The merge requires the owner's **YT ATA** to exist (a
  fixed account, validated as initialized even post-maturity when no YT moves) — so setup creates it.
- **exact PT** from the buy = `TradePtEvent.amount_out` (u64 @ offset 138), read from a **standalone**
  `trade_pt` sim against the largest existing SY holder (a CLMM swap is trader-independent, so the
  output for a given input + pool state is identical). This is a short, *succeeding* sim, so its
  `returnData` is reliable — unlike the redeem+trade flash-loan sim, whose logs can truncate (the
  CLMM swap + the 4 ATA-create setups overflow the ~10 KB log budget and cut the trade return).
  `min_pt_amount = out · (1 − slippageBps/1e4)`, and the deposit is sized to that floor.

## Validation status
- ✅ **CLMM `trade_pt` matches the SDK builder** (`createTradePtInstruction`, disc `0x03`, 14
  fixed accounts, `amount_in/swap_direction/amount_out_constraint/price_spot_limit` codec) and
  **executes on mainnet**: a real SY→PT swap on the bulkSOL HgyW pool simulates `err: null`
  (23 accounts; SY Deposit + CLMM swap CPIs succeed).
- ✅ **`MarketThree` decode** validated on the real HgyW pool (mints, escrows, fee treasuries,
  ticks, ALT, syProgram, and the SY-CPI account lists all resolve; 23-account swap footprint).
- ✅ **Full roll** (`examples/15-roll-pt.ts`) simulates `err: null` across the whole bundle
  (setup + crank + flash loan) on mainnet for a real matured-PT holder — full deposit lands as
  new PT collateral, **no YT byproduct**; ~43/64 account locks, ~1060/1232 bytes (a full roll of
  a previously-underwater position that couldn't fit the Titan route now fits and heals).
- ✅ **`merge` / CLMM `trade_pt` wire format** reproduced byte-for-byte from the pre-Kit builders
  (`tests/vendor/exponent/roll-legs.test.ts`); the roll bundle (order, deposit byte-patch, two-sim
  quote, LUTs) in `tests/services/account/actions/roll-pt.test.ts`.
