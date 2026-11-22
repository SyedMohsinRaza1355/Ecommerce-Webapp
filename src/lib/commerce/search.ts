// Typo-tolerant product search for suggestions and "did you mean" (F-138). Pure and small: a store has
// at most a few hundred products, so ranking them in memory is fast and needs no search service.
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9؀-ۿ ]+/g, " ").replace(/\s+/g, " ").trim();

export type Hit = { name: string; slug: string; score: number };

/** Exact start beats word start beats contains beats a close spelling. Returns the best few. */
export function rankProducts(items: { name: string; slug: string }[], query: string, limit = 6): Hit[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const out: Hit[] = [];
  for (const it of items) {
    const n = norm(it.name);
    const words = n.split(" ");
    let score = 0;
    if (n.startsWith(q)) score = 100;
    else if (words.some((w) => w.startsWith(q))) score = 80;
    else if (n.includes(q)) score = 60;
    else {
      const allowed = q.length <= 4 ? 1 : q.length <= 8 ? 2 : 3;
      const best = Math.min(editDistance(q, n.slice(0, q.length), allowed), ...words.map((w) => editDistance(q, w, allowed)));
      if (best <= allowed) score = 40 - best * 10;
    }
    if (score > 0) out.push({ name: it.name, slug: it.slug, score });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}
