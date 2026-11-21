import { money, add, multiply, percentBps, type Money } from "@/lib/money/money";

export type Line = { productId: string; name: string; unitMinor: number; qty: number };

export type PricingConfig = {
  currency: string;
  taxBps: number; // tax-exclusive, applied to subtotal (F-042)
  taxEnabled: boolean;
  shippingFlatMinor: number; // F-063
  freeShippingOverMinor: number | null; // F-065
  discountBps?: number; // percentage code, applied before tax
};

export type Totals = {
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
};

/**
 * Calculation order (ADD-022): lines -> subtotal -> discount -> shipping -> tax on
 * (subtotal - discount) -> total. Integer minor units throughout.
 */
export function computeTotals(lines: Line[], cfg: PricingConfig, opts: { shipping: boolean } = { shipping: true }): Totals {
  let subtotal: Money = money(0, cfg.currency);
  for (const l of lines) {
    if (!Number.isSafeInteger(l.qty) || l.qty < 1 || l.qty > 999) throw new Error("Invalid quantity");
    subtotal = add(subtotal, multiply(money(l.unitMinor, cfg.currency), l.qty));
  }
  const discount = cfg.discountBps ? percentBps(subtotal, cfg.discountBps) : money(0, cfg.currency);
  const taxable = money(subtotal.minor - discount.minor, cfg.currency);
  const free = cfg.freeShippingOverMinor !== null && taxable.minor >= cfg.freeShippingOverMinor && cfg.freeShippingOverMinor > 0;
  const shipping = opts.shipping && lines.length > 0 && !free ? money(cfg.shippingFlatMinor, cfg.currency) : money(0, cfg.currency);
  const tax = cfg.taxEnabled ? percentBps(taxable, cfg.taxBps) : money(0, cfg.currency);
  const total = add(add(taxable, shipping), tax);
  return {
    subtotalMinor: subtotal.minor,
    discountMinor: discount.minor,
    shippingMinor: shipping.minor,
    taxMinor: tax.minor,
    totalMinor: total.minor,
    currency: cfg.currency,
  };
}
