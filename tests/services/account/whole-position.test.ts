import { describe, expect, it } from "vitest";

import { computeClosePositionTokenAmount, isWholePosition } from "~/services/account";

describe("isWholePosition", () => {
  it("counts an already-rounded debt as whole", () => {
    // 2.007 * 10 ** 6 is 2007000.0000000002 in floating point
    expect(computeClosePositionTokenAmount({ amount: 2.007, isLending: false }, 6)).toBe(2.007);
    expect(isWholePosition({ amount: 2.007, isLending: false }, 2.007, 6)).toBe(true);
  });

  it("doesn't count a withdraw one native unit short as whole", () => {
    // 1.001 * 10 ** 6 is 1000999.9999999999 in floating point
    expect(computeClosePositionTokenAmount({ amount: 1.001, isLending: true }, 6)).toBe(1.001);
    expect(isWholePosition({ amount: 1.001, isLending: true }, 1.000999, 6)).toBe(false);
  });
});
