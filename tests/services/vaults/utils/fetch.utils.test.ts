import { address, createNoopSigner, type GetAccountInfoApi, type Rpc } from "@solana/kit";
import { describe, expect, it } from "vitest";

import fixture from "../../../fixtures/mainnet-vaults.json";
import { vaultsRpc } from "../../../helpers/vaults";

import {
  fetchGammaDepositPolicy,
  fetchGammaWithdrawalPolicy,
  fetchGammaWithdrawReceipt,
} from "~/services/vaults";

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

// The P0stbl vault's policy accounts, captured from mainnet at slot 464521900 (2026-11-02)
const P0STBL_VAULT = address("6eGJ9RMdTbhdcDBDukD6hrCLbbPJBnWss5zyqfzEgzXJ");
const P0STBL_POLICIES: Record<string, string> = {
  Fo3m1qytkegi6AHhLdvMUXZgXA2AXHXqxb6MRySpvzJE:
    "n/NB8lEbKadT1jgoSyNSbYSTsNoLhE0Jy9Vou+D8t3MQ0lmZUlKx6QBQOSeMBAAAAP0=",
  HBSqzKiDdwmT1gvZrMWLr9kG4LPsWgkR3NxacLWh1q9g:
    "NOdEO/f6d/RT1jgoSyNSbYSTsNoLhE0Jy9Vou+D8t3MQ0lmZUlKx6QoA0AeIE9zSbhgAAAAAK2audgIAAABkGuhqAAAAABdV52oAAAAA/w==",
};
const policiesRpc = {
  getAccountInfo: (a: string) => ({
    send: async () => {
      const data = P0STBL_POLICIES[a];
      return {
        context: { slot: 1n },
        value: data
          ? {
              data: [data, "base64"],
              owner: "GaMmanX9i4jGmqDZZD2tbD6B2v9p21btenPneMXnTczV",
              lamports: 1n,
              executable: false,
              space: BigInt(Buffer.from(data, "base64").length),
            }
          : null,
      };
    },
  }),
} as unknown as Rpc<GetAccountInfoApi>;

describe("fetchGammaDepositPolicy", () => {
  it("decodes the vault's deposit policy", async () => {
    expect(await fetchGammaDepositPolicy(policiesRpc, P0STBL_VAULT)).toMatchObject({
      lpVault: P0STBL_VAULT,
      capacityAssets: 5_000_000_000_000n,
      depositsPaused: false,
    });
  });

  it("is null without a policy account", async () => {
    expect(await fetchGammaDepositPolicy(vaultsRpc, USDC_VAULT)).toBeNull();
  });
});

describe("fetchGammaWithdrawalPolicy", () => {
  it("decodes the vault's withdrawal policy", async () => {
    expect(await fetchGammaWithdrawalPolicy(policiesRpc, P0STBL_VAULT)).toMatchObject({
      lpVault: P0STBL_VAULT,
      withdrawalFeeBps: 10,
      hourlyWithdrawalCapBps: 2000,
      dailyWithdrawalCapBps: 5000,
    });
  });

  it("is null without a policy account", async () => {
    expect(await fetchGammaWithdrawalPolicy(vaultsRpc, USDC_VAULT)).toBeNull();
  });
});
