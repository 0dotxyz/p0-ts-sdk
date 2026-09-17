import Decimal from "decimal.js";

// Kamino's fractions exceed Decimal's default 20 significant digits and must round-trip exactly
// (e.g. u128::MAX means "withdraw all"), so they use a private 40-digit clone.
const FractionDecimal = Decimal.clone({ precision: 40 });

/** Kamino U68F60 scaled fraction (`*Sf` fields). */
export class Fraction {
  static MAX_SIZE_F = 128;
  static MAX_SIZE_BF = 256;
  static FRACTIONS = 60;
  static MULTIPLIER = new FractionDecimal(2).pow(Fraction.FRACTIONS);

  static MAX_F = 2n ** BigInt(Fraction.MAX_SIZE_F) - 1n;
  static MAX_BF = 2n ** BigInt(Fraction.MAX_SIZE_BF) - 1n;

  valueSf: bigint;

  /** @throws if `valueSf` is negative or exceeds 256 bits */
  constructor(valueSf: bigint) {
    if (valueSf < 0n || valueSf > Fraction.MAX_BF) {
      throw new Error("Number out of range");
    }
    this.valueSf = valueSf;
  }

  toDecimal(): Decimal {
    return new FractionDecimal(this.valueSf.toString()).div(Fraction.MULTIPLIER);
  }

  static fromDecimal(n: Decimal | number): Fraction {
    const scaled = new FractionDecimal(n).mul(Fraction.MULTIPLIER);
    // `toFixed()` avoids the exponential notation `BigInt` can't parse.
    return new Fraction(BigInt(scaled.toDecimalPlaces(0, Decimal.ROUND_HALF_CEIL).toFixed()));
  }

  static fromBps(n: Decimal | number): Fraction {
    return Fraction.fromDecimal(new FractionDecimal(n).div(10000));
  }

  static fromPercent(n: Decimal | number): Fraction {
    return Fraction.fromDecimal(new FractionDecimal(n).div(100));
  }

  getValue(): bigint {
    return this.valueSf;
  }

  gt(x: Fraction): boolean {
    return this.valueSf > x.valueSf;
  }

  lt(x: Fraction): boolean {
    return this.valueSf < x.valueSf;
  }

  gte(x: Fraction): boolean {
    return this.valueSf >= x.valueSf;
  }

  lte(x: Fraction): boolean {
    return this.valueSf <= x.valueSf;
  }

  eq(x: Fraction): boolean {
    return this.valueSf === x.valueSf;
  }
}
