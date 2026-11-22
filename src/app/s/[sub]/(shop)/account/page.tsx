import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { currentCustomer, ordersOf } from "@/lib/commerce/customers";
import { trackingTokenFor } from "@/lib/commerce/orders";
import { fmtDate, fmtMoney } from "@/lib/i18n";
import AcctForm from "@/components/store/AcctForm";
import { reorderAction } from "../actions";
import { addAddressAction, deleteAccountAction, logoutAction, profileAction, removeAddressAction, verifyEmailAction } from "./actions";

export const metadata = { title: "My account", robots: { index: false } };

export default async function Account({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { sub } = await params;
  const { sent } = await searchParams;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-045")?.enabled === false) notFound();
  const c = await currentCustomer(s);
  if (!c) redirect(`/s/${sub}/account/login`);
  const base = `/s/${sub}`;
  const L = s.locale;
  const history = s.eff.get("F-047")?.enabled !== false ? await ordersOf(s.ctx, c) : [];
  const addrOn = s.eff.get("F-046")?.enabled !== false;
  const wishOn = s.eff.get("F-048")?.enabled === true;
  const privacyOn = s.eff.get("F-051")?.enabled !== false;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Hello, {c.name.split(" ")[0]}</h1>
          <p className="text-muted" dir="ltr">{c.email}</p>
        </div>
        <div className="flex gap-2">
          {wishOn && <Link href={`${base}/account/wishlist`} className="btn btn-secondary">Wishlist ({c.wishlist.length})</Link>}
          <form action={logoutAction.bind(null, sub)}><button className="btn btn-secondary">Sign out</button></form>
        </div>
      </div>

      {!c.emailVerified && (
        <div role="status" className="card border-amber-300 bg-amber-50">
          <p className="font-semibold">Verify your email to see orders you placed before creating this account.</p>
          {sent ? <p className="ok mt-2">We sent you a link. Open it to verify.</p> : <form action={verifyEmailAction.bind(null, sub)} className="mt-2"><button className="btn btn-secondary">Email me a verification link</button></form>}
        </div>
      )}

      {s.eff.get("F-047")?.enabled !== false && (
        <section className="card" aria-labelledby="oh">
          <h2 id="oh" className="text-lg font-extrabold">My orders</h2>
          {history.length === 0 ? <p className="mt-2 text-muted">No orders yet. <Link href={`${base}/products`} className="underline">Start shopping</Link></p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th><th><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {history.map((o) => (
                    <tr key={o._id}>
                      <td>#{o.orderNo}</td><td className="whitespace-nowrap text-xs">{fmtDate(o.createdAt, L)}</td>
                      <td><span className="badge badge-indigo">{o.state}</span></td><td>{fmtMoney(o.totalMinor, o.currency, L)}</td>
                      <td className="whitespace-nowrap"><Link className="underline" href={`${base}/order/${trackingTokenFor(s.ctx.instanceId, o._id)}`}>Track</Link><form action={reorderAction.bind(null, sub, o._id)} className="ms-3 inline"><button className="underline">Order again</button></form></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card" aria-labelledby="ph">
          <h2 id="ph" className="text-lg font-extrabold">My details</h2>
          <div className="mt-3">
            <AcctForm action={profileAction.bind(null, sub)} submit="Save" initial={{ name: c.name, phone: c.phone ?? "" }} fields={[
              { name: "name", label: "Full name", required: true, maxLength: 100 },
              { name: "phone", label: "Phone", type: "tel", dir: "ltr" },
            ]} />
          </div>
        </section>

        {addrOn && (
          <section className="card" aria-labelledby="ah">
            <h2 id="ah" className="text-lg font-extrabold">Saved addresses</h2>
            <ul className="mt-3 space-y-2">
              {c.addresses.length === 0 && <li className="text-sm text-muted">No saved addresses yet. The first one is used to fill in checkout for you.</li>}
              {c.addresses.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-2 rounded-xl p-3 ring-1 ring-line">
                  <p className="text-sm"><strong>{a.label}</strong><br />{a.address}, {a.city}{a.phone ? <><br />{a.phone}</> : null}</p>
                  <form action={removeAddressAction.bind(null, sub, a.id)}><button className="text-sm underline" aria-label={`Remove address ${a.label}`}>Remove</button></form>
                </li>
              ))}
            </ul>
            <details className="mt-3">
              <summary className="cursor-pointer font-semibold">Add an address</summary>
              <div className="mt-2">
                <AcctForm action={addAddressAction.bind(null, sub)} submit="Save address" fields={[
                  { name: "label", label: "Name (Home, Office)", maxLength: 30 },
                  { name: "address", label: "Address", required: true, maxLength: 300 },
                  { name: "city", label: "City", required: true, maxLength: 80 },
                  { name: "phone", label: "Phone", type: "tel", dir: "ltr" },
                ]} />
              </div>
            </details>
          </section>
        )}
      </div>

      {privacyOn && (
        <section className="card" aria-labelledby="dh">
          <h2 id="dh" className="text-lg font-extrabold">Your data</h2>
          <p className="mt-1 text-sm text-muted">Download everything we hold about you, or delete your account.</p>
          <p className="mt-3"><a className="btn btn-secondary" href={`${base}/account/export`}>Download my data</a></p>
          <details className="mt-4">
            <summary className="cursor-pointer font-semibold text-red-700">Delete my account</summary>
            <p className="my-2 text-sm text-muted">This removes your account and personal details from your orders. Order totals are kept for the store&apos;s accounting. It cannot be undone.</p>
            <AcctForm action={deleteAccountAction.bind(null, sub)} submit="Delete my account permanently" fields={[{ name: "confirm", label: "Type DELETE to confirm", autoComplete: "off" }]} />
          </details>
        </section>
      )}
    </div>
  );
}
