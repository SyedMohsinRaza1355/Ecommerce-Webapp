import { guard } from "@/lib/commerce/guard";
import { tenantDb } from "@/lib/tenant/schema";
import { listGiftCards, loyaltyOf } from "@/lib/commerce/rewards";
import { formatMajor, money } from "@/lib/money/money";
import { fmtDate, fmtMoney } from "@/lib/i18n";
import { AF, ActionButton } from "@/components/admin/Forms";
import { rewardsSettingsAction, giftCardAction, giftCardOpAction, creditAction, customerGroupAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Rewards" };

type Cust = { _id: string; name: string; email: string; points?: number; creditMinor?: number; groupId?: string; createdAt: Date };

export default async function RewardsPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "promotions.manage");
  const s = store.settings, cur = s.currency;
  const [cards, custs] = await Promise.all([
    listGiftCards(store.ctx),
    (await tenantDb(store.ctx)).collection("customers").find({ instanceId: store.ctx.instanceId } as never).sort({ createdAt: -1 }).limit(60).toArray() as unknown as Promise<Cust[]>,
  ]);
  const L = loyaltyOf(s);
  const m = (n: number) => fmtMoney(n, cur, "en");
  const on = (id: string) => store.eff.get(id)?.enabled === true;
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Rewards</h1>
        <p className="text-muted">Loyalty points, customer groups, referrals, gift cards and store credit. Customers use gift cards, credit and points at checkout, and whatever is left is paid the usual way.</p>
      </div>

      <section className="card" aria-labelledby="rs">
        <h2 id="rs" className="text-lg font-extrabold">Programme settings</h2>
        <AF action={rewardsSettingsAction.bind(null, sub)} submit="Save settings" className="mt-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="loyaltyOn" defaultChecked={on("F-050")} /> Loyalty points: customers earn points on completed orders</label>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <label className="field"><span>Points earned for every {m(10000)} spent</span><input className="input" name="earnPer100" defaultValue={String(L.earnPer100)} inputMode="decimal" dir="ltr" /></label>
            <label className="field"><span>One point is worth ({cur})</span><input className="input" name="pointValue" defaultValue={formatMajor(money(L.pointMinor, cur))} inputMode="decimal" dir="ltr" /></label>
          </div>
          <label className="field"><span>Referral reward ({cur}), for both the new customer and the friend (empty = off)</span><input className="input w-40" name="referral" defaultValue={s.referral?.rewardMinor ? formatMajor(money(s.referral.rewardMinor, cur)) : ""} inputMode="decimal" dir="ltr" /></label>
          <label className="field"><span>Customer groups, one per line: Name | percent off</span><textarea className="input min-h-20" name="groups" dir="ltr" placeholder={"VIP | 10\nStudents | 5"} defaultValue={(s.groups ?? []).map((g) => `${g.name} | ${g.percentBps / 100}`).join(String.fromCharCode(10))} /></label>
        </AF>
      </section>

      <section className="card" aria-labelledby="gc">
        <h2 id="gc" className="text-lg font-extrabold">Gift cards</h2>
        <p className="text-sm text-muted">Issue a card after the customer has paid you (in the shop, by bank transfer, anywhere). Give them the code.</p>
        <AF action={giftCardAction.bind(null, sub)} submit="Issue gift card" className="mt-3">
          <div className="grid gap-x-4 sm:grid-cols-3">
            <label className="field"><span>Amount ({cur})</span><input className="input" name="amount" required inputMode="decimal" dir="ltr" placeholder="1000" /></label>
            <label className="field"><span>Note (optional)</span><input className="input" name="note" maxLength={80} placeholder="Birthday gift for Ali" /></label>
            <label className="field"><span>Expires (optional)</span><input className="input" type="datetime-local" name="expiresAt" /></label>
          </div>
        </AF>
        <div className="mt-4 overflow-x-auto">
          <table className="table">
            <thead><tr><th>Code</th><th>Balance</th><th>Issued</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {cards.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">No gift cards yet.</td></tr>}
              {cards.map((c) => (
                <tr key={c._id}>
                  <td className="font-mono" dir="ltr">{c.code}<p className="text-xs font-sans text-muted">{c.note}</p></td>
                  <td>{m(c.balanceMinor)} <span className="text-xs text-muted">of {m(c.initialMinor)}</span></td>
                  <td className="text-xs">{fmtDate(c.createdAt, "en")}{c.expiresAt ? `, expires ${fmtDate(c.expiresAt, "en")}` : ""}</td>
                  <td><span className={`badge ${c.active && c.balanceMinor > 0 ? "badge-green" : "badge-slate"}`}>{!c.active ? "Off" : c.balanceMinor > 0 ? "Active" : "Used up"}</span></td>
                  <td className="text-end"><ActionButton label={c.active ? "Turn off" : "Turn on"} run={giftCardOpAction.bind(null, sub, c._id, !c.active)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="cu">
        <h2 id="cu" className="text-lg font-extrabold">Customers</h2>
        <p className="text-sm text-muted">Add or remove store credit (for example a refund to credit or an apology), and put customers in groups. Use a minus sign to take credit away.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="table">
            <thead><tr><th>Customer</th><th>Points</th><th>Credit</th><th>Add credit</th><th>Group</th></tr></thead>
            <tbody>
              {custs.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">No customers have signed up yet.</td></tr>}
              {custs.map((c) => (
                <tr key={c._id}>
                  <td className="font-semibold">{c.name}<p className="text-xs font-normal text-muted" dir="ltr">{c.email}</p></td>
                  <td>{c.points ?? 0}</td>
                  <td>{m(c.creditMinor ?? 0)}</td>
                  <td>
                    <AF action={creditAction.bind(null, sub, c._id)} submit="Add" secondary className="flex items-end gap-2">
                      <input className="input w-24" name="amount" aria-label={`Credit for ${c.name}`} inputMode="decimal" dir="ltr" placeholder="200" />
                      <input className="input w-32" name="reason" aria-label="Reason" placeholder="Reason" maxLength={80} />
                    </AF>
                  </td>
                  <td>
                    <AF action={customerGroupAction.bind(null, sub, c._id)} submit="Set" secondary className="flex items-end gap-2">
                      <select className="input w-32" name="group" aria-label={`Group for ${c.name}`} defaultValue={c.groupId ?? ""}><option value="">None</option>{(s.groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
                    </AF>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
