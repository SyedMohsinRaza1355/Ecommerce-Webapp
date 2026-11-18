// Money is integer minor units plus currency exponent. No floating point (ADD-021).
export const CURRENCY_EXPONENT: Record<string, number> = { PKR: 2, USD: 2, EUR: 2, AED: 2, SAR: 2, JPY: 0, KWD: 3 };

export type Money = Readonly<{ minor: number; currency: string }>;

export function money(minor: number, currency: string): Money {
  if (!Number.isSafeInteger(minor)) throw new Error("Money must be an integer number of minor units");
  if (!(currency in CURRENCY_EXPONENT)) throw new Error(`Unsupported currency ${currency}`);
  return Object.freeze({ minor, currency });
}

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error("Currency mismatch");
  return money(a.minor + b.minor, a.currency);
}

export function multiply(a: Money, qty: number): Money {
  if (!Number.isSafeInteger(qty)) throw new Error("Quantity must be an integer");
  return money(a.minor * qty, a.currency);
}

/** Percentage in basis points (1% = 100), rounded half away from zero using integers only. */
export function percentBps(a: Money, bps: number): Money {
  if (!Number.isSafeInteger(bps)) throw new Error("Basis points must be an integer");
  const n = a.minor * bps;
  const q = Math.trunc(n / 10000);
  const r = Math.abs(n % 10000);
  const adj = r * 2 >= 10000 ? Math.sign(n) : 0;
  return money(q + adj, a.currency);
}

/** Parse "12.34" into minor units without floats. */
export function parseMajor(text: string, currency: string): Money {
  const exp = CURRENCY_EXPONENT[currency];
  if (exp === undefined) throw new Error(`Unsupported currency ${currency}`);
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new Error("Invalid amount");
  const frac = (m[3] ?? "");
  if (frac.length > exp) throw new Error("Too many decimal places");
  const minor = Number(m[2] + frac.padEnd(exp, "0")) * (m[1] ? -1 : 1);
  return money(minor, currency);
}

export function formatMajor(a: Money): string {
  const exp = CURRENCY_EXPONENT[a.currency];
  const abs = Math.abs(a.minor).toString().padStart(exp + 1, "0");
  const whole = abs.slice(0, abs.length - exp);
  const frac = exp ? "." + abs.slice(abs.length - exp) : "";
  return `${a.minor < 0 ? "-" : ""}${whole}${frac}`;
}
