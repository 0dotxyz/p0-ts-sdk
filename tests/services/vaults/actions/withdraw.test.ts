import { address, createNoopSigner } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { toVaultWire, vaultsRpc } from "../../../helpers/vaults";

import { makeVaultCompleteWithdrawalIx, makeVaultWithdrawIx } from "~/services/vaults";

// A live USDC Gamma v2 vault, a variant of it with the fee recipient set, and its asset mint.
// Snapshots were checked against v2.8.4's builders.
const USDC_VAULT = address("2cGosKLVJug5MRzQ46Ud5eAJe22T7KpF8tueQsdCeG2a");
const FEE_VAULT = address("FeeVau1t11111111111111111111111111111111111");
const authority = createNoopSigner(address("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"));

describe("vault actions", () => {
  it.each([USDC_VAULT, FEE_VAULT])("starts a withdrawal from %s", async (lpVault) => {
    expect(
      toVaultWire(
        await makeVaultWithdrawIx({ rpc: vaultsRpc, authority, lpVault, sharesAmount: 7_654_321 })
      )
    ).toMatchSnapshot();
  });

  it("claims a fulfilled withdrawal", async () => {
    expect(
      toVaultWire(
        await makeVaultCompleteWithdrawalIx({ rpc: vaultsRpc, authority, lpVault: USDC_VAULT })
      )
    ).toMatchSnapshot();
  });
});
