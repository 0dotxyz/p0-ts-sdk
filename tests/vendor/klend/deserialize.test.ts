import { describe, expect, it } from "vitest";

import {
  KaminoInterestRateBasis,
  decodeKlendReserveData,
  dtoToKaminoReserve,
  kaminoReserveToDto,
} from "~/vendor/klend";

const RESERVE_ACCOUNT_SIZE = 8624;
const RESERVE_DISCRIMINATOR = [43, 242, 204, 202, 26, 247, 59, 127];

// Account offsets (config starts at 4856; see klend `ReserveConfig` layout).
const HOST_FIXED_INTEREST_RATE_BPS_OFFSET = 4858;
const INTEREST_RATE_BASIS_OFFSET = 4865;
const PROTOCOL_TAKE_RATE_PCT_OFFSET = 4870;

const makeReserveAccount = () => {
  const data = Buffer.alloc(RESERVE_ACCOUNT_SIZE);
  Buffer.from(RESERVE_DISCRIMINATOR).copy(data, 0);
  data.writeUInt16LE(25, HOST_FIXED_INTEREST_RATE_BPS_OFFSET);
  data.writeUInt8(KaminoInterestRateBasis.TrueApr, INTEREST_RATE_BASIS_OFFSET);
  data.writeUInt8(15, PROTOCOL_TAKE_RATE_PCT_OFFSET);
  return data;
};

describe("decodeKlendReserveData", () => {
  it("reads interestRateBasis from the reserve config", () => {
    const raw = decodeKlendReserveData(makeReserveAccount());

    expect(raw.config.hostFixedInterestRateBps).toBe(25);
    expect(raw.config.interestRateBasis).toBe(KaminoInterestRateBasis.TrueApr);
    expect(raw.config.protocolTakeRatePct).toBe(15);
  });

  it("carries interestRateBasis through the DTO boundary", () => {
    const raw = decodeKlendReserveData(makeReserveAccount());
    const dto = kaminoReserveToDto(raw);

    expect(dto.config.interestRateBasis).toBe(KaminoInterestRateBasis.TrueApr);
    expect(dtoToKaminoReserve(dto).config.interestRateBasis).toBe(
      KaminoInterestRateBasis.TrueApr
    );
  });

  it("decodes a zeroed config as Legacy", () => {
    const data = makeReserveAccount();
    data.writeUInt8(0, INTEREST_RATE_BASIS_OFFSET);

    expect(decodeKlendReserveData(data).config.interestRateBasis).toBe(
      KaminoInterestRateBasis.Legacy
    );
  });

  it("rejects a wrong discriminator", () => {
    const data = makeReserveAccount();
    data.writeUInt8(0, 0);

    expect(() => decodeKlendReserveData(data)).toThrow("invalid account discriminator");
  });
});
