import { address, getBase64Encoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import accounts from "./fixtures/mainnet-accounts.json";

import { decodeMarginfiAccount } from "~/accounts";
import {
  dtoToMarginfiAccount,
  parseMarginfiAccountRaw,
} from "~/services/account/utils/deserialize.utils";
import { marginfiAccountToDto } from "~/services/account/utils/serialize.utils";

// Mainnet marginfi accounts; the DTO matches the v2.8.3 (Anchor) parse of the same bytes.
describe("marginfi account DTO", () => {
  it.each(accounts)(
    "decodes the $label account into the API DTO",
    ({ address: accountAddress, data }) => {
      const account = parseMarginfiAccountRaw(
        address(accountAddress),
        decodeMarginfiAccount(getBase64Encoder().encode(data))
      );
      const dto = marginfiAccountToDto(account);

      expect(dto).toMatchSnapshot();
      expect(marginfiAccountToDto(dtoToMarginfiAccount(JSON.parse(JSON.stringify(dto))))).toEqual(
        dto
      );
    }
  );
});
