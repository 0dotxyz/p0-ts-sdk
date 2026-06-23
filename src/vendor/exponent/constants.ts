import { PublicKey } from "@solana/web3.js";

/**
 * Exponent Finance program IDs (mainnet), taken from the official SDK's
 * `@exponent-labs/exponent-sdk` `environment.js`.
 *
 * The **core** program owns the `Vault` / `MarketTwo` accounts and runs the PT
 * instructions (`merge`, `strip`, `trade_pt`, …). It is `ExponentnaRg…` — the same key as
 * the repo's `declare_id!`. (An earlier version of this file mislabelled `declare_id!` as a
 * localnet-only key and used the **generic SY** program `XP1BRLn8…` as "core"; that is
 * wrong — `XP1BRLn8…` is one of the per-flavor SY programs, and a `merge`/`trade_pt` sent
 * to it fails because it does not own the core-owned `Vault`/`MarketTwo` accounts. Verified
 * on mainnet: vault `78MLjM…` is owned by `ExponentnaRg…`.)
 *
 * Instruction encoding/accounts come from the committed IDL (`idl/exponent_core.json`).
 */
export const EXPONENT_CORE_PROGRAM_ID = new PublicKey(
  "ExponentnaRg3CQbW6dqQNZKXp7gtZ9DGMp1cwC4HAS7"
);

/** CLMM (`MarketThree`) program — concentrated-liquidity PT/YT trading. */
export const EXPONENT_CLMM_PROGRAM_ID = new PublicKey(
  "XPC1MM4dYACDfykNuXYZ5una2DsMDWL24CrYubCvarC"
);

/** Orderbook program — limit-order PT/YT trading. */
export const EXPONENT_ORDERBOOK_PROGRAM_ID = new PublicKey(
  "XPBookgQTN2p8Yw1C2La35XkPMmZTCEYH77AdReVvK1"
);

/** Strategy-vaults program. */
export const EXPONENT_VAULTS_PROGRAM_ID = new PublicKey(
  "sVau1tXvayVWfotzm9Ahcv2qfnnfRWttt78BCnNC6dD"
);

/**
 * Per-flavor SY programs. A `Vault.sy_program` is one of these; `merge`/`trade_pt` carry it
 * as the `sy_program` account (and CPI into it to value SY). bulkSOL uses the **generic**
 * flavor (`XP1BRLn8…`).
 */
export const EXPONENT_GENERIC_SY_PROGRAM_ID = new PublicKey(
  "XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy"
);
export const EXPONENT_MARGINFI_SY_PROGRAM_ID = new PublicKey(
  "XPMfipyhcbq3DBvgvxkbZY7GekwmGNJLMD3wdiCkBc7"
);
export const EXPONENT_KAMINO_SY_PROGRAM_ID = new PublicKey(
  "XPK1ndTK1xrgRg99ifvdPP1exrx8D1mRXTuxBkkroCx"
);
export const EXPONENT_JITO_RESTAKING_SY_PROGRAM_ID = new PublicKey(
  "XPJitopeUEhMZVF72CvswnwrS2U2akQvk5s26aEfWv2"
);
export const EXPONENT_PERENA_SY_PROGRAM_ID = new PublicKey(
  "XPerenaJPyvnjseLCn7rgzxFEum6zX1k89C13SPTyGZ"
);

/** Anchor event-CPI authority seed. */
export const EXPONENT_EVENT_AUTHORITY_SEED = "__event_authority";
