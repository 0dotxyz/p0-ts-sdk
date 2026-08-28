---
"@0dotxyz/p0-ts-sdk": patch
---

Kamino: respect each reserve's on-chain `interestRateBasis` when computing rates.

- Decode `ReserveConfig.interestRateBasis` and carry it through `KaminoReserve`, `KaminoReserveJSON`, `kaminoReserveToDto` and `dtoToKaminoReserve` (missing on older DTOs → `Legacy`). New `KaminoInterestRateBasis` enum (`Legacy = 0`, `TrueApr = 1`).
- `calculateKaminoSupplyAPY`, `calculateKaminoEstimatedBorrowRate`, `calculateKaminoEstimatedSupplyRate`, `calculateSlotAdjustmentFactor` and the curve helpers now apply the slot-duration adjustment and per-slot compounding only to `Legacy` reserves; `TrueApr` reserves use wall-clock APRs compounded over `SECONDS_PER_YEAR` and ignore `recentSlotDurationMs`. Unknown basis values throw. Existing signatures are unchanged.
- New helpers: `getKaminoInterestRateBasis`, `getKaminoRateBasis`, `generateKaminoReserveCurveFromReserve`; `calculateAPYFromAPR` and `generateKaminoReserveCurve` accept an optional `periodsPerYear`.
- `DEFAULT_RECENT_SLOT_DURATION_MS` is now 350 ms (was 450), matching klend-sdk 11. This only affects `Legacy` reserves when callers omit the slot duration.
