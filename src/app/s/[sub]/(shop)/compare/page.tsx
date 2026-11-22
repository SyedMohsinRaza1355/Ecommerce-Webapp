import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { products } from "@/lib/commerce/store";
import { ProductImage } from "@/components/store/ProductCard";
import { fmtMoney } from "@/lib/i18n";
import { toggleCompareAction } from "../actions";

export const metadata = { title: "Compare products" };

export default async function Compare({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-122")?.enabled !== true) notFound();
  const ids = ((await cookies()).get(`cmp_${s.instance._id}`)?.value ?? "").split(",").filter(Boolean).slice(0, 4);
  const items = ids.length ? await products.find(s.ctx, { _id: { $in: ids }, status: "published" } as never, 4) : [];
  const names = [...new Set(items.flatMap((p) => (p.attributes ?? []).map((a) => a.name)))];
  const base = `/s/${sub}`;
  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight">Compare products</h1>
      {items.length < 2 ? <p className="mt-4 text-muted">Pick at least two products to compare: open a product and press Compare. <Link className="underline" href={`${base}/products`}>Browse products</Link></p> : (
        <div className="mt-6 overflow-x-auto">
          <table className="table min-w-[32rem]">
            <thead><tr><th><span className="sr-only">Detail</span></th>{items.map((p) => (
              <th key={p._id} className="align-top"><div className="w-36"><ProductImage p={p} /><Link href={`${base}/product/${p.slug}`} className="mt-2 block font-bold underline">{p.name}</Link>
                <form action={toggleCompareAction.bind(null, sub, p._id, `${base}/compare`)}><button className="mt-1 text-xs underline">Remove</button></form></div></th>
            ))}</tr></thead>
            <tbody>
              <tr><th scope="row" className="text-start">Price</th>{items.map((p) => <td key={p._id} className="font-bold">{fmtMoney(p.priceMinor, s.settings.currency, s.locale)}</td>)}</tr>
              {names.map((n) => <tr key={n}><th scope="row" className="text-start">{n}</th>{items.map((p) => <td key={p._id}>{p.attributes?.find((a) => a.name === n)?.value ?? "-"}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
