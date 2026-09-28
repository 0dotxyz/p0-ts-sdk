import {
  address,
  createNoopSigner,
  getBase16Decoder,
  isSignerRole,
  isWritableRole,
  type Address,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";

import fixture from "./fixtures/mainnet-vaults.json";

import {
  fetchGammaWithdrawReceipt,
  makeVaultCompleteWithdrawalIx,
  makeVaultDepositIx,
  makeVaultWithdrawIx,
} from "~/services/vaults";

// A live USDC Gamma v2 vault, two variants of it (fee recipient set / wSOL assets), their asset
// mints and a live withdraw receipt. Snapshots were checked against v2.8.4's builders.
const USDC_VAULT = address("2cGosKLVJug5MRzQ46Ud5eAJe22T7KpF8tueQsdCeG2a");
const FEE_VAULT = address("FeeVau1t11111111111111111111111111111111111");
const SOL_VAULT = address("So1Vau1t11111111111111111111111111111111111");
const authority = createNoopSigner(address("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"));

const accounts = fixture.accounts as Record<
  string,
  { data: string; owner: string; lamports: number; executable: boolean } | null
>;
const rpc = {
  getAccountInfo: (a: Address) => ({
    send: async () => {
      const account = accounts[a];
      return {
        context: { slot: 1n },
        value: account
          ? {
              data: [account.data, "base64"],
              owner: account.owner,
              lamports: BigInt(account.lamports),
              executable: account.executable,
              space: BigInt(Buffer.from(account.data, "base64").length),
            }
          : null,
      };
    },
  }),
} as never;

const toWire = (ixs: Instruction[]) =>
  ixs.map((ix) => ({
    program: ix.programAddress,
    accounts: (ix.accounts ?? []).map((m) => [
      m.address,
      isSignerRole(m.role),
      isWritableRole(m.role),
    ]),
    data: getBase16Decoder().decode(ix.data ?? new Uint8Array()),
  }));

describe("vault actions", () => {
  it.each([USDC_VAULT, SOL_VAULT])("deposits into %s", async (lpVault) => {
    expect(
      toWire(await makeVaultDepositIx({ rpc, authority, lpVault, amount: 1_234_567 }))
    ).toMatchSnapshot();
  });

  it.each([USDC_VAULT, FEE_VAULT])("starts a withdrawal from %s", async (lpVault) => {
    expect(
      toWire(await makeVaultWithdrawIx({ rpc, authority, lpVault, sharesAmount: 7_654_321 }))
    ).toMatchSnapshot();
  });

  it("claims a fulfilled withdrawal", async () => {
    expect(
      toWire(await makeVaultCompleteWithdrawalIx({ rpc, authority, lpVault: USDC_VAULT }))
    ).toMatchSnapshot();
  });
});

describe("fetchGammaWithdrawReceipt", () => {
  it("decodes a user's receipt", async () => {
    const receipt = await fetchGammaWithdrawReceipt(
      rpc,
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
    expect(await fetchGammaWithdrawReceipt(rpc, authority.address, USDC_VAULT)).toBeNull();
  });
});
