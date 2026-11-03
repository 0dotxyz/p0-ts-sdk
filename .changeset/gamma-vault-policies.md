---
"@0dotxyz/p0-ts-sdk": minor
---

Gamma vault policies: `fetchGammaDepositPolicy` / `fetchGammaWithdrawalPolicy` (and the `decodeGammaDepositPolicyData` / `decodeGammaWithdrawalPolicyData` decoders in `vendor`) read a vault's `DepositPolicy` (deposit cap `capacityAssets`, `depositsPaused`) and `WithdrawalPolicy` (`withdrawalFeeBps`, rolling hourly/daily withdrawal caps and what each window has used). Both return `null` when the vault has no policy account. Lets a caller check a deposit against the cap and quote a withdrawal net of its fee without Gamma's API.
