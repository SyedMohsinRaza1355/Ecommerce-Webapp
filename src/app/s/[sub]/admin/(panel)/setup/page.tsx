import { guard } from "@/lib/commerce/guard";
import { authorize } from "@/lib/auth/rbac";
import { AF } from "@/components/admin/Forms";
import { DAYS } from "@/lib/commerce/types";
import { formatMajor, money } from "@/lib/money/money";
import { hoursAction, zonesAction, lookAction, fulfilmentAction, homeAction, weightAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Store setup" };

const DAY_NAME = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" } as const;
const FONTS = { system: "Clean (default)", serif: "Classic serif", rounded: "Friendly rounded", mono: "Typewriter" } as const;

export default async function SetupPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store, staff } = await guard(sub, "branding.edit");
  const s = store.settings;
  const cur = s.currency;
  const owner = authorize(staff.actor, "settings.commerce", store.ctx).allow;
  const zonesText = (s.zones ?? []).map((z) => `${z.name} | ${formatMajor(money(z.feeMinor, cur))} | ${z.cities.join(", ")}`).join("\n");
  const hero = s.hero ?? [];
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Store setup</h1>
        <p className="text-muted">Opening hours, delivery fees by city, and the look of your home page.</p>
      </div>

      <section className="card" aria-labelledby="oh">
        <h2 id="oh" className="text-lg font-extrabold">Opening hours</h2>
        <p className="mt-1 text-sm text-muted">Customers can always browse. Outside these hours they cannot place orders. Times are in {process.env.APP_TIMEZONE || "Asia/Karachi"} time. Leave a day empty or tick Closed for days off.</p>
        <AF action={hoursAction.bind(null, sub)} submit="Save opening hours" className="mt-3">
          <div className="space-y-2">
            {DAYS.map((d) => (
              <div key={d} className="grid items-center gap-2 sm:grid-cols-[8rem_1fr_1fr_auto]">
                <span className="font-semibold">{DAY_NAME[d]}</span>
                <label className="sr-only" htmlFor={`o-${d}`}>{DAY_NAME[d]} opens</label>
                <input id={`o-${d}`} className="input" type="time" name={`open_${d}`} defaultValue={s.hours?.[d]?.open ?? ""} />
                <label className="sr-only" htmlFor={`c-${d}`}>{DAY_NAME[d]} closes</label>
                <input id={`c-${d}`} className="input" type="time" name={`close_${d}`} defaultValue={s.hours?.[d]?.close ?? ""} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`closed_${d}`} defaultChecked={s.hours ? s.hours[d] === null : false} /> Closed</label>
              </div>
            ))}
          </div>
          <label className="my-3 flex items-center gap-2 text-sm"><input type="checkbox" name="clear" /> Remove all hours (take orders at any time)</label>
        </AF>
      </section>

      <section className="card" aria-labelledby="dz">
        <h2 id="dz" className="text-lg font-extrabold">Delivery fee by city</h2>
        {owner ? (
          <>
            <p className="mt-1 text-sm text-muted">One zone per line: <code>Name | fee | city, city</code>. For example <code>Lahore | 150 | Lahore</code> and <code>Nearby | 300 | Gujranwala, Sheikhupura</code>. Cities not listed pay your normal flat fee. The free-shipping threshold still applies.</p>
            <AF action={zonesAction.bind(null, sub)} submit="Save delivery zones" className="mt-3">
              <label className="field"><span>Zones</span><textarea className="input min-h-28 font-mono text-sm" name="zones" defaultValue={zonesText} dir="ltr" placeholder="Lahore | 150 | Lahore" /></label>
            </AF>
          </>
        ) : <p className="mt-2 text-sm text-muted">Only the store owner can change delivery fees.</p>}
      </section>

      <section className="card" aria-labelledby="wt">
        <h2 id="wt" className="text-lg font-extrabold">Delivery fee by weight</h2>
        <p className="text-sm text-muted">Give products a weight (in the product&apos;s More section), then add steps here. An order up to that many grams adds the extra fee to the delivery charge. Example: 5000 | 150 means orders up to 5 kg add {formatMajor(money(15000, s.currency))} {s.currency}.</p>
        {owner ? (
          <AF action={weightAction.bind(null, sub)} submit="Save weight fees" className="mt-3">
            <label className="field"><span>One step per line: up to grams | extra fee</span><textarea className="input min-h-20" name="tiers" dir="ltr" placeholder={"1000 | 0\n5000 | 150\n20000 | 600"} defaultValue={(s.weightTiers ?? []).map((t) => `${t.upToGrams} | ${formatMajor(money(t.feeMinor, s.currency))}`).join(String.fromCharCode(10))} /></label>
          </AF>
        ) : <p className="mt-2 text-sm text-muted">Only the store owner can change this.</p>}
      </section>

      <section className="card" aria-labelledby="hs">
        <h2 id="hs" className="text-lg font-extrabold">Home page order</h2>
        {owner ? (
          <AF action={homeAction.bind(null, sub)} submit="Save order" className="mt-3">
            {(["s1", "s2", "s3"] as const).map((k, i) => {
              const cur = (s.homeSections?.length ? s.homeSections : ["trust", "categories", "featured"])[i] ?? "";
              return (
                <label key={k} className="field"><span>{["First", "Second", "Third"][i]} block</span>
                  <select className="input" name={k} defaultValue={cur}><option value="">(none)</option><option value="trust">Why shop here (delivery, secure, support)</option><option value="categories">Categories</option><option value="featured">Featured products</option></select>
                </label>
              );
            })}
          </AF>
        ) : <p className="mt-2 text-sm text-muted">Only the store owner can change this.</p>}
      </section>

      <section className="card" aria-labelledby="fu">
        <h2 id="fu" className="text-lg font-extrabold">How customers get their order</h2>
        {owner ? (
          <AF action={fulfilmentAction.bind(null, sub)} submit="Save ordering options" className="mt-3">
            <div className="space-y-1 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="delivery" defaultChecked={s.fulfilment?.delivery !== false} /> Delivery to the customer&apos;s address</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="pickup" defaultChecked={Boolean(s.fulfilment?.pickup)} /> Pickup (no delivery fee)</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="dineIn" defaultChecked={Boolean(s.fulfilment?.dineIn)} /> Eat here: order to a table by scanning a QR code (<a className="underline" href={`/s/${sub}/admin/qr`}>print QR codes</a>)</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="schedule" defaultChecked={store.eff.get("F-035")?.enabled === true} /> Let customers choose a time (up to 7 days ahead)</label>
            </div>
            <label className="field mt-3"><span>Pickup points (one per line: Name | Address)</span><textarea className="input min-h-20" name="locations" defaultValue={(s.locations ?? []).map((l) => `${l.name} | ${l.address}`).join(String.fromCharCode(10))} /></label>
            <label className="field"><span>Busy limit (optional)</span><input className="input w-32" name="maxActive" inputMode="numeric" dir="ltr" defaultValue={s.maxActive ? String(s.maxActive) : ""} /><p className="hint">When this many orders are being prepared, new same-time orders wait a little; customers can still schedule for later.</p></label>
          </AF>
        ) : <p className="mt-2 text-sm text-muted">Only the store owner can change this.</p>}
      </section>

      <section className="card" aria-labelledby="lk">
        <h2 id="lk" className="text-lg font-extrabold">Look and home page banner</h2>
        <AF action={lookAction.bind(null, sub)} submit="Save look" className="mt-3">
          <label className="field"><span>Font</span>
            <select className="input" name="font" defaultValue={s.font ?? "system"}>{Object.entries(FONTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <p className="hint mb-3">Banner slides appear at the top of your home page and change by themselves. Fill in up to three; leave all empty to use the simple default banner.</p>
          {[1, 2, 3].map((i) => {
            const h = hero[i - 1];
            return (
              <fieldset key={i} className="mb-4 rounded-xl p-3 ring-1 ring-line">
                <legend className="px-1 text-sm font-bold">Slide {i}</legend>
                <label className="field"><span>Title</span><input className="input" name={`title${i}`} defaultValue={h?.title} maxLength={80} /></label>
                <label className="field"><span>Text</span><input className="input" name={`text${i}`} defaultValue={h?.text} maxLength={200} /></label>
                <div className="grid gap-x-4 sm:grid-cols-2">
                  <label className="field"><span>Picture link (https)</span><input className="input" name={`image${i}`} defaultValue={h?.imageUrl} dir="ltr" placeholder="https://..." /></label>
                  <label className="field"><span>Button goes to</span><input className="input" name={`link${i}`} defaultValue={h?.link} dir="ltr" placeholder={`/s/${sub}/products`} /></label>
                </div>
              </fieldset>
            );
          })}
        </AF>
      </section>
    </div>
  );
}
