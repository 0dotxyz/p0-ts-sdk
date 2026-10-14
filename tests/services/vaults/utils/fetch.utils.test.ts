import { address, createNoopSigner } from "@solana/kit";
import { describe, expect, it } from "vitest";

import fixture from "../../../fixtures/mainnet-vaults.json";
import { vaultsRpc } from "../../../helpers/vaults";

import { fetchGammaWithdrawReceipt } from "~/services/vaults";

// A live USDC Gamma v2 vault and a live withdraw receipt
const USDC_VAULT = address("2cGosKLVJug5MRzQ46Ud5eAJe22T7KpF8tueQsdCeG2a");
const authority = createNoopSigner(address("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"));

describe("fetchGammaWithdrawReceipt", () => {
  it("decodes a user's receipt", async () => {
    const receipt = await fetchGammaWithdrawReceipt(
      vaultsRpc,
      address(fixture.receipt.user),
      address(fixture.receipt.lpVault)
    );

    expect(receipt).toMatchObject({
      user: fixture.receipt.user,
      lpVault: fixture.receipt.lpVault,
      pendingShares: 0n,
      claimableShares: 69_195_275n,
      claimableAssets: 70_098_006n,
    });
  });

  it("is null without a receipt", async () => {
    expect(await fetchGammaWithdrawReceipt(vaultsRpc, authority.address, USDC_VAULT)).toBeNull();
  });
});
