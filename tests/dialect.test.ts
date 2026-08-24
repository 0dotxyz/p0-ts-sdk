import { describe, it, expect, afterEach, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";

import { isMarginfiV0110Live, MARGINFI_V0_1_10_ACTIVATION } from "~/dialect";
import syncInstructions from "~/sync-instructions";

const MAINNET_PROGRAM_ID = new PublicKey("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const STAGING_PROGRAM_ID = new PublicKey("stag8sTKds2h4KzjUw3zKTsxbqvT4XKHdaR9X9E6Rct");
const MAINNET_ACTIVATION = MARGINFI_V0_1_10_ACTIVATION[MAINNET_PROGRAM_ID.toBase58()];

const marginfiAccount = PublicKey.unique();
const group = PublicKey.unique();
const authority = PublicKey.unique();

function setNowUnix(unixSeconds: number) {
  vi.useFakeTimers();
  vi.setSystemTime(unixSeconds * 1000);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("isMarginfiV0110Live", () => {
  it("is false on mainnet before the activation timestamp and true at/after it", () => {
    expect(isMarginfiV0110Live(MAINNET_PROGRAM_ID, MAINNET_ACTIVATION - 1)).toBe(false);
    expect(isMarginfiV0110Live(MAINNET_PROGRAM_ID, MAINNET_ACTIVATION)).toBe(true);
  });

  it("treats staging and unlisted programs as already upgraded", () => {
    expect(isMarginfiV0110Live(STAGING_PROGRAM_ID, 0)).toBe(true);
    expect(isMarginfiV0110Live(PublicKey.unique(), 0)).toBe(true);
  });
});

describe("sync end-flashloan builder (0.1.9/0.1.10 dialect)", () => {
  it("omits `group` on mainnet before the flip (0.1.9 wire format)", () => {
    setNowUnix(MAINNET_ACTIVATION - 1);
    const ix = syncInstructions.makeEndFlashLoanIx(MAINNET_PROGRAM_ID, {
      marginfiAccount,
      group,
      authority,
    });
    expect(ix.keys.map((k) => k.pubkey)).toEqual([marginfiAccount, authority]);
    // 0.1.9 requires the authority signer at index 1.
    expect(ix.keys[1].isSigner).toBe(true);
  });

  it("includes `group` at index 1 on mainnet after the flip (0.1.10 wire format)", () => {
    setNowUnix(MAINNET_ACTIVATION);
    const ix = syncInstructions.makeEndFlashLoanIx(MAINNET_PROGRAM_ID, {
      marginfiAccount,
      group,
      authority,
    });
    expect(ix.keys.map((k) => k.pubkey)).toEqual([marginfiAccount, group, authority]);
  });

  it("includes `group` on staging regardless of time", () => {
    setNowUnix(0);
    const ix = syncInstructions.makeEndFlashLoanIx(STAGING_PROGRAM_ID, {
      marginfiAccount,
      group,
      authority,
    });
    expect(ix.keys.map((k) => k.pubkey)).toEqual([marginfiAccount, group, authority]);
  });

  it("appends remaining accounts after the fixed accounts in both dialects", () => {
    const remaining = [{ pubkey: PublicKey.unique(), isSigner: false, isWritable: false }];
    setNowUnix(MAINNET_ACTIVATION - 1);
    const before = syncInstructions.makeEndFlashLoanIx(
      MAINNET_PROGRAM_ID,
      { marginfiAccount, group, authority },
      remaining
    );
    expect(before.keys.at(-1)?.pubkey).toEqual(remaining[0].pubkey);
    expect(before.keys).toHaveLength(3);

    setNowUnix(MAINNET_ACTIVATION);
    const after = syncInstructions.makeEndFlashLoanIx(
      MAINNET_PROGRAM_ID,
      { marginfiAccount, group, authority },
      remaining
    );
    expect(after.keys.at(-1)?.pubkey).toEqual(remaining[0].pubkey);
    expect(after.keys).toHaveLength(4);
  });
});

describe("sync pulse-health builder (0.1.9/0.1.10 dialect)", () => {
  it("omits `group` before the flip and includes it after", () => {
    setNowUnix(MAINNET_ACTIVATION - 1);
    const before = syncInstructions.makePulseHealthIx(MAINNET_PROGRAM_ID, {
      marginfiAccount,
      group,
    });
    expect(before.keys.map((k) => k.pubkey)).toEqual([marginfiAccount]);

    setNowUnix(MAINNET_ACTIVATION);
    const after = syncInstructions.makePulseHealthIx(MAINNET_PROGRAM_ID, {
      marginfiAccount,
      group,
    });
    expect(after.keys.map((k) => k.pubkey)).toEqual([marginfiAccount, group]);
  });
});

describe("sync transfer-to-new-account builder (0.1.9/0.1.10 dialect)", () => {
  const accounts = {
    group,
    oldMarginfiAccount: PublicKey.unique(),
    newMarginfiAccount: PublicKey.unique(),
    authority,
    feePayer: PublicKey.unique(),
    newAuthority: PublicKey.unique(),
    globalFeeWallet: PublicKey.unique(),
    feeState: PublicKey.unique(),
  };

  it("omits `fee_state` before the flip and includes it at index 7 after", () => {
    setNowUnix(MAINNET_ACTIVATION - 1);
    const before = syncInstructions.makeAccountTransferToNewAccountIx(
      MAINNET_PROGRAM_ID,
      accounts
    );
    expect(before.keys).toHaveLength(8);
    expect(before.keys.some((k) => k.pubkey.equals(accounts.feeState))).toBe(false);

    setNowUnix(MAINNET_ACTIVATION);
    const after = syncInstructions.makeAccountTransferToNewAccountIx(MAINNET_PROGRAM_ID, accounts);
    expect(after.keys).toHaveLength(9);
    expect(after.keys[7].pubkey).toEqual(accounts.feeState);
  });
});
