import { describe, expect, it } from "vitest";

import { getReserveDecoder, getReserveSize, RESERVE_DISCRIMINATOR } from "~/generated/klend";
import { dtoToKaminoReserve, KaminoInterestRateBasis, kaminoReserveToDto } from "~/vendor/klend";

// Account offsets (config starts at 4856; see klend `ReserveConfig` layout).
const HOST_FIXED_INTEREST_RATE_BPS_OFFSET = 4858;
const INTEREST_RATE_BASIS_OFFSET = 4865;
const PROTOCOL_TAKE_RATE_PCT_OFFSET = 4870;

const makeReserveAccount = (basis: KaminoInterestRateBasis) => {
  const data = new Uint8Array(getReserveSize());
  const view = new DataView(data.buffer);
  data.set(RESERVE_DISCRIMINATOR, 0);
  view.setUint16(HOST_FIXED_INTEREST_RATE_BPS_OFFSET, 25, true);
  view.setUint8(INTEREST_RATE_BASIS_OFFSET, basis);
  view.setUint8(PROTOCOL_TAKE_RATE_PCT_OFFSET, 15);
  return data;
};

describe("generated klend Reserve decoder", () => {
  it("reads interestRateBasis from the reserve config", () => {
    const reserve = getReserveDecoder().decode(makeReserveAccount(KaminoInterestRateBasis.TrueApr));

    expect(reserve.config.hostFixedInterestRateBps).toBe(25);
    expect(reserve.config.interestRateBasis).toBe(KaminoInterestRateBasis.TrueApr);
    expect(reserve.config.protocolTakeRatePct).toBe(15);
  });

  it("carries interestRateBasis through the DTO boundary", () => {
    const reserve = getReserveDecoder().decode(makeReserveAccount(KaminoInterestRateBasis.TrueApr));
    const dto = kaminoReserveToDto(reserve);

    expect(dto.config.interestRateBasis).toBe(KaminoInterestRateBasis.TrueApr);
    expect(dtoToKaminoReserve(dto).config.interestRateBasis).toBe(KaminoInterestRateBasis.TrueApr);
  });

  it("decodes a zeroed config as Legacy", () => {
    const reserve = getReserveDecoder().decode(makeReserveAccount(KaminoInterestRateBasis.Legacy));

    expect(reserve.config.interestRateBasis).toBe(KaminoInterestRateBasis.Legacy);
  });
});
