import { describe, expect, it } from "vitest";

import {
  decodeKlendReserve,
  dtoToKaminoReserve,
  KaminoInterestRateBasis,
  kaminoReserveToDto,
} from "~/vendor/klend";

// sha256("account:Reserve")[..8]; the account is 8624 bytes.
const RESERVE_DISCRIMINATOR = [43, 242, 204, 202, 26, 247, 59, 127];
const RESERVE_SIZE = 8624;

// Account offsets (config starts at 4856; see klend `ReserveConfig` layout).
const HOST_FIXED_INTEREST_RATE_BPS_OFFSET = 4858;
const INTEREST_RATE_BASIS_OFFSET = 4865;
const PROTOCOL_TAKE_RATE_PCT_OFFSET = 4870;

const makeReserveAccount = (basis: KaminoInterestRateBasis) => {
  const data = new Uint8Array(RESERVE_SIZE);
  const view = new DataView(data.buffer);
  data.set(RESERVE_DISCRIMINATOR, 0);
  view.setUint16(HOST_FIXED_INTEREST_RATE_BPS_OFFSET, 25, true);
  view.setUint8(INTEREST_RATE_BASIS_OFFSET, basis);
  view.setUint8(PROTOCOL_TAKE_RATE_PCT_OFFSET, 15);
  return data;
};

describe("decodeKlendReserve", () => {
  it("reads interestRateBasis from the reserve config", () => {
    const reserve = decodeKlendReserve(makeReserveAccount(KaminoInterestRateBasis.TrueApr));

    expect(reserve.config.hostFixedInterestRateBps).toBe(25);
    expect(reserve.config.interestRateBasis).toBe(KaminoInterestRateBasis.TrueApr);
    expect(reserve.config.protocolTakeRatePct).toBe(15);
  });

  it("carries interestRateBasis through the DTO boundary", () => {
    const reserve = decodeKlendReserve(makeReserveAccount(KaminoInterestRateBasis.TrueApr));
    const dto = kaminoReserveToDto(reserve);

    expect(dto.config.interestRateBasis).toBe(KaminoInterestRateBasis.TrueApr);
    expect(dtoToKaminoReserve(dto).config.interestRateBasis).toBe(KaminoInterestRateBasis.TrueApr);
  });

  it("decodes a zeroed config as Legacy", () => {
    const reserve = decodeKlendReserve(makeReserveAccount(KaminoInterestRateBasis.Legacy));

    expect(reserve.config.interestRateBasis).toBe(KaminoInterestRateBasis.Legacy);
  });

  it("rejects a wrong discriminator", () => {
    const data = makeReserveAccount(KaminoInterestRateBasis.Legacy);
    data[0] ^= 0xff;

    expect(() => decodeKlendReserve(data)).toThrow("Invalid Kamino Reserve account discriminator");
  });
});
