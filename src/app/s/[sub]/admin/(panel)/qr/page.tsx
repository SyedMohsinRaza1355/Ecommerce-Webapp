import QRCode from "qrcode";
import { guard } from "@/lib/commerce/guard";
import { originOf } from "@/lib/commerce/orders";

export const metadata = { title: "Table QR codes" };

/** Printable QR codes, one per table (F-016). Scanning one opens the menu with the table already filled in. */
export default async function QrPage({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<{ n?: string }> }) {
  const { sub } = await params;
  const { n } = await searchParams;
  const { store } = await guard(sub, "branding.edit");
  const count = Math.min(Math.max(parseInt(n ?? "10", 10) || 10, 1), 60);
  const tables = Array.from({ length: count }, (_, i) => String(i + 1));
  const svgs = await Promise.all(tables.map((t) => QRCode.toString(`${originOf()}/s/${sub}/t/${t}`, { type: "svg", margin: 1, width: 180, errorCorrectionLevel: "M" })));
  const name = store.settings.branding.storeName || store.instance.name;
  return (
    <div>
      <div className="print:hidden">
        <h1 className="text-2xl font-extrabold tracking-tight">Table QR codes</h1>
        <p className="text-muted">Print this page and put one code on each table. Customers scan it, see the menu and order to their table. Turn on &quot;Eat here&quot; in Store setup first.</p>
        <form method="get" className="card mt-4 flex flex-wrap items-end gap-3">
          <label className="field mb-0"><span>Number of tables</span><input className="input w-28" name="n" type="number" min={1} max={60} defaultValue={count} /></label>
          <button className="btn btn-secondary">Update</button>
        </form>
      </div>
      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
        {tables.map((t, i) => (
          <li key={t} className="card break-inside-avoid text-center">
            <div className="mx-auto w-40" role="img" aria-label={`QR code for table ${t}`} dangerouslySetInnerHTML={{ __html: svgs[i] }} />
            <p className="mt-1 text-lg font-extrabold">Table {t}</p>
            <p className="text-xs text-muted">{name}: scan to order</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
