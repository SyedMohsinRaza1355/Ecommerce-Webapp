import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { currentCustomer } from "@/lib/commerce/customers";
import { products } from "@/lib/commerce/store";
import { ProductCard } from "@/components/store/ProductCard";

export const metadata = { title: "Wishlist", robots: { index: false } };

export default async function Wishlist({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-045")?.enabled === false || s.eff.get("F-048")?.enabled !== true) notFound();
  const c = await currentCustomer(s);
  if (!c) redirect(`/s/${sub}/account/login?next=${encodeURIComponent(`/s/${sub}/account/wishlist`)}`);
  const items = c.wishlist.length ? await products.find(s.ctx, { _id: { $in: c.wishlist }, status: "published" } as never, 100) : [];
  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight">My wishlist</h1>
      {items.length === 0 ? <p className="mt-4 text-muted">Nothing saved yet. Tap the heart on a product to keep it here. <Link href={`/s/${sub}/products`} className="underline">Browse products</Link></p> : (
        <ul className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((p, i) => <ProductCard key={p._id} p={p} base={`/s/${sub}`} currency={s.settings.currency} locale={s.locale} trackStock={s.feat.stockTracking} backorders={s.feat.backorders} delay={i} />)}
        </ul>
      )}
    </div>
  );
}
