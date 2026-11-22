"use client";

import { useActionState, type ReactNode } from "react";
import type { AcctState } from "@/app/s/[sub]/(shop)/account/actions";

export type Field = { name: string; label: string; type?: string; autoComplete?: string; required?: boolean; hint?: string; maxLength?: number; dir?: "ltr" | "rtl" };

/** A storefront form wired to a server action. Typed values come back after an error so nothing is lost. */
export default function AcctForm({ action, fields, submit, hidden = {}, initial = {}, children, secondary }: {
  action: (p: AcctState, f: FormData) => Promise<AcctState>;
  fields: Field[];
  submit: string;
  hidden?: Record<string, string>;
  initial?: Record<string, string>;
  children?: ReactNode;
  secondary?: boolean;
}) {
  const [state, act, pending] = useActionState<AcctState, FormData>(action, undefined);
  return (
    <form action={act} noValidate>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {fields.map((f) => (
        <label key={f.name} className="field">
          <span>{f.label}</span>
          <input className="input" name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} required={f.required} maxLength={f.maxLength} dir={f.dir} defaultValue={f.type === "password" ? "" : state?.values?.[f.name] ?? initial[f.name] ?? ""} />
          {f.hint && <p className="hint">{f.hint}</p>}
        </label>
      ))}
      {children}
      <div aria-live="polite">
        {state?.error && <p role="alert" className="err pop-in mb-3">{state.error}</p>}
        {state?.message && <p role="status" className="ok pop-in mb-3">{state.message}</p>}
      </div>
      <button className={`btn ${secondary ? "btn-secondary" : "btn-primary"}`} disabled={pending}>{pending ? "..." : submit}</button>
    </form>
  );
}
