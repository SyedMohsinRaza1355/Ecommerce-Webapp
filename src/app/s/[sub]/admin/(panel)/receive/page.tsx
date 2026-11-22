import { guard } from "@/lib/commerce/guard";
import { AF } from "@/components/admin/Forms";
import { ScanButton } from "@/components/admin/ScanButton";
import { receiveAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Receive stock" };

export default async function ReceivePage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  await guard(sub, "catalog.manage");
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Receive stock</h1>
      <p className="text-muted">When a delivery arrives, scan or type each product&apos;s code (SKU) and how many came. The number is added to the stock. A USB barcode scanner works too: scan, press Tab, type the count, press Enter.</p>
      <section className="card mt-5">
        <ScanButton target="code" />
        <AF action={receiveAction.bind(null, sub)} submit="Add to stock">
          <label className="field"><span>Product code (SKU)</span><input id="code" className="input" name="code" required maxLength={80} autoFocus autoComplete="off" dir="ltr" /></label>
          <label className="field"><span>How many arrived</span><input className="input w-32" name="qty" required inputMode="numeric" defaultValue="1" dir="ltr" /></label>
        </AF>
        <p className="hint mt-3">Codes are set on each product under More, in the SKU box.</p>
      </section>
    </div>
  );
}
