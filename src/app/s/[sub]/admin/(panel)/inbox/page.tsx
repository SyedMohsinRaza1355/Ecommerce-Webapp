import { guard } from "@/lib/commerce/guard";
import { tenantDb } from "@/lib/tenant/schema";
import { fmtDate } from "@/lib/i18n";
import { ActionButton } from "@/components/admin/Forms";
import { reviewModerateAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "catalog.manage");
  const db = await tenantDb(store.ctx);
  const f = { instanceId: store.ctx.instanceId };
  const [msgs, subs, reviews] = await Promise.all([
    db.collection("contact_messages").find(f).sort({ createdAt: -1 }).limit(50).toArray(),
    db.collection("newsletter").countDocuments(f),
    db.collection("reviews").find(f).sort({ createdAt: -1 }).limit(50).toArray(),
  ]);
  const names = new Map((await db.collection("products").find({ ...f, _id: { $in: reviews.map((r) => r.productId) } as never }).project({ name: 1 }).toArray()).map((p) => [String(p._id), String(p.name)]));
  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Inbox</h1>
        <p className="text-muted">Messages from customers, reviews waiting to be checked, and your newsletter list.</p>
      </div>

      <section className="card" aria-labelledby="cm">
        <h2 id="cm" className="text-lg font-extrabold">Contact form messages</h2>
        {store.eff.get("F-080")?.enabled === false ? <p className="mt-2 text-sm text-muted">The contact form is turned off in Features.</p> : msgs.length === 0 ? <p className="mt-2 text-sm text-muted">No messages yet.</p> : (
          <ul className="mt-3 space-y-3">
            {msgs.map((m) => (
              <li key={String(m._id)} className="rounded-xl p-3 ring-1 ring-line">
                <p className="text-sm"><strong>{m.name}</strong> <a className="underline" href={`mailto:${encodeURIComponent(String(m.email))}`} dir="ltr">{m.email}</a> <span className="text-xs text-muted">{fmtDate(m.createdAt, "en")}</span></p>
                <p className="mt-1 whitespace-pre-line text-sm">{m.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="rv">
        <h2 id="rv" className="text-lg font-extrabold">Product reviews</h2>
        {store.eff.get("F-009")?.enabled !== true ? <p className="mt-2 text-sm text-muted">Reviews are off. Turn on &quot;Product reviews and ratings&quot; in Features.</p> : reviews.length === 0 ? <p className="mt-2 text-sm text-muted">No reviews yet.</p> : (
          <ul className="mt-3 space-y-3">
            {reviews.map((r) => (
              <li key={String(r._id)} className="rounded-xl p-3 ring-1 ring-line">
                <p className="text-sm"><strong>{names.get(String(r.productId)) ?? "Product"}</strong> <span aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span> <span className="text-muted">by {r.name}{r.verifiedBuyer ? " (bought it)" : ""}</span> <span className={`badge ms-1 ${r.status === "published" ? "badge-green" : "badge-slate"}`}>{r.status}</span></p>
                {r.text && <p className="mt-1 whitespace-pre-line text-sm">{r.text}</p>}
                <div className="mt-2 flex gap-2">
                  <ActionButton label={r.status === "published" ? "Hide" : "Show"} run={reviewModerateAction.bind(null, sub, String(r._id), r.status === "published" ? "hidden" : "published")} />
                  <ActionButton label="Delete" danger confirmText="Delete this review?" run={reviewModerateAction.bind(null, sub, String(r._id), "deleted")} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="nl">
        <h2 id="nl" className="text-lg font-extrabold">Newsletter</h2>
        {store.eff.get("F-058")?.enabled !== true ? <p className="mt-2 text-sm text-muted">Turn on &quot;Newsletter signup&quot; in Features to collect email addresses.</p> : (
          <p className="mt-2 text-sm">{subs} subscriber{subs === 1 ? "" : "s"}. <a className="underline" href={`/s/${sub}/admin/export/newsletter`}>Download the list (CSV)</a></p>
        )}
      </section>
    </div>
  );
}
