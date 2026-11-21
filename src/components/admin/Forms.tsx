"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AdminState } from "@/app/s/[sub]/admin/actions";

export function Result({ state }: { state: AdminState }) {
  const [copied, setCopied] = useState(false);
  if (!state) return null;
  const link = state.link && typeof window !== "undefined" ? `${window.location.origin}${state.link}` : "";
  return (
    <div aria-live="polite" className="mt-3">
      {state.error && <p role="alert" className="err pop-in">{state.error}</p>}
      {state.message && <p role="status" className="ok pop-in">{state.message}</p>}
      {link && (
        <div className="pop-in mt-2 rounded-xl bg-slate-50 p-3 ring-1 ring-line">
          <input readOnly className="input font-mono text-xs" value={link} onFocus={(e) => e.currentTarget.select()} aria-label="One-time link" />
          <button type="button" className="btn btn-secondary mt-2" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied" : "Copy link"}</button>
        </div>
      )}
    </div>
  );
}

/**
 * A form wired to a server action. It submits manually so a failed submit keeps what the
 * person typed (React would otherwise clear the form); a successful one resets it.
 */
export function AF({ action, children, submit, secondary, className = "" }: { action: (p: AdminState, f: FormData) => Promise<AdminState>; children?: ReactNode; submit: string; secondary?: boolean; className?: string }) {
  const [state, setState] = useState<AdminState>();
  const [pending, start] = useTransition();
  return (
    <form
      className={className}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await action(undefined, fd);
          setState(r);
          if (r && !r.error && r.message) form.reset();
        });
      }}
    >
      {children}
      <button className={`btn ${secondary ? "btn-secondary" : "btn-primary"}`} disabled={pending}>{pending ? "Saving..." : submit}</button>
      <Result state={state} />
    </form>
  );
}

/** A button that runs one server action and shows what happened. */
export function ActionButton({ run, label, danger, secondary = true, confirmText }: { run: () => Promise<AdminState>; label: string; danger?: boolean; secondary?: boolean; confirmText?: string }) {
  const [state, setState] = useState<AdminState>();
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <span className="inline-block">
      <button
        className={`btn ${danger ? "btn-danger" : secondary ? "btn-secondary" : "btn-primary"}`}
        disabled={pending}
        onClick={() => {
          if (confirmText && !window.confirm(confirmText)) return;
          start(async () => { setState(await run()); router.refresh(); });
        }}
      >
        {pending ? "..." : label}
      </button>
      <Result state={state} />
    </span>
  );
}

export function FeatureSwitch({ id, name, on, requested, disabled, title, setFeature }: { id: string; name: string; on: boolean; requested: boolean; disabled: boolean; title?: string; setFeature: (id: string, value: boolean, cascade: boolean) => Promise<AdminState> }) {
  const [state, setState] = useState<AdminState>();
  const [pending, start] = useTransition();
  const [checked, setChecked] = useState(requested);
  const router = useRouter();
  const flip = (value: boolean, cascade = false) =>
    start(async () => {
      const r = await setFeature(id, value, cascade);
      setState(r);
      if (r?.error) setChecked(!value);
      router.refresh();
    });
  const needsCascade = state?.error && /Turn on|These features need/.test(state.error);
  return (
    <div>
      <label className="switch" title={title}>
        <input type="checkbox" aria-label={name} checked={checked} disabled={disabled || pending} onChange={(e) => { setChecked(e.target.checked); flip(e.target.checked); }} />
        <span className="track" /><span className="thumb" />
      </label>
      <span className="sr-only" aria-live="polite">{on ? "On" : "Off"}</span>
      {state?.error && (
        <p role="alert" className="err pop-in mt-1 max-w-xs">
          {state.error}{" "}
          {needsCascade && <button className="underline" onClick={() => { setChecked(requested); flip(!requested ? true : false, true); }}>{checked ? "Do it for me" : "Do it for me"}</button>}
        </p>
      )}
      {state?.message && <p className="ok pop-in mt-1 text-xs">{state.message}</p>}
    </div>
  );
}
