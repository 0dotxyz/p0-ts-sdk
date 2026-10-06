---
"@0dotxyz/p0-ts-sdk": patch
---

Stop scaling a Kamino bank's rate-limit remaining capacity by the cToken exchange rate. Since program 0.1.10 the Kamino withdraw records the redeemed liquidity (underlying tokens) on the bank limiter, not the cToken amount, so max withdraw and max borrow were overstated by the exchange rate whenever the bank's hourly or daily limit was the binding clamp. Staked banks still record LST amounts and keep their LST→SOL conversion.

Add `computeBankOutflowRateLimit(bank, assetShareValueMultiplier?)`, which returns the tighter of a bank's hourly and daily outflow windows (`window`, `remaining` in underlying UI units) — the bank-level clamp the max-amount functions apply — so callers can tell users when the bank's rate limit is what caps their max.
