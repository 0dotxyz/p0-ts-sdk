import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  decodeGammaDepositPolicy,
  decodeGammaLpVault,
  decodeGammaWithdrawalPolicy,
  deriveGammaDepositPolicy,
  deriveGammaWithdrawalPolicy,
} from "~/vendor/gamma";

// Captured from mainnet at slot 464521900 (2026-11-02): the P0stbl vault (p0STBL1, USDC) and its
// two policy PDAs.
const LP_VAULT = address("6eGJ9RMdTbhdcDBDukD6hrCLbbPJBnWss5zyqfzEgzXJ");
const LP_VAULT_DATA =
  "vS2nF1t2ab6Vv1oG6INnihwQpHU8eRmK+ZXmC4f5APibcbcvRI6qjmLyMu7aHAHhXSU2l9mU11vQ2kvf25xQDpY+6AyhuxLr25/nBYGK7MA/EUxLZL+9UcfcxNZgO0gkaM4biGGKIp3G+nrzvtutOj1l82qryXQxsbvkwtL24OR8pgIDRS9dYeLIRQ45eK+RFaH9i4WfZTGJR64b3CeSBuUl3+butCA14SXJxCcAAAAvUWwOJwAAALuU6GoAAAAAYAkAAAAAAAD7BwAAAHAwU1RCTDFbKgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIZOcWoAAAAAAMqaOwAAAAAKEnD/+zDJMpH0dH5mgCxVl7dLQA6O6SOX85ak7f3StgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const DEPOSIT_POLICY_DATA = "n/NB8lEbKadT1jgoSyNSbYSTsNoLhE0Jy9Vou+D8t3MQ0lmZUlKx6QBQOSeMBAAAAP0=";
const WITHDRAWAL_POLICY_DATA =
  "NOdEO/f6d/RT1jgoSyNSbYSTsNoLhE0Jy9Vou+D8t3MQ0lmZUlKx6QoA0AeIE9zSbhgAAAAAK2audgIAAABkGuhqAAAAABdV52oAAAAA/w==";

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

describe("deriveGammaDepositPolicy / deriveGammaWithdrawalPolicy", () => {
  it("derive the P0stbl policy PDAs", async () => {
    const [depositPolicy] = await deriveGammaDepositPolicy(LP_VAULT);
    const [withdrawalPolicy] = await deriveGammaWithdrawalPolicy(LP_VAULT);

    expect(depositPolicy).toBe("Fo3m1qytkegi6AHhLdvMUXZgXA2AXHXqxb6MRySpvzJE");
    expect(withdrawalPolicy).toBe("HBSqzKiDdwmT1gvZrMWLr9kG4LPsWgkR3NxacLWh1q9g");
  });
});

describe("decodeGammaDepositPolicy", () => {
  it("decodes the P0stbl deposit cap and pause switch", () => {
    expect(decodeGammaDepositPolicy(bytes(DEPOSIT_POLICY_DATA))).toMatchObject({
      lpVault: LP_VAULT,
      capacityAssets: 5_000_000_000_000n, // 5M USDC
      depositsPaused: false,
    });
  });

  it("rejects another account's data", () => {
    expect(() => decodeGammaDepositPolicy(bytes(WITHDRAWAL_POLICY_DATA))).toThrow(
      /DepositPolicy account discriminator/
    );
  });
});

describe("decodeGammaWithdrawalPolicy", () => {
  it("decodes the P0stbl withdrawal fee and rolling caps", () => {
    expect(decodeGammaWithdrawalPolicy(bytes(WITHDRAWAL_POLICY_DATA))).toMatchObject({
      lpVault: LP_VAULT,
      withdrawalFeeBps: 10,
      hourlyWithdrawalCapBps: 2000,
      dailyWithdrawalCapBps: 5000,
      hourlyWithdrawnAssets: 409_916_124n,
      dailyWithdrawnAssets: 10_581_075_499n,
      hourlyWindowStart: 1_793_596_004n,
      dailyWindowStart: 1_793_545_495n,
    });
  });

  it("rejects another account's data", () => {
    expect(() => decodeGammaWithdrawalPolicy(bytes(DEPOSIT_POLICY_DATA))).toThrow(
      /WithdrawalPolicy account discriminator/
    );
  });
});

describe("decodeGammaLpVault", () => {
  it("carries the NAV and share supply the share price is derived from", () => {
    expect(decodeGammaLpVault(bytes(LP_VAULT_DATA))).toMatchObject({
      vaultName: "p0STBL1",
      assetsMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      nav: 170_805_241_313n,
      totalShares: 167_745_704_239n,
      navUpdatedAt: 1_793_627_323n,
      navMaxStaleness: 2400n,
      pendingWithdrawalValue: 10_843n,
      performanceFeeBps: 0,
    });
  });
});
