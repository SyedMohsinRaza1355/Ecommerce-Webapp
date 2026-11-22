import { guard } from "@/lib/commerce/guard";
import { authorize } from "@/lib/auth/rbac";
import { AF } from "@/components/admin/Forms";
import { DAYS } from "@/lib/commerce/types";
import { formatMajor, money } from "@/lib/money/money";
import { hoursAction, zonesAction, lookAction } from "@/app/s/[sub]/admin/actions";

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
