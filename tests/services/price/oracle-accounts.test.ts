import { getBase64Encoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import accounts from "./fixtures/mainnet-oracle-accounts.json";

import { decodeMultiplierAccount } from "~/services/price/utils/multiplier-data.utils";
import { parseRpcPythPriceData } from "~/services/price/utils/pyth-data.utils";
import { oraclePriceToDto } from "~/services/price/utils/serialize.utils";

const [pythPriceUpdate, ...multiplierAccounts] = accounts.map((account) => ({
  ...account,
  data: getBase64Encoder().encode(account.data),
}));

// Mainnet oracle accounts; the outputs match the v2.8.3 (web3/borsh) decoders.
describe("oracle account decoding", () => {
  it("parses a Pyth PriceUpdateV2 into an oracle price", () => {
    expect(oraclePriceToDto(parseRpcPythPriceData(pythPriceUpdate.data))).toMatchSnapshot();
  });

  it.each(multiplierAccounts)("decodes the $label multiplier account", ({ data }) => {
    expect(decodeMultiplierAccount(data)).toMatchSnapshot();
  });

  it("rejects accounts that are not a multiplier source", () => {
    expect(decodeMultiplierAccount(pythPriceUpdate.data)).toBeUndefined();
  });
});
