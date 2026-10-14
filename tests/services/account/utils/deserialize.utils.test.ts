import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { key } from "../../../helpers/addresses";

import { AccountFlags, MarginfiAccountType } from "~/services/account/types";
import {
  dtoToMarginfiAccount,
  getActiveAccountFlags,
} from "~/services/account/utils/deserialize.utils";
import { marginfiAccountToDto } from "~/services/account/utils/serialize.utils";

describe("getActiveAccountFlags", () => {
  it("parses the receivership, deleverage, frozen and order-execution flags", () => {
    const flags = getActiveAccountFlags(BigInt((1 << 4) | (1 << 5) | (1 << 6) | (1 << 7)));
    expect(flags).toEqual([
      AccountFlags.ACCOUNT_IN_RECEIVERSHIP,
      AccountFlags.ACCOUNT_IN_DELEVERAGE,
      AccountFlags.ACCOUNT_FROZEN,
      AccountFlags.ACCOUNT_IN_ORDER_EXECUTION,
    ]);
  });
});

describe("dtoToMarginfiAccount", () => {
  it("round-trips activeOrders through the DTO and defaults it for older DTOs", () => {
    const account: MarginfiAccountType = {
      address: key(1),
      group: key(1),
      authority: key(1),
      balances: [],
      accountFlags: [],
      healthCache: {
        assetValue: new BigNumber(0),
        liabilityValue: new BigNumber(0),
        assetValueMaint: new BigNumber(0),
        liabilityValueMaint: new BigNumber(0),
        assetValueEquity: new BigNumber(0),
        liabilityValueEquity: new BigNumber(0),
        timestamp: new BigNumber(0),
        flags: [],
        prices: [],
        simulationStatus: 0,
      },
      activeOrders: 2,
    };
    const dto = marginfiAccountToDto(account);
    expect(dto.activeOrders).toBe(2);
    expect(dtoToMarginfiAccount(dto).activeOrders).toBe(2);
    expect(dtoToMarginfiAccount({ ...dto, activeOrders: undefined }).activeOrders).toBe(0);
  });
});
