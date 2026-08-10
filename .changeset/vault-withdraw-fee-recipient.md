---
"@0dotxyz/p0-ts-sdk": patch
---

Gamma vaults: fix `makeVaultWithdrawIx` passing the wrong `fee_recipient_account`. The vault's `fee_recipient` field is already the token account that receives fee shares (it lives on the *share* mint, as the program mints into it), but the SDK derived an associated token account from it on the *asset* mint. On any vault with a fee configured this produced an uninitialized address and every withdrawal failed Anchor account validation with `AccountNotInitialized` (3012). The account is now passed through as-is when a fee recipient is set; vaults without a fee config keep sending the previously derived placeholder, so their behaviour is unchanged.
