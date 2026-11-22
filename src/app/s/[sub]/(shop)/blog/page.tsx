import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { listPages } from "@/lib/commerce/extras";
import { fmtDate } from "@/lib/i18n";

export const metadata = { title: "Blog" };

export default async function Blog({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-079")?.enabled !== true || s.eff.get("F-078")?.enabled === false) notFound();
  const posts = await listPages(s.ctx, true, "post");
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-extrabold tracking-tight">Blog</h1>
      {posts.length === 0 ? <p className="mt-4 text-muted">No posts yet.</p> : (
        <ul className="mt-6 space-y-4">
          {posts.map((p) => (
            <li key={p._id} className="card">
              <h2 className="text-xl font-bold"><Link className="underline" href={`/s/${sub}/p/${p.slug}`}>{p.title}</Link></h2>
              {p.createdAt && <p className="text-xs text-muted">{fmtDate(p.createdAt, s.locale)}</p>}
              <p className="mt-2 text-sm text-muted urdu-line">{p.body.replace(/\s+/g, " ").slice(0, 180)}{p.body.length > 180 ? "..." : ""}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
