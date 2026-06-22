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

## Worth a quick on-chain sanity check (not blockers)
- That Anchor 0.30's `BorshAccountsCoder` decodes this 0.31-generated IDL's `Vault`
  cleanly (custom types: `Number`, `CpiAccounts`, `EmissionInfo`, …) — decode one real
  vault and confirm the field values.
- That `redeemedAmountNative` matches the on-chain `MergeEvent.amount_sy_out` for a sample
  PT amount (confirms the `Number` decode + the same-decimals assumption).
