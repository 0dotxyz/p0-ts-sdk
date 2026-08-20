---
"@0dotxyz/p0-ts-sdk": patch
---

feat: venue-liquidity clamp on max withdraw

- New `computeVenueAvailableLiquidity(bank, venueStates?)`: idle liquidity of the external venue backing an integrated bank (Kamino reserve `liquidity.availableAmount`, Drift spot-market deposits − borrows, JupLend supply − borrow buckets at exchange prices), in underlying UI units with a 50 bps staleness buffer (`VENUE_AVAILABLE_LIQUIDITY_BUFFER`). Returns `undefined` for banks without an external venue.
- `computeMaxWithdrawForBank` accepts `venueStates` (structurally compatible with `client.bankIntegrationMap[address]`) and clamps by the venue's idle liquidity — a fully utilized venue reserve now correctly reports 0 withdrawable. `MarginfiAccountWrapper.computeMaxWithdrawForBank` auto-injects it from the client. `ignoreBankLimits` also skips this clamp.
