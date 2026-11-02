import { PublicKey } from "@solana/web3.js";
import { describe, it, expect } from "vitest";

import {
  decodeGammaDepositPolicyData,
  decodeGammaLpVaultData,
  decodeGammaWithdrawalPolicyData,
  deriveGammaDepositPolicy,
  deriveGammaWithdrawalPolicy,
} from "~/vendor/gamma";

// Captured from mainnet at slot 464521900 (2026-11-02): the P0stbl vault (p0STBL1, USDC) and its
// two policy PDAs.
const LP_VAULT = new PublicKey("6eGJ9RMdTbhdcDBDukD6hrCLbbPJBnWss5zyqfzEgzXJ");
const LP_VAULT_DATA =
  "vS2nF1t2ab6Vv1oG6INnihwQpHU8eRmK+ZXmC4f5APibcbcvRI6qjmLyMu7aHAHhXSU2l9mU11vQ2kvf25xQDpY+6AyhuxLr25/nBYGK7MA/EUxLZL+9UcfcxNZgO0gkaM4biGGKIp3G+nrzvtutOj1l82qryXQxsbvkwtL24OR8pgIDRS9dYeLIRQ45eK+RFaH9i4WfZTGJR64b3CeSBuUl3+butCA14SXJxCcAAAAvUWwOJwAAALuU6GoAAAAAYAkAAAAAAAD7BwAAAHAwU1RCTDFbKgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIZOcWoAAAAAAMqaOwAAAAAKEnD/+zDJMpH0dH5mgCxVl7dLQA6O6SOX85ak7f3StgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const DEPOSIT_POLICY_DATA = "n/NB8lEbKadT1jgoSyNSbYSTsNoLhE0Jy9Vou+D8t3MQ0lmZUlKx6QBQOSeMBAAAAP0=";
const WITHDRAWAL_POLICY_DATA =
  "NOdEO/f6d/RT1jgoSyNSbYSTsNoLhE0Jy9Vou+D8t3MQ0lmZUlKx6QoA0AeIE9zSbhgAAAAAK2audgIAAABkGuhqAAAAABdV52oAAAAA/w==";

const buf = (b64: string) => Buffer.from(b64, "base64");

describe("decodeGammaDepositPolicyData", () => {
  it("decodes the P0stbl deposit cap and pause switch", () => {
    const [pubkey] = deriveGammaDepositPolicy(LP_VAULT);
    const policy = decodeGammaDepositPolicyData(buf(DEPOSIT_POLICY_DATA), pubkey);

    expect(pubkey.toBase58()).toBe("Fo3m1qytkegi6AHhLdvMUXZgXA2AXHXqxb6MRySpvzJE");
    expect(policy.pubkey.equals(pubkey)).toBe(true);
    expect(policy.lpVault.equals(LP_VAULT)).toBe(true);
    expect(policy.capacityAssets.toString()).toBe("5000000000000"); // 5M USDC
    expect(policy.depositsPaused).toBe(false);
    expect(policy.bump).toBe(253);
  });

  it("rejects another account's data", () => {
    expect(() => decodeGammaDepositPolicyData(buf(WITHDRAWAL_POLICY_DATA), LP_VAULT)).toThrow(
      /DepositPolicy account discriminator/
    );
  });
});

describe("decodeGammaWithdrawalPolicyData", () => {
  it("decodes the P0stbl withdrawal fee and rolling caps", () => {
    const [pubkey] = deriveGammaWithdrawalPolicy(LP_VAULT);
    const policy = decodeGammaWithdrawalPolicyData(buf(WITHDRAWAL_POLICY_DATA), pubkey);

    expect(pubkey.toBase58()).toBe("HBSqzKiDdwmT1gvZrMWLr9kG4LPsWgkR3NxacLWh1q9g");
    expect(policy.lpVault.equals(LP_VAULT)).toBe(true);
    expect(policy.withdrawalFeeBps).toBe(10);
    expect(policy.hourlyWithdrawalCapBps).toBe(2000);
    expect(policy.dailyWithdrawalCapBps).toBe(5000);
    expect(policy.hourlyWithdrawnAssets.toString()).toBe("409916124");
    expect(policy.dailyWithdrawnAssets.toString()).toBe("10581075499");
    expect(policy.hourlyWindowStart.toString()).toBe("1793596004");
    expect(policy.dailyWindowStart.toString()).toBe("1793545495");
    expect(policy.bump).toBe(255);
  });

  it("rejects another account's data", () => {
    expect(() => decodeGammaWithdrawalPolicyData(buf(DEPOSIT_POLICY_DATA), LP_VAULT)).toThrow(
      /WithdrawalPolicy account discriminator/
    );
  });
});

describe("decodeGammaLpVaultData", () => {
  it("decodes the NAV and share supply the share price is derived from", () => {
    const vault = decodeGammaLpVaultData(buf(LP_VAULT_DATA), LP_VAULT);

    expect(vault.vaultName).toBe("p0STBL1");
    expect(vault.assetsMint.toBase58()).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(vault.nav.toString()).toBe("170805241313");
    expect(vault.totalShares.toString()).toBe("167745704239");
    expect(vault.navUpdatedAt.toString()).toBe("1793627323");
    expect(vault.navMaxStaleness.toString()).toBe("2400");
    expect(vault.pendingWithdrawalValue.toString()).toBe("10843");
    expect(vault.performanceFeeBps).toBe(0);
  });
});
