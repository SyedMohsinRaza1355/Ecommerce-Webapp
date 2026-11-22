import { guard } from "@/lib/commerce/guard";
import { authorize } from "@/lib/auth/rbac";
import { listBookings, localNow, DEFAULT_BOOKING } from "@/lib/commerce/operations";
import { AF, ActionButton } from "@/components/admin/Forms";
import { bookingOpAction, bookingSettingsAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Table bookings" };

const BADGE = { confirmed: "badge-green", cancelled: "badge-slate", seated: "badge-indigo", no_show: "badge-red" } as const;

export default async function BookingsPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store, staff } = await guard(sub, "orders.updateStatus");
  const owner = authorize(staff.actor, "settings.commerce", store.ctx).allow;
  const cfg = { ...DEFAULT_BOOKING, ...(store.settings.booking ?? {}) };
  const today = localNow(new Date()).date;
  const rows = await listBookings(store.ctx, today);
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r]);
  const on = store.eff.get("F-118")?.enabled === true;
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Table bookings</h1>
        <p className="text-muted">Upcoming bookings. Customers book from the &quot;Book a table&quot; button on your store. Each time slot has a limited number of tables.</p>
      </div>
      {rows.length === 0 && <div className="card text-center text-muted">No upcoming bookings.</div>}
      {[...byDay.entries()].map(([day, list]) => (
        <section key={day} className="card" aria-label={day}>
          <h2 className="font-extrabold">{day === today ? "Today" : day} <span className="text-sm font-normal text-muted">{list.filter((b) => b.status === "confirmed").reduce((n, b) => n + b.party, 0)} guests expected</span></h2>
          <ul className="mt-3 divide-y divide-line">
            {list.map((b) => (
              <li key={b._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold">{b.time}, {b.name}, party of {b.party} <span className={`badge ms-2 ${BADGE[b.status]}`}>{b.status.replace("_", " ")}</span></p>
                  <p className="text-xs text-muted"><span dir="ltr">{b.phone}</span>, <span dir="ltr">{b.email}</span>{b.note ? `, ${b.note}` : ""}</p>
                </div>
                {b.status === "confirmed" && (
                  <span className="flex flex-wrap gap-2">
                    <ActionButton label="Seated" run={bookingOpAction.bind(null, sub, b._id, "seated")} />
                    <ActionButton label="No show" run={bookingOpAction.bind(null, sub, b._id, "no_show")} />
                    <ActionButton label="Cancel" danger confirmText={`Cancel ${b.name}'s booking? They will be emailed.`} run={bookingOpAction.bind(null, sub, b._id, "cancelled")} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {owner && (
        <section className="card" aria-labelledby="bs">
          <h2 id="bs" className="text-lg font-extrabold">Booking settings</h2>
          <AF action={bookingSettingsAction.bind(null, sub)} submit="Save" className="mt-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="on" defaultChecked={on} /> Let customers book a table online</label>
            <div className="grid gap-x-4 sm:grid-cols-3">
              <label className="field"><span>Tables per time slot</span><input className="input" name="capacity" defaultValue={cfg.capacity} inputMode="numeric" dir="ltr" /></label>
              <label className="field"><span>Largest group</span><input className="input" name="maxParty" defaultValue={cfg.maxParty} inputMode="numeric" dir="ltr" /></label>
              <label className="field"><span>Slot length (minutes)</span><select className="input" name="slotMinutes" defaultValue={String(cfg.slotMinutes)}>{[30, 45, 60, 90, 120].map((n) => <option key={n}>{n}</option>)}</select></label>
              <label className="field"><span>First booking time</span><input className="input" name="from" defaultValue={cfg.from} dir="ltr" /></label>
              <label className="field"><span>Last booking time</span><input className="input" name="to" defaultValue={cfg.to} dir="ltr" /></label>
              <label className="field"><span>How many days ahead</span><input className="input" name="daysAhead" defaultValue={cfg.daysAhead} inputMode="numeric" dir="ltr" /></label>
            </div>
          </AF>
        </section>
      )}
    </div>
  );
}
