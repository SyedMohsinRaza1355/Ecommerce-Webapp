"use client";

import { useActionState } from "react";
import type { CheckoutState } from "../actions";

type Labels = Record<"contact" | "fullName" | "email" | "phone" | "address" | "city" | "notes" | "payment" | "payCard" | "payCod" | "discountCode" | "placeOrder", string>;

export default function CheckoutForm({
  action, idem, labels, card, cod, discounts,
}: {
  action: (p: CheckoutState, f: FormData) => Promise<CheckoutState>;
  idem: string;
  labels: Labels;
  card: boolean;
  cod: boolean;
  discounts: boolean;
}) {
  const [state, act, pending] = useActionState<CheckoutState, FormData>(action, undefined);
  const v = state?.values ?? {};
  const field = (name: string, label: string, props: Record<string, string | number | boolean> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input className="input" name={name} defaultValue={v[name] ?? ""} {...props} />
    </label>
  );
  return (
    <form action={act} className="space-y-6" noValidate>
      <input type="hidden" name="idem" value={idem} />
      <fieldset className="card">
        <legend className="px-1 font-extrabold">{labels.contact}</legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {field("name", labels.fullName, { autoComplete: "name", required: true })}
          {field("email", labels.email, { type: "email", autoComplete: "email", required: true, dir: "ltr" })}
          {field("phone", labels.phone, { type: "tel", autoComplete: "tel", required: true, dir: "ltr" })}
          {field("city", labels.city, { autoComplete: "address-level2", required: true })}
        </div>
        {field("address", labels.address, { autoComplete: "street-address", required: true })}
        {field("notes", labels.notes, { maxLength: 500 })}
      </fieldset>

      <fieldset className="card">
        <legend className="px-1 font-extrabold">{labels.payment}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {card && (
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-3 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50">
              <input type="radio" name="method" value="card" defaultChecked={(v.method ?? (card ? "card" : "cod")) === "card"} /> {labels.payCard}
            </label>
          )}
          {cod && (
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-3 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50">
              <input type="radio" name="method" value="cod" defaultChecked={(v.method ?? (card ? "card" : "cod")) === "cod"} /> {labels.payCod}
            </label>
          )}
        </div>
        {discounts && <div className="mt-4">{field("discountCode", labels.discountCode, { autoComplete: "off", maxLength: 30, dir: "ltr" })}</div>}
      </fieldset>

      <div aria-live="assertive">{state?.error && <p role="alert" className="err pop-in text-base">{state.error}</p>}</div>
      <button className="btn btn-primary w-full sm:w-auto" disabled={pending}>{pending ? "..." : labels.placeOrder}</button>
    </form>
  );
}
