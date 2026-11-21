// WCAG contrast helpers for the brand colour guard (F-139, SRS section 12).
const HEX = /^#([0-9a-f]{6})$/i;

export function isHex(v: string): boolean {
  return HEX.test(v);
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  if (!isHex(hex)) throw new Error("Invalid colour");
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on the given background. */
export function readableTextOn(bg: string): "#ffffff" | "#0f172a" {
  return contrastRatio("#ffffff", bg) >= contrastRatio("#0f172a", bg) ? "#ffffff" : "#0f172a";
}

export type ContrastReport = { ratio: number; passesAA: boolean; text: string };

export function checkBrand(bg: string): ContrastReport {
  const text = readableTextOn(bg);
  const ratio = contrastRatio(text, bg);
  return { ratio: Math.round(ratio * 100) / 100, passesAA: ratio >= 4.5, text };
}

/** Darken a colour until white text on it reaches 4.5:1 (automatic palette fix). */
export function autoFixBrand(bg: string): string {
  if (!isHex(bg)) throw new Error("Invalid colour");
  let n = parseInt(bg.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  for (let i = 0; i < 60 && contrastRatio("#ffffff", toHex(r, g, b)) < 4.5; i++) {
    r = Math.floor(r * 0.93); g = Math.floor(g * 0.93); b = Math.floor(b * 0.93);
  }
  n = (r << 16) | (g << 8) | b;
  return "#" + n.toString(16).padStart(6, "0");
}

function toHex(r: number, g: number, b: number) {
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}
