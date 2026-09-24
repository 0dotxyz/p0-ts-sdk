import { address, getBase64Encoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import banks from "./fixtures/mainnet-banks.json";

import { decodeBank } from "~/accounts";
import { dtoToBank, parseBankRaw } from "~/services/bank/utils/deserialize.utils";
import { toBankDto } from "~/services/bank/utils/serialize.utils";

// Mainnet bank accounts, one per asset tag. The DTO is the wire format the API serves the app,
// so the snapshot must only change deliberately.
describe("bank DTO", () => {
  it.each(banks)("decodes the $label bank into the API DTO", ({ address: bankAddress, data }) => {
    const bank = parseBankRaw(address(bankAddress), decodeBank(getBase64Encoder().encode(data)));
    const dto = toBankDto(bank);

    expect(dto).toMatchSnapshot();
    expect(toBankDto(dtoToBank(JSON.parse(JSON.stringify(dto))))).toEqual(dto);
  });
});
