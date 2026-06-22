import { PublicKey } from "@solana/web3.js";

/**
 * Exponent Finance program IDs (mainnet).
 *
 * The exponent-core repo's `declare_id!` / `Anchor.toml` use
 * `ExponentnaRg3CQbW6dqQNZKXp7gtZ9DGMp1cwC4HAS7`, but that is the **localnet** key
 * (`[programs.localnet]`); the **mainnet** core deployment is
 * `XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy` (confirmed: it's the program that
 * executes the PT instructions in real mainnet transactions), fronted by the
 * wrapper/router `XPC1MM4dYACDfykNuXYZ5una2DsMDWL24CrYubCvarC`.
 *
 * The instruction encoding/accounts come straight from the committed IDL
 * (`idl/exponent_core.json`) — same source Exponent's own tooling uses.
 */
export const EXPONENT_CORE_PROGRAM_ID = new PublicKey(
  "XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy"
);

export const EXPONENT_WRAPPER_PROGRAM_ID = new PublicKey(
  "XPC1MM4dYACDfykNuXYZ5una2DsMDWL24CrYubCvarC"
);

/** The program's localnet `declare_id!` (from the exponent-core repo). */
export const EXPONENT_LOCALNET_PROGRAM_ID = new PublicKey(
  "ExponentnaRg3CQbW6dqQNZKXp7gtZ9DGMp1cwC4HAS7"
);

/** Anchor event-CPI authority seed. */
export const EXPONENT_EVENT_AUTHORITY_SEED = "__event_authority";
