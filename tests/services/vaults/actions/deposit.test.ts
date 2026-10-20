import { address, createNoopSigner } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { toVaultWire, vaultsRpc } from "../../../helpers/vaults";

import { makeVaultDepositIx } from "~/services/vaults";

// A live USDC Gamma v2 vault and a variant of it with wSOL assets, and their asset mints. Snapshots
// were checked against v2.8.4's builders.
const USDC_VAULT = address("2cGosKLVJug5MRzQ46Ud5eAJe22T7KpF8tueQsdCeG2a");
const SOL_VAULT = address("So1Vau1t11111111111111111111111111111111111");
const authority = createNoopSigner(address("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"));

describe("vault actions", () => {
  it.each([USDC_VAULT, SOL_VAULT])("deposits into %s", async (lpVault) => {
    expect(
      toVaultWire(
        await makeVaultDepositIx({ rpc: vaultsRpc, authority, lpVault, amount: 1_234_567 })
      )
    ).toMatchSnapshot();
  });
});
