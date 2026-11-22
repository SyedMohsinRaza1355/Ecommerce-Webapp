import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { getPageBySlug } from "@/lib/commerce/extras";

async function find(sub: string, slug: string) {
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-078")?.enabled === false) return null;
  const page = await getPageBySlug(s.ctx, slug);
  return page ? { s, page } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ sub: string; slug: string }> }) {
  const { sub, slug } = await params;
  const r = await find(sub, slug);
  return r ? { title: r.page.title, alternates: { canonical: `/s/${sub}/p/${slug}` } } : { title: "Not found" };
}

/** A store's own page (About, Delivery, Returns). The text is plain; nothing the owner types is ever run as HTML. */
export default async function CustomPage({ params }: { params: Promise<{ sub: string; slug: string }> }) {
  const { sub, slug } = await params;
  const r = await find(sub, slug);
  if (!r) notFound();
  const paragraphs = r.page.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <article className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-extrabold tracking-tight">{r.page.title}</h1>
      <div className="mt-4 space-y-4 leading-relaxed urdu-line">
        {paragraphs.map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}
      </div>
    </article>
  );
}
