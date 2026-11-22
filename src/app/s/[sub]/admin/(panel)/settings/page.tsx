import { guard } from "@/lib/commerce/guard";
import { authorize } from "@/lib/auth/rbac";
import { AF } from "@/components/admin/Forms";
import BrandPicker from "./BrandPicker";
import ImageUploader from "@/components/admin/ImageUploader";
import { brandingAction, commerceAction, uploadImageAction } from "@/app/s/[sub]/admin/actions";
import { formatMajor, money, CURRENCY_EXPONENT } from "@/lib/money/money";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store, staff } = await guard(sub, "branding.edit");
  const s = store.settings;
  const canCommerce = authorize(staff.actor, "settings.commerce", store.ctx).allow;
  const b = s.branding;
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
      <h2 className="mt-6 text-lg font-extrabold">Branding</h2>
      <AF action={brandingAction.bind(null, sub)} submit="Save branding" className="card mt-3">
        <label className="field"><span>Store name</span><input className="input" name="storeName" defaultValue={b.storeName || store.instance.name} required maxLength={60} /></label>
        <label className="field"><span>Tagline</span><input className="input" name="tagline" defaultValue={b.tagline} maxLength={120} /></label>
        <BrandPicker initial={b.primary} />
        <ImageUploader upload={uploadImageAction.bind(null, sub)} targetName="logoUrl" />
        <label className="field"><span>Logo link (https or uploaded)</span><input className="input" name="logoUrl" defaultValue={b.logoUrl} placeholder="https://..." dir="ltr" /></label>
        <label className="field"><span>Contact email</span><input className="input" name="contactEmail" type="email" defaultValue={s.contactEmail} dir="ltr" /><p className="hint">Shown to customers on their order page.</p></label>
        <label className="field"><span>Default language</span>
          <select className="input" name="locale" defaultValue={s.locale}><option value="en">English</option><option value="ur">اردو (Urdu, right to left)</option></select>
        </label>
      </AF>

      {canCommerce ? (
        <>
          <h2 className="mt-8 text-lg font-extrabold">Prices, tax and shipping</h2>
          <AF action={commerceAction.bind(null, sub)} submit="Save" className="card mt-3">
            <div className="grid gap-x-4 sm:grid-cols-2">
              <label className="field"><span>Currency</span>
                <select className="input" name="currency" defaultValue={s.currency}>{Object.keys(CURRENCY_EXPONENT).map((c) => <option key={c}>{c}</option>)}</select>
                <p className="hint">Changing it does not convert existing prices.</p>
              </label>
              <label className="field"><span>Tax (%)</span><input className="input" name="taxPercent" defaultValue={String(s.taxBps / 100)} inputMode="decimal" dir="ltr" /><p className="hint">Added on top of prices. Ask your accountant for the right rate.</p></label>
              <label className="field"><span>Flat shipping fee</span><input className="input" name="shipping" defaultValue={formatMajor(money(s.shippingFlatMinor, s.currency))} inputMode="decimal" dir="ltr" /></label>
              <label className="field"><span>Free shipping over (optional)</span><input className="input" name="freeOver" defaultValue={s.freeShippingOverMinor === null ? "" : formatMajor(money(s.freeShippingOverMinor, s.currency))} inputMode="decimal" dir="ltr" /></label>
            </div>
          </AF>
        </>
      ) : <p className="mt-6 text-sm text-muted">Prices, tax and shipping can only be changed by the store owner.</p>}
    </div>
  );
}
