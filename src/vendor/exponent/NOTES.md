# Exponent vendor

Vendored (not imported) to support `makeRollPtTx` (roll a matured PT into its next
maturity). The SDK only needs Exponent's **`merge`** (redeem matured PT → SY, 1:1, no
slippage); the buy leg (SY → new PT) goes through the existing swap engine.

Everything here mirrors Exponent's own source — IDL + program accounts from
github.com/exponent-finance/exponent-core (`target/idl/exponent_core.json`, copied to
`idl/exponent_core.json`):

- **Program id** (`constants.ts`): mainnet core `XP1BRLn8…` (the program that runs the PT
  instructions on mainnet). The repo's `declare_id!` (`ExponentnaRg…`) is the **localnet**
  key — kept as `EXPONENT_LOCALNET_PROGRAM_ID` for reference.
- **`merge`** (`instructions.ts`): discriminator `[5]` + `amount: u64`, 15 accounts in the
  order/flags from the IDL and `#[derive(Accounts)] struct Merge`. Post-maturity it burns
  PT only (YT burn skipped, vault inactive) but still requires the YT accounts → the caller
  passes a valid (empty) YT ATA, which `makeRollPtTx` creates in setup.
- **Vault resolution** (`utils/deserialize.utils.ts` + `utils/resolve.utils.ts`): every
  vault-side `merge` account is a `has_one` field on the `Vault` (`authority`, `sy_program`,
  `escrow_sy`, `address_lookup_table`, `mint_yt`, `mint_pt`, `yield_position`).
  `resolveExponentMergeContext({ connection, owner, market | vault })` decodes the `Vault`
  (via Anchor's `BorshAccountsCoder` + the IDL), derives the owner's PT/YT/SY ATAs, and
  returns the `mergeAccounts`, the SY `underlying`, and a `computeRedeemedAmountNative(pt)` helper.
- **Amount sizing**: `Number` is a LE U256 scaled by 1e12 (`libraries/precise_number`, see
  `EXPONENT_NUMBER_DENOM`). Redeemed SY = `floor(ptAmount × final_sy_exchange_rate)`,
  assuming PT and SY share decimals (true for Exponent vaults).

## Validation status
- ✅ **Resolver validated against mainnet** (PT-bulkSOL market `7rRzQ…`): `BorshAccountsCoder`
  decodes `MarketTwo`→`Vault` cleanly, and `mergeAccounts.mintPt` came back as the exact
  PT-bulkSOL mint — confirming account resolution + that `PT_TOKEN_MARKETS` values are the
  on-chain `MarketTwo` addresses.
- ✅ **Redemption math fixed via on-chain source.** `merge` computes
  `amount_sy_out = floor(amount_py × pt_redemption_rate)` where
  `pt_redemption_rate = sy_for_pt / pt_supply` (`Vault::pt_redemption_rate`) — NOT
  `final_sy_exchange_rate`. `computeRedeemedAmountNative` now matches (validated: 1 PT →
  0.9195 SY on the live vault).
- ⏳ **Remaining**: the `merge` instruction *execution* (1-byte disc `[5]` + account order)
  is taken from the IDL but not yet exercised — it'll be confirmed the first time a real
  roll simulates against a matured PT + successor bank.
