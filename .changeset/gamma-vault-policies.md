---
"@0dotxyz/p0-ts-sdk": minor
---

Gamma vault policies and share price inputs. `fetchGammaDepositPolicy` / `fetchGammaWithdrawalPolicy` (plus `decodeGammaDepositPolicy` / `decodeGammaWithdrawalPolicy` and `deriveGammaDepositPolicy` / `deriveGammaWithdrawalPolicy` in `vendor`) read a vault's `DepositPolicy` (deposit cap `capacityAssets`, `depositsPaused`) and `WithdrawalPolicy` (`withdrawalFeeBps`, rolling hourly/daily withdrawal caps and what each window has used); both return `null` when the vault has no policy account. `GammaLpVault` (what `fetchGammaLpVault` returns) now also types `nav`, `totalShares`, `navUpdatedAt`, `navMaxStaleness`, `pendingWithdrawalValue`, `performanceFeeBps`, `vaultName` and `pendingSharesAccount`, which the decoder already returned, so a caller can compute the share price (`nav / totalShares`) and check NAV staleness without Gamma's API.
