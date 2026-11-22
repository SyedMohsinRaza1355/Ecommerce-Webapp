import Link from "next/link";
import { guard } from "@/lib/commerce/guard";
import { products, categories } from "@/lib/commerce/store";
import { getPaymentConfig } from "@/lib/payments/config";
import { emailProvider } from "@/lib/email/send";
import { hasHours } from "@/lib/commerce/rules";
import { env } from "@/lib/env";

export const metadata = { title: "Setup guide" };

/** Step-by-step guide for a new store (F-112): each step says what to do, why, and links straight to it. */
export default async function StartPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "branding.edit");
  const b = `/s/${sub}/admin`;
  const [published, cats, pay] = await Promise.all([products.count(store.ctx, { status: "published" } as never), categories.count(store.ctx, {}), getPaymentConfig(store.ctx)]);
  const s = store.settings;
  const payReady = store.feat.cod || Boolean(pay.stripe) || pay.manual.some((m) => m.enabled);
  const steps = [
    { done: Boolean(s.branding.storeName) && Boolean(s.contactEmail), title: "Name your store and add a contact email", why: "Customers see these on their order page and in emails.", href: `${b}/settings` },
    { done: Boolean(s.branding.logoUrl), title: "Upload your logo", why: "Makes the store feel like yours.", href: `${b}/settings` },
    { done: cats > 0, title: "Create categories", why: "Helps shoppers find things (for example Burgers, Drinks).", href: `${b}/categories` },
    { done: published > 0, title: "Add and publish your first products", why: "Nothing can be ordered until at least one product is published.", href: `${b}/products/new` },
    { done: payReady, title: "Choose how you get paid", why: "Cash on delivery, Easypaisa, JazzCash, bank transfer or card.", href: `${b}/payments` },
    { done: s.shippingFlatMinor > 0 || s.freeShippingOverMinor !== null || s.zones?.length, title: "Set delivery fees", why: "So customers see the right total before they pay.", href: `${b}/settings` },
    { done: hasHours(s.hours), title: "Set opening hours (optional)", why: "Orders stop automatically when you are closed.", href: `${b}/setup` },
    { done: emailProvider() !== null, title: "Check that emails are sent", why: "Customers get order updates by email. Send yourself a test.", href: `${b}/emails` },
    { done: Boolean(s.returnNote), title: "Write a short returns note", why: "Shoppers feel safer buying when they can see your return rules.", href: `${b}/content` },
    { done: false, title: "Place a test order yourself", why: "Open your store, buy something, then cancel the order. This is the best way to find surprises before customers do.", href: `/s/${sub}` },
  ];
  const done = steps.filter((x) => x.done).length;
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Setup guide</h1>
      <p className="text-muted">{done} of {steps.length} steps done. Your store address: <code dir="ltr">{`${/^(localhost|127\.)/.test(env().baseDomain) ? "http" : "https"}://${env().baseDomain}/s/${sub}`}</code></p>
      <div className="mt-3 h-2 rounded-full bg-slate-200" aria-hidden="true"><div className="h-2 rounded-full" style={{ width: `${(done / steps.length) * 100}%`, background: "var(--grad)" }} /></div>
      <ol className="mt-6 space-y-3">
        {steps.map((x, i) => (
          <li key={x.title} className="card flex items-start gap-4">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${x.done ? "bg-emerald-600 text-white" : "bg-slate-200"}`} aria-hidden="true">{x.done ? "✓" : i + 1}</span>
            <div className="grow"><p className="font-bold">{x.title} {x.done && <span className="badge badge-green ms-1">Done</span>}</p><p className="text-sm text-muted">{x.why}</p></div>
            <Link href={x.href} className={`btn ${x.done ? "btn-secondary" : "btn-primary"}`}>{x.done ? "Review" : "Do it"}</Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
