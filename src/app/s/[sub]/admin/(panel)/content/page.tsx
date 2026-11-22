import { guard } from "@/lib/commerce/guard";
import { listPages } from "@/lib/commerce/extras";
import { AF, ActionButton } from "@/components/admin/Forms";
import { announcementAction, pageAction, pageDeleteAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Content" };

export default async function ContentPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "branding.edit");
  const pages = await listPages(store.ctx);
  const pagesOn = store.eff.get("F-078")?.enabled !== false;
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Content</h1>
        <p className="text-muted">The banner and extra pages of your store, like About us or Delivery policy.</p>
      </div>

      <section className="card" aria-labelledby="an">
        <h2 id="an" className="text-lg font-extrabold">Announcement bar</h2>
        {store.eff.get("F-061")?.enabled === false ? <p className="mt-2 text-sm text-muted">Turned off in Features.</p> : (
          <AF action={announcementAction.bind(null, sub)} submit="Save announcement" className="mt-3">
            <label className="field"><span>Message shown at the top of every page</span>
              <input className="input" name="announcement" defaultValue={store.settings.announcement ?? ""} maxLength={160} placeholder="e.g. Free delivery on orders over 2000 this week" />
              <p className="hint">Leave empty to hide it.</p>
            </label>
          </AF>
        )}
      </section>

      <section className="card" aria-labelledby="pg">
        <h2 id="pg" className="text-lg font-extrabold">Pages</h2>
        {!pagesOn ? <p className="mt-2 text-sm text-muted">Custom pages are turned off in Features.</p> : (
          <>
            {pages.length > 0 && (
              <ul className="mt-3 space-y-3">
                {pages.map((p) => (
                  <li key={p._id} className="rounded-xl p-3 ring-1 ring-line">
                    <details>
                      <summary className="cursor-pointer font-semibold">{p.title} <span className={`badge ms-2 ${p.published ? "badge-green" : "badge-slate"}`}>{p.published ? "Published" : "Draft"}</span> <span className="text-xs text-muted" dir="ltr">/p/{p.slug}</span></summary>
                      <AF action={pageAction.bind(null, sub, p._id)} submit="Save page" className="mt-3">
                        <PageFields p={p} />
                      </AF>
                      <div className="mt-2"><ActionButton label="Delete page" danger confirmText="Delete this page?" run={pageDeleteAction.bind(null, sub, p._id)} /></div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="mt-5 font-extrabold">Add a page</h3>
            <AF action={pageAction.bind(null, sub, null)} submit="Create page" className="mt-2"><PageFields /></AF>
          </>
        )}
      </section>
    </div>
  );
}

function PageFields({ p }: { p?: { title: string; slug: string; body: string; published: boolean; inFooter: boolean } }) {
  return (
    <>
      <label className="field"><span>Title</span><input className="input" name="title" defaultValue={p?.title} required maxLength={80} /></label>
      <label className="field"><span>Web address (optional)</span><input className="input" name="slug" defaultValue={p?.slug} maxLength={60} dir="ltr" placeholder="about-us" /></label>
      <label className="field"><span>Text</span><textarea className="input min-h-40" name="body" defaultValue={p?.body} maxLength={20000} /><p className="hint">Plain text. A blank line starts a new paragraph.</p></label>
      <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" name="published" defaultChecked={p?.published ?? true} /> Published</label>
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" name="inFooter" defaultChecked={p?.inFooter ?? true} /> Show a link in the footer</label>
    </>
  );
}
