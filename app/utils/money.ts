// Money as whole cents. Never store, add or compare dollars as floats:
// 0.1 + 0.2 !== 0.3, and parseFloat("1.005") * 100 is 100.49999999999999.
// Pure and dependency-free, so `npm test` runs it with plain Node.

export type Cents = number; // always a safe integer

export function isCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

// "$1,234.5" -> 123450. Reads the digits, never parseFloat. Up to two decimals,
// no negatives (the kind of entry carries the sign). Null when it isn't money.
export function parseCents(input: string): Cents | null {
  const m = input.replace(/[$,\s]/g, "").match(/^(\d+)(?:\.(\d{0,2}))?$|^\.(\d{1,2})$/);
  if (!m) return null;
  const dollars = m[1] ?? "0";
  const fraction = (m[2] ?? m[3] ?? "").padEnd(2, "0");
  const cents = Number(dollars) * 100 + Number(fraction);
  return Number.isSafeInteger(cents) ? cents : null;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// For showing only. Dividing a whole number of cents by 100 always formats to the right two decimals.
export function formatCents(cents: Cents): string {
  return usd.format((cents || 0) / 100); // || 0 turns -0 into 0, never "-$0.00"
}

// "102.35" for a form field or a payment link, without float formatting
export function plainAmount(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// A percentage in basis points (50% = 5000, 2.9% = 290) of a non-negative amount.
// The caller picks the rounding, because who absorbs the odd cent is a decision.
// Exact while cents * bps stays under 2^53 (about $900 billion at 100%).
export function percentOf(cents: Cents, bps: number, round: "up" | "down" | "nearest"): Cents {
  if (!isCents(cents) || cents < 0) throw new RangeError(`percentOf: bad amount ${cents}`);
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError(`percentOf: bad basis points ${bps}`);
  const n = cents * bps;
  if (!Number.isSafeInteger(n + 5000)) throw new RangeError("percentOf: amount too large");
  if (round === "up") return Math.ceil(n / 10000);
  if (round === "down") return Math.floor(n / 10000);
  return Math.floor((n + 5000) / 10000);
}

// Splits `total` into shares by whole-number weights so the shares always add
// up to exactly `total`. Everyone gets the rounded-down share, then the leftover
// cents go one each to the largest remainders; ties go to the earlier index, so
// the same input always gives the same split. Equal split: weights all 1.
// By amount charged: weights are cents. Zero weights get nothing.
export function allocate(total: Cents, weights: number[]): Cents[] {
  if (!isCents(total) || total < 0) throw new RangeError(`allocate: bad total ${total}`);
  if (weights.length === 0) throw new RangeError("allocate: no weights");
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) throw new RangeError("allocate: weights must be whole numbers >= 0");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) throw new RangeError("allocate: weights add up to zero");
  if (!Number.isSafeInteger(total * Math.max(...weights))) throw new RangeError("allocate: too large to split exactly");

  const shares = weights.map((w) => Math.floor((total * w) / sum));
  const leftover = total - shares.reduce((a, b) => a + b, 0);
  weights
    .map((w, i) => ({ i, remainder: (total * w) % sum, w }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i)
    .slice(0, leftover)
    .forEach(({ i }) => shares[i]++);
  return shares;
}

export function sumCents(values: Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    if (!isCents(v)) throw new RangeError(`sumCents: ${v} is not whole cents`);
    total += v;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError("sumCents: total too large");
  return total;
}
