// Weight-based delivery charges (F-064). Owners write tiers like "1000 | 0", "5000 | 150", "20000 | 600":
// an order up to that many grams adds that extra fee to the delivery charge. Heavier than the last tier pays the last fee.
export type WeightTier = { upToGrams: number; feeMinor: number };

export function parseTiers(text: string, toMinor: (s: string) => number): { ok: true; tiers: WeightTier[] } | { ok: false; error: string } {
  const tiers: WeightTier[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [g = "", f = ""] = line.split("|").map((x) => x.trim());
    const grams = Number(g.replace(/g$/i, ""));
    let fee = NaN;
    try { fee = toMinor(f); } catch { /* reported below */ }
    if (!Number.isInteger(grams) || grams < 1 || grams > 1_000_000 || !Number.isInteger(fee) || fee < 0 || fee > 10_000_000) return { ok: false, error: `Line "${line.slice(0, 40)}": write it as  grams | extra fee  (for example 5000 | 150).` };
    tiers.push({ upToGrams: grams, feeMinor: fee });
  }
  if (tiers.length > 12) return { ok: false, error: "At most 12 weight steps." };
  tiers.sort((a, b) => a.upToGrams - b.upToGrams);
  for (let i = 1; i < tiers.length; i++) if (tiers[i].upToGrams === tiers[i - 1].upToGrams) return { ok: false, error: "Each weight step needs a different weight." };
  return { ok: true, tiers };
}

export function weightSurcharge(tiers: WeightTier[] | undefined, grams: number): number {
  if (!tiers?.length || grams <= 0) return 0;
  return (tiers.find((t) => grams <= t.upToGrams) ?? tiers[tiers.length - 1]).feeMinor;
}
