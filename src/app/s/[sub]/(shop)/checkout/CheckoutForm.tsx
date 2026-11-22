"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { CheckoutState } from "../actions";
import type { CheckoutMethod } from "@/lib/payments/config";

type Labels = Record<"contact" | "fullName" | "email" | "phone" | "address" | "city" | "notes" | "payment" | "discountCode" | "placeOrder", string>;

/** Works out which field an error message is about, so that field can be highlighted and focused. */
function fieldOf(error: string | undefined): string | null {
  if (!error) return null;
  const e = error.toLowerCase();
  if (e.includes("full name")) return "name";
  if (e.includes("email")) return "email";
  if (e.includes("phone")) return "phone";
  if (e.includes("address")) return "address";
  if (e.includes("city")) return "city";
  if (e.includes("notes")) return "notes";
  if (e.includes("discount") || e.includes("code")) return "discountCode";
  return null;
}

export default function CheckoutForm({
  action, idem, labels, methods, discounts, rewards, prefill, total, fulfil,
}: {
  action: (p: CheckoutState, f: FormData) => Promise<CheckoutState>;
  idem: string;
  labels: Labels;
  methods: CheckoutMethod[];
  discounts: boolean;
  /** what the shopper can pay with besides the chosen method (F-044, F-131, F-050) */
  rewards?: { gift: boolean; credit?: string; points?: { count: number; value: string } };
  prefill?: Record<string, string>;
  total: string;
  fulfil?: { types: ("delivery" | "pickup" | "dine_in")[]; locations: { id: string; name: string; address: string }[]; scheduling: boolean; defaultType: "delivery" | "pickup" | "dine_in"; table?: string };
}) {
  const [ftype, setFtype] = useState(fulfil?.defaultType ?? "delivery");
  const [sched, setSched] = useState("");
  const delivery = ftype === "delivery";
  const [state, act, pending] = useActionState<CheckoutState, FormData>(action, undefined);
  const v = state?.values ?? prefill ?? {};
  const bad = fieldOf(state?.error);
  const form = useRef<HTMLFormElement>(null);

  // after a failed submit, jump to the field that needs fixing
  useEffect(() => {
    if (bad) form.current?.querySelector<HTMLInputElement>(`[name="${bad}"]`)?.focus();
  }, [bad, state]);

  const field = (name: string, label: string, props: Record<string, string | number | boolean> = {}) => {
    const invalid = bad === name;
    return (
      <label className={`field ${invalid ? "field-error" : ""}`}>
        <span>{label}</span>
        <input className="input" name={name} defaultValue={v[name] ?? ""} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${name}-err` : undefined} {...props} />
        {invalid && <span id={`${name}-err`} className="field-msg">{state?.error}</span>}
      </label>
    );
  };
  return (
    <form ref={form} action={act} className="space-y-6" noValidate>
      <input type="hidden" name="idem" value={idem} />
      {fulfil && fulfil.types.length > 0 && (
        <fieldset className="card">
          <legend className="px-1 font-extrabold">How would you like it?</legend>
          <div className="flex flex-wrap gap-2">
            {fulfil.types.map((tp) => (
              <label key={tp} className="flex cursor-pointer items-center gap-2 rounded-xl border border-line px-4 py-2 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50">
                <input type="radio" name="ftype" value={tp} checked={ftype === tp} onChange={() => setFtype(tp)} /> {tp === "delivery" ? "Delivery" : tp === "pickup" ? "Pickup" : "Eat here (table)"}
              </label>
            ))}
          </div>
          {ftype === "pickup" && fulfil.locations.length > 0 && (
            <label className="field mt-3"><span>Pick up from</span>
              <select className="input" name="locationId" required>{fulfil.locations.map((l) => <option key={l.id} value={l.id}>{l.name}, {l.address}</option>)}</select>
            </label>
          )}
          {ftype === "dine_in" && <label className="field mt-3"><span>Table number</span><input className="input" name="table" defaultValue={fulfil.table ?? ""} maxLength={12} required /></label>}
          {fulfil.scheduling && (
            <label className="field mt-3"><span>Choose a time (optional)</span>
              <input className="input" type="datetime-local" value={sched} onChange={(e) => setSched(e.target.value)} />
              <p className="hint">Leave empty to get it as soon as possible.</p>
              <input type="hidden" name="scheduledFor" value={sched ? new Date(sched).toISOString() : ""} />
            </label>
          )}
        </fieldset>
      )}

      <fieldset className="card">
        <legend className="px-1 font-extrabold">{labels.contact}</legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {field("name", labels.fullName, { autoComplete: "name", required: true })}
          {field("email", labels.email, { type: "email", autoComplete: "email", required: true, dir: "ltr" })}
          {field("phone", labels.phone, { type: "tel", autoComplete: "tel", required: true, dir: "ltr" })}
          {delivery && field("city", labels.city, { autoComplete: "address-level2", required: true })}
        </div>
        {delivery && field("address", labels.address, { autoComplete: "street-address", required: true })}
        {field("notes", labels.notes, { maxLength: 500 })}
        <p className="hint -mt-2">We use your phone number only to reach you about this order.</p>
      </fieldset>

      <fieldset className="card">
        <legend className="px-1 font-extrabold">{labels.payment}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {methods.map((m) => (
            <label key={m.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50">
              <input className="mt-1" type="radio" name="method" value={m.id} defaultChecked={(v.method ?? methods[0]?.id) === m.id} />
              <span>{m.label}{m.hint && <span className="block text-xs text-muted">{m.hint}</span>}</span>
            </label>
          ))}
        </div>
        {discounts && <div className="mt-4">{field("discountCode", labels.discountCode, { autoComplete: "off", maxLength: 30, dir: "ltr" })}</div>}
        {rewards && (rewards.gift || rewards.credit || rewards.points) && (
          <fieldset className="mt-4 rounded-xl p-3 ring-1 ring-line">
            <legend className="px-1 text-sm font-bold">Pay with your balance</legend>
            {rewards.gift && <div>{field("giftCode", "Gift card code", { autoComplete: "off", maxLength: 20, dir: "ltr" })}</div>}
            {rewards.credit && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="useCredit" defaultChecked /> Use my store credit ({rewards.credit})</label>}
            {rewards.points && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="usePoints" /> Use my {rewards.points.count} points (worth {rewards.points.value})</label>}
            <p className="hint mt-2">Whatever your balance does not cover is paid with the method you choose below.</p>
          </fieldset>
        )}
      </fieldset>

      <div aria-live="assertive">{state?.error && !bad && <p role="alert" className="err pop-in text-base">{state.error}</p>}</div>
      {bad && <p role="alert" className="sr-only">{state?.error}</p>}
      <div className="max-md:fixed max-md:inset-x-0 max-md:bottom-14 max-md:z-20 max-md:flex max-md:items-center max-md:gap-3 max-md:border-t max-md:border-line max-md:bg-white/95 max-md:p-3 max-md:backdrop-blur">
        <p className="hidden shrink-0 text-lg font-extrabold max-md:block">{total}</p>
        <button className="btn btn-primary w-full sm:w-auto max-md:grow" disabled={pending}>{pending ? "..." : labels.placeOrder}</button>
      </div>
    </form>
  );
}
