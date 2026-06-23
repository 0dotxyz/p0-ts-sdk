# Exponent vendor

Vendored (not imported — **no `@exponent-labs/exponent-sdk` dependency**) to support
`makeRollPtTx`: roll a matured PT into its next maturity so the user's **full deposit ends up
as new PT** (no leftover), in one flash-loan-wrapped bundle:

```
withdraw PT_old → wrapper_merge (PT_old → underlying base, e.g. bulkSOL)
  → swap engine (base → PT_new, Titan/Jupiter) → deposit PT_new
```

`makeRollPtTx` is structurally `makeSwapCollateralTx` with a `wrapper_merge` leg in front: the
matured PT is redeemed to a normal, swappable **base** token (never the un-swappable SY), then
the same multi-provider swap engine buys the new PT. The caller passes the matured Exponent
market/vault + the base token (`rollOpts`) and the swap config (`swapOpts`); everything Exponent
is resolved internally. The buy is **liquidity-bounded** by the new PT's market depth.

> Why redeem to base (not stay in SY): the SY token (e.g. wrapped bulkSOL, `Fy7Si…`) is
> Exponent's internal unit and isn't priced by external aggregators, so SY → PT_new can't be
> swapped. `wrapper_merge` unwraps it to the base LST, which Titan *can* route to the new PT.
> A `strip` (SY → PT + YT) buy leg avoids the swap entirely but leaves a YT byproduct, so the
> deposit isn't fully converted — wrong for a "roll my whole position" UX. The `strip` /
> `trade_pt` primitives remain vendored (below) as building blocks, but the roll uses
> `wrapper_merge` + swap.

Everything here mirrors Exponent's own source — IDL + program accounts from
github.com/exponent-finance/exponent-core (`idl/exponent_core.json`):

- **Program ids** (`constants.ts`): mainnet **core** is `ExponentnaRg…` (the `declare_id!` and
  owner of `Vault`/`MarketTwo` — verified on mainnet); `merge`/`strip`/`trade_pt`/`wrapper_merge`
  are invoked on it. `XP1BRLn8…` is the **generic SY** program (a per-flavor SY program carried
  as the `sy_program` account — bulkSOL uses it), `XPC1MM…` the CLMM, `XPBookg…` the orderbook.

- **`wrapper_merge`** (`instructions.ts`, the roll's redeem leg): discriminator `[39]` +
  `amount_py: u64` + `redeem_sy_accounts_until: u8`. Merges PT (post-maturity, 1:1) **and**
  CPIs into the flavor SY program to redeem the SY into the base token — one ix. **16 fixed
  accounts** (IDL order) then remaining `= [...flavor redeem accounts, ...vault SY-CPI accounts]`,
  with `redeem_sy_accounts_until` = the redeem-account count. `resolveExponentWrapperMergeContext
  ({ connection, owner, market | vault, baseMint })` builds it **dep-free** — every account is
  derivable from data we decode:
  - the generic SY state is `get_sy_state[0]`, the SPL stake pool is `get_sy_state[3]`;
  - the redeem accounts are `[owner(signer), syState, ATA(owner,base), ATA(syState,base),
    ATA(owner,sy), mintSy, mintBase, tokenProgram, baseTokenProgram, stakePool]`;
  - the cpi remaining are `uniqueRemainingAccounts(withdraw_sy ++ get_sy_state)` (is_signer
    forced false — the context flag marks a PDA the inner CPI signs, never a tx-level signer).
  It also returns the **stake-pool refresh** pre-ix the flavor needs (SPL Stake Pool
  `UpdateStakePoolBalance`, accounts decoded from the pool's layout + a withdraw-authority PDA),
  and `computeRedeemedBaseNative(pt)` — the SY→base unwrap is **1:1 in amount** (the SY exchange
  rate is a *valuation*, not a conversion), verified on mainnet to slightly *under*-estimate the
  real base, a safe never-short lower bound for the swap input.

- **`merge`** (`[5]`): redeem PT → SY only (15 fixed + `get_sy_state ++ withdraw_sy`). The
  primitive `wrapper_merge` extends; `resolveExponentMergeContext` exposes `mergeAccounts`, the
  SY `underlying`, and `computeRedeemedAmountNative(pt) = floor(pt × sy_for_pt / pt_supply)`.
- **`strip`** (`[4]`): SY → mint PT + YT, 1:1, unbounded by AMM depth (15 fixed + `deposit_sy`).
  `resolveExponentStripContext` + `computeStrippedPtNative(syIn) = floor(syIn × sy_exchange_rate)`.
- **`trade_pt`** (`[17]`): SY ↔ PT AMM swap on `MarketTwo` (12 fixed + SY-CPI). Buy args via
  `exponentBuyPtArgs` (`net_trader_pt = +ptOut`, `sy_constraint = -maxSyIn`).
- **Vault/market decode** (`utils/deserialize.utils.ts`): `BorshAccountsCoder` + the IDL.
  `Number` is a LE U256 scaled by 1e12 (`EXPONENT_NUMBER_DENOM`). CPI accounts are
  `CpiInterfaceContext`s (each an `alt_index` into the vault/market ALT), resolved via
  `resolveCpiMetas` (is_signer forced false).

## Validation status
- ✅ **Core program id fixed + verified** (`ExponentnaRg…` == the vault's account owner; was
  swapped with the generic-SY `XP1BRLn8…`, which would revert).
- ✅ **`wrapper_merge` matches the SDK byte-for-byte.** `resolveExponentWrapperMergeContext` +
  `makeExponentWrapperMergeIx` reproduce the official SDK's `vault.ixMergeToBase` (the
  stake-pool refresh pre-ix **and** the 35-key `wrapper_merge`) exactly, for the bulkSOL
  generic flavor — built entirely from our own decode (no SDK at runtime).
- ✅ **`wrapper_merge` executes on mainnet.** Simulating `[stake-pool refresh, wrapper_merge]`
  for a real matured-PT holder returns `err: null` and produces the base (bulkSOL) — **no YT
  byproduct**. `computeRedeemedBaseNative` is a safe lower bound for the swap input (estimate
  91,954,651 ≤ actual 92,023,734; ~0.08% dust). See `examples/17-roll-pt-redeem-proof.ts`.
- ✅ **`merge` / `strip` / `trade_pt` encodings** validated byte-for-byte against the SDK and
  unit-tested in `tests/vendor/exponent/instructions.test.ts`; the roll bundle (order, deposit
  byte-patch, LUTs) in `tests/services/account/actions/roll-pt.test.ts`.
- The **full roll** (incl. base → PT_new via the swap engine) needs Titan credentials at
  runtime (same external dep as `makeSwapCollateralTx`); run `examples/15-roll-pt.ts` with
  `TITAN_GATEWAY_URL` / `TITAN_API_KEY` set to simulate the whole bundle.
