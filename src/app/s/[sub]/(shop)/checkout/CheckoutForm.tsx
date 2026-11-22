"use client";

import { useActionState, useEffect, useRef } from "react";
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
  action, idem, labels, methods, discounts, prefill, total,
}: {
  action: (p: CheckoutState, f: FormData) => Promise<CheckoutState>;
  idem: string;
  labels: Labels;
  methods: CheckoutMethod[];
  discounts: boolean;
  prefill?: Record<string, string>;
  total: string;
}) {
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
          {methods.map((m) => (
            <label key={m.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50">
              <input className="mt-1" type="radio" name="method" value={m.id} defaultChecked={(v.method ?? methods[0]?.id) === m.id} />
              <span>{m.label}{m.hint && <span className="block text-xs text-muted">{m.hint}</span>}</span>
            </label>
          ))}
        </div>
        {discounts && <div className="mt-4">{field("discountCode", labels.discountCode, { autoComplete: "off", maxLength: 30, dir: "ltr" })}</div>}
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
