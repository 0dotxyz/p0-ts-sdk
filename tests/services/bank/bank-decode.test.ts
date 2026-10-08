import { getBase64Encoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { decodeBankRaw } from "~/accounts";
import { getBankSize } from "~/generated/marginfi";

import mainnetBanks from "./fixtures/mainnet-banks.json";

describe("decodeBankRaw", () => {
  // Mainnet banks keep the pre-0.1.12 size until `lending_pool_resize_bank_account` runs.
  it.each(mainnetBanks.map((b) => [b.label, b.data]))(
    "decodes unresized %s the same as its resized form",
    (_, data) => {
      const unresized = getBase64Encoder().encode(data);
      const resized = new Uint8Array(getBankSize());
      resized.set(unresized);

      expect(unresized.length).toBeLessThan(getBankSize());
      expect(decodeBankRaw(unresized)).toEqual(decodeBankRaw(resized));
    }
  );

  it("rejects data that isn't a bank", () => {
    expect(() => decodeBankRaw(new Uint8Array(getBankSize()))).toThrow("discriminator");
  });
});
