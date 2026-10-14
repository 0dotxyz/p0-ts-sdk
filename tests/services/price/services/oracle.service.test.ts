import { address, getAddressDecoder, getBase64Encoder } from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import bankFixtures from "../../../fixtures/mainnet-banks.json";

import { ZERO_ORACLE_KEY } from "~/constants";
import { BankType, OracleSetup } from "~/services/bank";
import { decodeBank } from "~/services/bank/utils/deserialize.utils";
import { fetchOracleData } from "~/services/price";

const NOW_SECONDS = 1_760_000_000;

const { sol } = Object.fromEntries(
  bankFixtures.map(({ label, address: bankAddress, data }) => [
    label.split(" ")[0],
    decodeBank(address(bankAddress), getBase64Encoder().encode(data)),
  ])
);
let fill = 100;
const copyOfSol = (config: Partial<BankType["config"]>): BankType => ({
  ...sol,
  address: getAddressDecoder().decode(new Uint8Array(32).fill(fill++)),
  config: { ...sol.config, ...config },
});

const unusedPythOpts = { mode: "api" as const, pythOnchainData: { endpoint: "http://unused" } };

describe("fetchOracleData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
  });
  afterEach(() => vi.useRealTimers());

  it("stamps the prices it makes up with the current unix time in seconds", async () => {
    const fixed = copyOfSol({ oracleSetup: OracleSetup.Fixed, fixedPrice: new BigNumber(2) });
    const zero = copyOfSol({ oracleKeys: [ZERO_ORACLE_KEY] });

    const { bankOraclePriceMap } = await fetchOracleData([fixed, zero], {
      pythOpts: unusedPythOpts,
    });

    expect(bankOraclePriceMap.get(fixed.address)?.timestamp.toNumber()).toBe(NOW_SECONDS);
    expect(bankOraclePriceMap.get(zero.address)?.timestamp.toNumber()).toBe(NOW_SECONDS);
  });
});
