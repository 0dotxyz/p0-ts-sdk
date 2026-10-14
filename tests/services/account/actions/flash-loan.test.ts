import { describe, expect, it } from "vitest";

import { mainnetBankMap, mainnetBanks } from "../../../helpers/mainnet";
import { depositParams, toWire, v283Cases } from "../../../helpers/parity";

import { makeBeginFlashLoanIx, makeEndFlashLoanIx } from "~/services/account/actions/flash-loan";

const { programAddress, marginfiAccount, authority } = depositParams;

describe("makeBeginFlashLoanIx", () => {
  it("matches the v2.8.3 instructions for starting a flash loan", async () => {
    const ix = await makeBeginFlashLoanIx({
      programAddress,
      marginfiAccount,
      authority,
      endIndex: 5,
    });
    expect(toWire([ix])).toEqual(v283Cases.beginFlashloan);
  });
});

describe("makeEndFlashLoanIx", () => {
  it("matches the v2.8.3 instructions for ending a flash loan", async () => {
    const ix = await makeEndFlashLoanIx({
      programAddress,
      marginfiAccount,
      authority,
      bankMap: mainnetBankMap,
      activeBanks: [mainnetBanks.default.address, mainnetBanks.sol.address],
    });
    expect(toWire([ix])).toEqual(v283Cases.endFlashloan);
  });
});
