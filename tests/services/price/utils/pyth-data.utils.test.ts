import { getBase64Encoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import accounts from "../../../fixtures/mainnet-oracle-accounts.json";

import { parseRpcPythPriceData } from "~/services/price/utils/pyth-data.utils";
import { oraclePriceToDto } from "~/services/price/utils/serialize.utils";

const pythPriceUpdate = getBase64Encoder().encode(accounts[0].data);

// A mainnet Pyth account; the output matches the v2.8.3 (web3/borsh) decoder.
describe("oracle account decoding", () => {
  it("parses a Pyth PriceUpdateV2 into an oracle price", () => {
    expect(oraclePriceToDto(parseRpcPythPriceData(pythPriceUpdate))).toMatchSnapshot();
  });
});
