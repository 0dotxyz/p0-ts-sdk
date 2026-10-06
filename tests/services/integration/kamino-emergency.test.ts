import { describe, expect, it } from "vitest";

import { BankType } from "~/services/bank";
import { withKaminoReserveEmergency } from "~/services/integration";
import { KaminoReserve } from "~/vendor/klend";

const bank = (kaminoEmergency: boolean) => ({ kaminoEmergency }) as unknown as BankType;
const reserve = (emergencyMode: number) =>
  ({ config: { emergencyMode } }) as unknown as KaminoReserve;

describe("withKaminoReserveEmergency", () => {
  it("sets kaminoEmergency when the reserve is in emergency mode", () => {
    expect(withKaminoReserveEmergency(bank(false), reserve(1)).kaminoEmergency).toBe(true);
  });

  it("keeps the market's emergency when the reserve is normal", () => {
    expect(withKaminoReserveEmergency(bank(true), reserve(0)).kaminoEmergency).toBe(true);
  });

  it("leaves kaminoEmergency unset when neither is in emergency", () => {
    expect(withKaminoReserveEmergency(bank(false), reserve(0)).kaminoEmergency).toBe(false);
  });
});
