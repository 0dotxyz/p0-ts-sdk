---
"@0dotxyz/p0-ts-sdk": major
---

v3: the SDK runs on Solana Kit and Codama instead of web3.js and Anchor.

- `@solana/kit` is a peer dependency; public types are Kit types (`Address`, Kit instructions, signers and transaction messages). web3.js, Anchor, bn.js, borsh and Switchboard are gone.
- Every program client (marginfi, Kamino, Drift, JupLend, Gamma, Exponent, Pyth, Scope) is generated with Codama and only reachable through the SDK's own types.
- Transaction builders take one `txFormat` (`{ version: 0, luts }` or `{ version: 1 }`) instead of separate lookup tables and a version.
- The `./instructions` subpath export is removed.
- Bridged debt-swap quotes come back direct-shaped; drop any flip applied to them.
- Requires Node 20.18 or later.
