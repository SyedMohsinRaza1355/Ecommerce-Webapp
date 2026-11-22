import { APP_TIMEZONE } from "@/lib/i18n";
import { DAYS, type Day, type Product } from "./types";

// Product choices: variants (size, colour; each with its own stock, F-002/F-021), modifiers and
// add-ons (extras with a price, F-003), required groups (pick one drink, F-014), bundles (F-004),
// attributes (F-008) and availability windows (F-012/F-013). Pure functions so they are easy to test.
export type Choice = { id: string; label: string; priceDeltaMinor: number; stock?: number | null };
export type OptionGroup = { id: string; name: string; kind: "variant" | "modifier"; required: boolean; multi: boolean; max?: number; choices: Choice[] };
export type Availability = { days?: Day[]; from?: string; to?: string };

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "x";

// ---------------- the text format owners type ----------------
// variant Size! : Small stock 10; Large +50 stock 3
// modifier Extras* max 2 : Cheese +30; Bacon +60
//   "!" = required, "*" = more than one allowed, "+50"/"-20" = price change in whole currency units
export function parseOptions(text: string, exp: number): { ok: true; groups: OptionGroup[] } | { ok: false; error: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 6) return { ok: false, error: "At most 6 option groups per product." };
  const groups: OptionGroup[] = [];
  const seen = new Set<string>();
  for (const [li, line] of lines.entries()) {
    const m = /^(variant|modifier)\s+([^:!*]+?)\s*([!*]*)\s*(?:max\s+(\d{1,2}))?\s*:\s*(.+)$/i.exec(line);
    if (!m) return { ok: false, error: `Option line ${li + 1}: write it like  variant Size! : Small stock 10; Large +50 stock 3` };
    const kind = m[1].toLowerCase() as "variant" | "modifier";
    const name = m[2].trim();
    if (name.length < 1 || name.length > 40) return { ok: false, error: `Option line ${li + 1}: the group name must be 1 to 40 characters.` };
    let gid = slug(name);
    while (seen.has(gid)) gid += "x";
    seen.add(gid);
    const choices: Choice[] = [];
    const cseen = new Set<string>();
    for (const raw of m[5].split(";").map((c) => c.trim()).filter(Boolean)) {
      const cm = /^(.+?)(?:\s+([+-]\d+(?:\.\d{1,3})?))?(?:\s+stock\s+(\d{1,6}))?$/i.exec(raw);
      if (!cm) return { ok: false, error: `Option line ${li + 1}: could not read "${raw}".` };
      const label = cm[1].trim();
      if (label.length < 1 || label.length > 40) return { ok: false, error: `Option line ${li + 1}: each choice name must be 1 to 40 characters.` };
      const delta = cm[2] ? Math.round(parseFloat(cm[2]) * 10 ** exp) : 0;
      if (Math.abs(delta) > 100_000_000) return { ok: false, error: `Option line ${li + 1}: that price change is too large.` };
      let cid = `${gid}-${slug(label)}`;
      while (cseen.has(cid)) cid += "x";
      cseen.add(cid);
      choices.push({ id: cid, label, priceDeltaMinor: delta, ...(cm[3] !== undefined && kind === "variant" ? { stock: Number(cm[3]) } : {}) });
    }
    if (choices.length < 1 || choices.length > 30) return { ok: false, error: `Option line ${li + 1}: give 1 to 30 choices separated by ;` };
    const multi = m[3].includes("*");
    const max = m[4] ? Number(m[4]) : undefined;
    if (max !== undefined && (max < 1 || max > 30)) return { ok: false, error: `Option line ${li + 1}: max must be 1 to 30.` };
    if (kind === "variant" && multi) return { ok: false, error: `Option line ${li + 1}: a variant (like size) is always one choice. Use "modifier" for extras.` };
    groups.push({ id: gid, name, kind, required: m[3].includes("!") || kind === "variant", multi, ...(max ? { max } : {}), choices });
  }
  return { ok: true, groups };
}

export function serializeOptions(groups: OptionGroup[] | undefined, exp: number): string {
  return (groups ?? []).map((g) => {
    const flags = `${g.required && g.kind !== "variant" ? "!" : ""}${g.multi ? "*" : ""}`;
    const head = `${g.kind} ${g.name}${flags}${g.max ? ` max ${g.max}` : ""} : `;
    return head + g.choices.map((c) => `${c.label}${c.priceDeltaMinor ? ` ${c.priceDeltaMinor > 0 ? "+" : "-"}${(Math.abs(c.priceDeltaMinor) / 10 ** exp).toString()}` : ""}${c.stock != null ? ` stock ${c.stock}` : ""}`).join("; ");
  }).join("\n");
}

// ---------------- choosing ----------------
export type Resolved = { ok: true; sel: string[]; unitMinor: number; label: string } | { ok: false; error: string };

/** Checks a shopper's picks against the product's groups and works out the price. Never trusts the browser. */
export function resolveSelection(p: Pick<Product, "name" | "priceMinor"> & { options?: OptionGroup[] }, picked: string[]): Resolved {
  const groups = p.options ?? [];
  const ids = [...new Set(picked)];
  const byChoice = new Map<string, { g: OptionGroup; c: Choice }>();
  for (const g of groups) for (const c of g.choices) byChoice.set(c.id, { g, c });
  const counts = new Map<string, number>();
  let delta = 0;
  const labels: string[] = [];
  for (const id of ids) {
    const hit = byChoice.get(id);
    if (!hit) return { ok: false, error: "One of the chosen options is not available any more." };
    counts.set(hit.g.id, (counts.get(hit.g.id) ?? 0) + 1);
    delta += hit.c.priceDeltaMinor;
  }
  for (const g of groups) {
    const n = counts.get(g.id) ?? 0;
    if (g.required && n === 0) return { ok: false, error: `Choose an option for "${g.name}".` };
    if (!g.multi && n > 1) return { ok: false, error: `Choose only one "${g.name}".` };
    if (g.max && n > g.max) return { ok: false, error: `Choose at most ${g.max} for "${g.name}".` };
    for (const c of g.choices) if (ids.includes(c.id)) labels.push(c.label);
  }
  const unitMinor = p.priceMinor + delta;
  if (unitMinor < 0) return { ok: false, error: "That combination is not available." };
  return { ok: true, sel: [...ids].sort(), unitMinor, label: labels.join(", ") };
}

/** Variant choices that carry their own stock limit the quantity that can be ordered. */
export function variantLimit(p: { options?: OptionGroup[] }, sel: string[]): number | null {
  let lim: number | null = null;
  for (const g of p.options ?? []) for (const c of g.choices) if (sel.includes(c.id) && c.stock != null) lim = lim === null ? c.stock : Math.min(lim, c.stock);
  return lim;
}

export const hasRequiredOptions = (p: { options?: OptionGroup[] }) => (p.options ?? []).some((g) => g.required);
export const hasVariantStock = (p: { options?: OptionGroup[] }) => (p.options ?? []).some((g) => g.kind === "variant" && g.choices.some((c) => c.stock != null));

// ---------------- bundles ----------------
export type BundlePart = { productId: string; qty: number };

export function parseBundle(text: string): { ok: true; parts: BundlePart[] } | { ok: false; error: string } {
  const parts: BundlePart[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const m = /^(\d{1,2})\s*x\s*([A-Za-z0-9_-]{6,60})$/i.exec(line);
    if (!m) return { ok: false, error: 'Bundle lines look like "2 x <product id>". Copy the id from the product list.' };
    parts.push({ productId: m[2], qty: Number(m[1]) });
  }
  if (parts.length > 10) return { ok: false, error: "A bundle can have at most 10 parts." };
  return { ok: true, parts };
}

// ---------------- availability windows ----------------
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateAvailability(a: Availability): string | null {
  if (a.from && !TIME_RE.test(a.from)) return "Use times like 11:00.";
  if (a.to && !TIME_RE.test(a.to)) return "Use times like 15:30.";
  if ((a.from && !a.to) || (!a.from && a.to)) return "Give both a start and an end time, or neither.";
  if (a.days && a.days.some((d) => !DAYS.includes(d))) return "Unknown day.";
  return null;
}

function localNow(now: Date, tz: string): { day: Day; minutes: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return { day: get("weekday").slice(0, 3).toLowerCase() as Day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export const hasWindow = (a?: Availability) => Boolean(a && ((a.days && a.days.length) || (a.from && a.to)));

/** True when the item can be ordered at this moment. No window set means always. */
export function availableNow(a: Availability | undefined, now = new Date(), tz = APP_TIMEZONE): boolean {
  if (!hasWindow(a)) return true;
  const { day, minutes } = localNow(now, tz);
  if (a!.days?.length && !a!.days.includes(day)) return false;
  if (a!.from && a!.to) {
    const f = Number(a!.from.slice(0, 2)) * 60 + Number(a!.from.slice(3)), t = Number(a!.to.slice(0, 2)) * 60 + Number(a!.to.slice(3));
    return t > f ? minutes >= f && minutes < t : minutes >= f || minutes < t;
  }
  return true;
}

export function describeAvailability(a?: Availability): string {
  if (!hasWindow(a)) return "";
  const days = a!.days?.length && a!.days.length < 7 ? a!.days.map((d) => d[0].toUpperCase() + d.slice(1)).join(", ") : "Every day";
  return a!.from && a!.to ? `${days}, ${a!.from} to ${a!.to}` : days;
}

// ---------------- attributes (specification table) ----------------
export function parseAttributes(text: string): { ok: true; attrs: { name: string; value: string }[] } | { ok: false; error: string } {
  const attrs: { name: string; value: string }[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const i = line.indexOf(":");
    if (i < 1) return { ok: false, error: 'Details are written one per line like "Material: Cotton".' };
    const name = line.slice(0, i).trim(), value = line.slice(i + 1).trim();
    if (!name || !value || name.length > 40 || value.length > 120) return { ok: false, error: "Each detail needs a name (up to 40 characters) and a value (up to 120)." };
    attrs.push({ name, value });
  }
  if (attrs.length > 20) return { ok: false, error: "At most 20 details per product." };
  return { ok: true, attrs };
}
