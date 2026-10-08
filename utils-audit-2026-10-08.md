# Utils audit vs marginfi 0.1.12 (2026-10-08)

The Kit branch's utils (`src/services/{account,bank,price,group}/utils`, `src/utils`, `src/services/native-stake/utils`) compared with the program source in `marginfi-v2-0112` (0.1.12, mainnet upgrade 2026-10-12). Program paths are relative to `programs/marginfi/src` unless they start with `type-crate/`.

- **Verified**: re-checked against the program code by hand.
- **Agent**: found by a subagent and not re-checked line by line.

Most of this code was ported from main, so main very likely has the same bugs.

## Bugs (verified)

### Failing transactions / overstated amounts

- [ ] **1. A full debt swap never sends `repay_all`.** Fix before 2026-10-12.
  - **SDK:** `src/services/account/actions/swap-debt.ts:252` calls `isWholePosition({ isLending: false })`, which compares against `ceil(total, decimals)` (`src/services/account/utils/balance.utils.ts:93-114`). An unrounded debt (shares × share value) is almost never ≥ its ceiling, so it sends a partial repay of `floor(total)` native.
  - **Program:** `instructions/marginfi_account/repay.rs:97-111` (new in 0.1.12) requires the remaining liability shares to be 0 or ≥ 1, otherwise `IllegalBalanceState`.
  - **Effect:** a full debt swap reverts once 0.1.12 is live, or leaves dust debt. Repay-with-collateral (`repay.ts:372`) passes `isLending: true` (floor), so it works.
  - **Fix:** decide `repayAll` by comparing against the floored total, or send `repayAll` whenever `amountToRepay` is the full position.

- [ ] **2. Emode is reconciled per liability tag; the program does it per liability bank.**
  - **SDK:** `src/services/account/utils/emode.utils.ts:160-196` only requires each liability *tag* to be covered by some pair. `getEmodePairs` (`:25`) also drops liability banks whose own tag is UNSET.
  - **Program:** `type-crate/src/types/emode.rs:264-332` (`reconcile_emode_configs`) applies emode to a collateral tag only if *every* liability bank's own config has an entry for it, at the lowest weight across those configs. The liability bank's own tag doesn't matter (`state/marginfi_account.rs:877-925`).
  - **Effect:** if USDC and USDT share a tag but only USDC has a SOL entry, the SDK grants SOL emode and the program grants none. Health, max withdraw and liquidation price are overstated.
  - **Also:** `emode.utils.ts:241-261, 296-303`. Borrowing a bank whose tag is already in use is forced to `ExtendEmode`, and `diffState` compares only the global minimum weight. `max-amounts.utils.ts:184-198` then trusts the pre-borrow cache even when one collateral's weight drops, so max borrow is overstated.
  - **Fix:** reconcile per liability bank (an intersection of entries, minimum weight), and compare per-collateral weights before and after the action.

- [ ] **3. Max borrow counts an existing deposit in the same bank.**
  - **SDK:** `src/services/account/utils/max-amounts.utils.ts:203-240`: the first term assumes the borrow draws down the deposit.
  - **Program:** `state/marginfi_account.rs:2782-2789`: `BorrowOnly` rejects any asset decrease (6021 `OperationBorrowOnly`).
  - **Effect:** with 10 SOL deposited, max SOL borrow shows 10 + X, but every borrow fails. The right answer is 0.

- [ ] **4. Max withdraw can exceed the balance for collateral with initial weight 0.**
  - **SDK:** `max-amounts.utils.ts:568-583`, the "retired" branch (ReduceOnly, Kamino emergency, retired banks) returns `maintUntied / (priceLow × maintWeight)` with no clamp.
  - **Program:** the asset is worth 0 for Initial (`state/marginfi_account.rs:533, 1903`), and a withdraw only checks initial health.
  - **Effect:** 10 SOL in a ReduceOnly bank with healthy collateral elsewhere shows a max withdraw of about 80 SOL.
  - **Fix:** treat it like the isolated branch: the full balance unless free collateral is 0 and the account has debt.

- [ ] **5. Paused-bank collateral keeps its initial weight.**
  - **SDK:** `src/services/bank/utils/value.utils.ts:98-103` zeroes the initial weight only for `ReduceOnly` and `kaminoEmergency`.
  - **Program:** `state/marginfi_account.rs:528-538, 1897-1918` zeroes it for `Paused | ReduceOnly`.

- [ ] **6. Mixing staked and default-like positions isn't checked.**
  - **SDK:** `computeMaxBorrowForBank` and `computeMaxDepositForBank` do no asset-tag check.
  - **Program:** `type-crate/src/types/mod.rs:92-132` (`validate_asset_tags`), called from `borrow.rs:92` and `deposit.rs:61`. Staked positions can't be combined with default-like ones (DEFAULT, Kamino, Drift, Solend, JupLend); SOL-tag banks combine with either.
  - **Effect:** a staked-only account asking for max USDC borrow gets an amount; the borrow fails with 6047 `AssetTagMismatch`.

- [ ] **7. Bridged debt swaps and loops repay any existing bridge debt in full.**
  - **SDK:** `src/services/account/actions/swap-debt.ts` and `loop.ts` close legs set `totalPositionAmount` to the bridge just borrowed, so `repayAll` is true. The borrow-side conflict check in `bridge-swap.ts` only rejects a bridge the account *deposits*.
  - **Program:** `repay_all` repays the whole balance, including debt that was already there (`state/marginfi_account.rs:2429-2503`).
  - **Effect:** with 500 USDC of existing debt and USDC as the bridge, the close leg repays 1500 USDC with about 1000 from the swap. It fails, or pulls 500 from the wallet.
  - **Fix:** size the close leg from the projected bridge balance (partial repay of just the bridged amount), or treat existing bridge debt as a conflict.

- [ ] **8. The projection closes balances differently from the program.**
  - **SDK:** `src/services/account/utils/transaction-projection.utils.ts:407-411, 434-438, 468-472, 495-499`, in `computeProjectedActiveBalancesNoCpi`:
    - It closes a balance after a partial repay or withdraw that reaches 0 shares.
    - It keeps a withdraw-all or repay-all balance open when the other side has dust.
  - **Program:** partial repays and withdraws never close a balance. `withdraw_all` and `repay_all` always close it, writing off dust below `ZERO_AMOUNT_THRESHOLD` (`state/marginfi_account.rs:2344-2354, 2398-2421, 2462-2499`).
  - **Effect:** the bridged close leg is built against this projection, so its health pack includes or misses banks, giving `InvalidBankAccount`. `computeProjectedActiveBanksNoCpi` already matches the program; follow it.

- [ ] **9. Staked banks with an empty `oracleKeys[3]` get a four-account health entry.**
  - **SDK:** `transaction-projection.utils.ts:81-90` only adds the on-ramp when `oracleKeys[3]` is set.
  - **Program:** `state/marginfi_account.rs:77-84` always walks 5 accounts for STAKED, and `state/lst_stake_price.rs:29-40` derives the on-ramp from `integration_acc_1` when slot 3 is empty.
  - **Effect:** any health pack containing such a bank misaligns (`WrongNumberOfOracleAccounts` / `InvalidBankAccount`). Exposure depends on whether any live staked bank was never backfilled.
  - **Fix:** derive the on-ramp from the vote account the same way (`type-crate/src/pdas.rs:40`).

### Wrong values

- [ ] **10. The staked-collateral multiplier matches neither program formula.**
  - **SDK:** `src/services/native-stake/utils/multiplier.utils.ts:29-33` computes `(stake.lamports − 1 SOL) / supply`. The staked-oracle flags (bits 9 and 10) are decoded but unused.
  - **Program:** `state/price.rs:482-509`, `state/lst_stake_price.rs:42-76`:
    - On-ramp enabled: `(stake − rent + onramp − rent) / (supply + phantom)`.
    - Pre-transition: `(delegation.stake − 1 SOL) / supply`.
    - Disabled: `StakeOraclesDisabled` (the bank can't be priced).
  - **Effect:** on-ramp banks are about 1% low, pre-transition banks slightly high, and disabled banks still show full value.

- [ ] **11. The liquidation price double-counts confidence and ignores the multiplier.**
  - **SDK:** `src/services/account/utils/account-metrics.utils.ts:218-265` subtracts the unbiased bank value (`computeBalanceUsdValue`, `PriceBias.None`) from the biased cache, then adds the confidence band again. It divides by `computeQuantityUi` without `assetShareValueMultiplier`.
  - **Fix:** subtract the biased value (`getBalanceUsdValueWithPriceBias`) and pass the multiplier.

- [ ] **12. A balance with no bank or price drops out of health.**
  - **SDK:** `src/services/account/utils/health.utils.ts:270-284` skips it with a `console.warn`. A liability with a missing price simply disappears from debt, overstating free collateral and max borrow.
  - **Program:** a liability oracle error fails the whole health check (`state/marginfi_account.rs:2025-2040`).

- [ ] **13. The per-bank `oracle_max_confidence` rejection isn't modeled.**
  - **SDK:** `src/services/price/utils/pyth-data.utils.ts:197-219` only caps the band at 5%.
  - **Program:** `state/price.rs:2483-2540` errors with `OracleMaxConfidenceExceeded` when `2.12 × conf` exceeds the bank's limit (10% when unset), before the 5% cap.
  - **Effect:** the SDK shows a usable price; the action fails on-chain.

## Risks (agent)

- [ ] **Repay-all sizing ignores accrual since the bank's last update.** `src/services/bank/utils/shares.utils.ts:48-50` and `account/utils/value.utils.ts:222-234` use the stored share value, while the program accrues first (`repay.rs:70`). The SOL repay wrap (`makeWrapSolIxs` adds a fixed 10,000 lamports) is thin on large debts. `computeAccrualProjectionSeconds` in `capacity.utils.ts` could project it.
- [ ] **The max functions ignore operational state and the circuit breaker.** Program: `utils/general.rs:261-320` (deposits and borrows fail on ReduceOnly, Paused and others; borrows also on CircuitBroken; withdraws on Paused). `isStandardBorrowable`/`isStandardDepositable` exist but aren't used there.
- [ ] **Venue caps aren't modeled:** Kamino `reserve.config.deposit_limit` and the withdrawal cap, and JupLend's withdrawal limit (`bank/utils/venue-liquidity.utils.ts`).
- [ ] **The flashloan precheck undercounts.** `flashloan-size.utils.ts:52, 170-185`: `FL_IX_OVERHEAD = 52` (begin + end is 36 + pack size), the instructions-sysvar lock is missing, and the end pack's extra keys for a new deposit bank are missing. The engine can pick a route that then fails the final size check. `SWAP_MERGE_OVERHEAD` is 150, but its comment says 200.
- [ ] **Same-asset emode isn't modeled:** the bank flag bit 12 and the group's `same_asset_emode_*_leverage` (`type-crate/src/types/bank.rs:296-313`, `state/marginfi_account.rs:928-1029`). Health is understated if the group enables it.
- [ ] **Group program fees are missing from the borrow rate.** `bank/utils/interest-rate.utils.ts:11-21` vs `state/interest_rate.rs:191-192, 297-316`. This is latent while `PROGRAM_FEES_ENABLED` is off (mainnet and staging flags are 0).
- [ ] **Unknown emode tags decode as UNSET** (`bank/utils/deserialize.utils.ts:648-677`). A new tag silently disables emode in the SDK.
- [ ] **Solend banks get a multiplier of 1** (`models/client.ts:330-331`) and there's no Solend branch in deposit/withdraw. This only matters if Solend banks go live.

## Minor (agent)

- [ ] **The borrow projection** misses the origination fee, the premium claim before the new debt, and the reset of `lastUpdate` (`transaction-projection.utils.ts:350-381` vs `borrow.rs:117-127`).
- [ ] **Legacy rate curves** (`curveType 0`) are still priced (`interest-rate.utils.ts:128-135`); the program rejects them with `InvalidConfig`.
- [ ] **APY is capped at 300%** (`src/utils/accounting.utils.ts:23-27`), and net APY compounds the outstanding premium.
- [ ] **`computeTvl`** is wrong for isolated banks (equity weight 0) and integration banks (no multiplier) (`bank/utils/value.utils.ts:403-419`).
- [ ] **`createActiveEmodePairFromPairs`** applies one weight pair to every collateral (`emode.utils.ts:83-105`); `computeLowestEmodeWeights` is the per-bank model.
- [ ] **The isolated-tier check** counts dust (shares < 1) as debt (`max-amounts.utils.ts:159-171`). This errs on the safe side.
- [ ] **The leverage helpers** ignore the origination fee, price bias, the soft limit and ReduceOnly (`bank/utils/leverage.utils.ts`).
- [ ] **`computeBankRateLimitRemaining`** (`rate-limiter.utils.ts:77`) skips the STAKED multiplier that `computeBankOutflowRateLimit` applies.
- [ ] **`oracleMaxAge` 0** is mapped to 60 for every non-Scope setup (`bank/utils/deserialize.utils.ts:450-453`); 0.1.12 uses the raw value.
- [ ] **The emissions PDA seeds** don't match the program (`src/utils/pda.utils.ts:19-20, 121-148`). It's an unused export.
- [ ] **Stale account flags:** `isTransferAccountAuthorityEnabled` reads bit 3, now deprecated. `ACCOUNT_IN_REBALANCE` (1<<8) and the health-cache `EMODE_BOOSTED` flag are missing.
- [ ] **`chunkedGetRawMultipleAccountInfoOrdered`** drops nulls, so its output no longer lines up with the input (`src/utils/rpc.utils.ts:88-101`). It's an unused export.

## Checked and matching the program

- Price bias (Low for assets, High for liabilities), EMA for Initial and Equity, realtime for Maintenance, and Pyth confidence (2.12×, capped at 5%).
- The total-asset-value soft-limit discount, liability weights, and isolated-tier handling.
- The multipoint rate curve, the fee formula, utilization, and share conversions.
- Premium accrual and rate, and settling premium before principal.
- Rate-limiter window math and recorded amounts, the costly-position cap of 4, and the deposit/borrow caps.
- PDA seeds (vaults, fee state, accounts, orders, staked settings), account and bank layouts and filter offsets, flag bits and enums.
- Pyth, Scope, Marinade, SPL stake pool, PT and Kamino/JupLend pricing inputs.
- Health-pack ordering and per-oracle-setup account counts, the deposit-amount patch offset (8) for every deposit variant, and the flashloan `endIndex`.
