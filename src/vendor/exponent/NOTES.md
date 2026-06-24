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
> The `merge` / `strip` / `trade_pt` (MarketTwo) / `wrapper_merge` primitives remain vendored
> (below) as building blocks, but the roll uses `merge` + CLMM `trade_pt`.

Everything here mirrors Exponent's own source — the core IDL from
github.com/exponent-finance/exponent-core (`idl/exponent_core.json`) and the CLMM IDL from
`@exponent-labs/exponent-clmm-idl` (`idl/exponent_clmm.json`):

- **Program ids** (`constants.ts`): mainnet **core** is `ExponentnaRg…` (owns `Vault`/`MarketTwo`;
  runs `merge`/`strip`/`trade_pt`/`wrapper_merge`). **CLMM** ("MarketThree") is `XPC1MM…` (owns
  the PT/SY pools; runs the CLMM `trade_pt`). `XPBookg…` is the order book, `XP1BRLn8…` the
  **generic SY** program (a per-flavor SY program carried as `sy_program`; bulkSOL uses it).

- **CLMM `trade_pt`** (`instructions.ts` `makeExponentClmmTradePtIx`, the roll's buy leg):
  discriminator `[3]` + `amount_in: u64` + `swap_direction: u8` (`SyToPt = 1`) +
  `amount_out_constraint: Option<u64>` (min PT out) + `price_spot_limit: Option<f64>` (unset).
  **14 fixed accounts** (IDL order: trader, market, ticks, tokenSy/PtTrader, tokenSy/PtEscrow,
  ALT, tokenProgram, syProgram, tokenFeeTreasurySy/Pt, eventAuthority, program) then remaining
  `= uniqueRemainingAccounts([getSyState, getPositionState, depositSy, withdrawSy])`. The event
  authority is a CLMM-program PDA (`deriveExponentClmmEventAuthority`).
  `resolveExponentClmmTradePtContext({ connection, owner, market })` builds it **dep-free** by
  decoding the `MarketThree` pool (Borsh + the CLMM IDL) and resolving the SY-CPI accounts from
  the pool ALT. The buy args are `exponentClmmBuyPtArgs({ amountInSyNative, minPtOutNative })`.

- **`merge`** (`[5]`, the roll's redeem leg): redeem PT → SY only (15 fixed + `get_sy_state ++
  withdraw_sy`). `resolveExponentMergeContext` exposes `mergeAccounts`, the SY `underlying`, and
  `computeRedeemedAmountNative` (an *estimate*; the roll instead reads the **exact** SY out from
  the on-chain `MergeEvent.amount_sy_out`, see below).

- **`wrapper_merge`** (`[39]`): merge PT **and** CPI-redeem the SY into the underlying base token,
  in one ix (15-ish fixed + flavor redeem + SY-CPI + a required SPL stake-pool refresh pre-ix).
  Vendored + validated but **no longer used by the roll** (it was the base-round-trip redeem leg).
- **`strip`** (`[4]`): SY → mint PT + YT, 1:1, unbounded by AMM depth (15 fixed + `deposit_sy`).
- **`trade_pt`** (MarketTwo, `[17]`): SY ↔ PT AMM swap on a `MarketTwo` (12 fixed + SY-CPI). The
  matured (older) maturities have a MarketTwo; the successors don't — so this isn't the buy leg.
- **Decode** (`utils/deserialize.utils.ts`): `BorshAccountsCoder` + the IDLs. `Vault`/`MarketTwo`
  use the core coder; `MarketThree` (CLMM) uses the CLMM coder. `Number` is a LE U256 scaled by
  1e12 (`EXPONENT_NUMBER_DENOM`). CPI accounts are `CpiInterfaceContext`s (each an `alt_index`
  into the vault/market ALT), resolved via `resolveCpiMetas` (is_signer forced false).

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
- ✅ **`merge` / `strip` / `trade_pt` (MarketTwo) / `wrapper_merge` encodings** validated
  byte-for-byte and unit-tested in `tests/vendor/exponent/instructions.test.ts`; the roll bundle
  (order, deposit byte-patch, two-sim quote, LUTs) in `tests/services/account/actions/roll-pt.test.ts`.
