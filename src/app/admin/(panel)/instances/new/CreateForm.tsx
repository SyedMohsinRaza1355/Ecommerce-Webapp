"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createStoreAction, type CreateState } from "./actions";

type Opt = { id: string; name: string; description?: string };
type Check = { state: "idle" | "checking" | "ok" | "bad"; reason?: string; suggestions?: string[] };

export default function CreateForm({ packs, plans, baseDomain }: { packs: Opt[]; plans: Opt[]; baseDomain: string }) {
  const [state, action, pending] = useActionState<CreateState, FormData>(createStoreAction, undefined);
  const [sub, setSub] = useState("");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // debounced availability check while typing (SA-02)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!sub) return;
    timer.current = setTimeout(async () => {
      setCheck({ state: "checking" });
      try {
        const res = await fetch(`/api/admin/subdomain-check?name=${encodeURIComponent(sub)}`);
        const j = await res.json();
        setCheck(j.ok ? { state: "ok" } : { state: "bad", reason: j.reason, suggestions: j.suggestions });
      } catch {
        setCheck({ state: "bad", reason: "Could not check right now." });
      }
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [sub]);

  if (state && "done" in state) {
    const link = typeof window !== "undefined" ? `${window.location.origin}${state.invitePath}` : state.invitePath;
    return (
      <div className="card pop-in">
        <div className="icon-chip">{"✓"}</div>
        <h2 className="mt-4 text-xl font-bold">{state.name} is ready</h2>
        <p className="mt-1 text-muted">The store, its database and its address ({state.subdomain}.{baseDomain}) have been created.</p>
        <div className="mt-5 rounded-xl bg-slate-50 p-4 ring-1 ring-line">
          <p className="text-sm font-semibold">One-time setup link for the owner</p>
          <p className="hint">It works once and expires at {new Date(state.expiresAt).toLocaleString()}. It is shown only now. Send it to the owner so they can choose their own password.</p>
          <input readOnly className="input mt-2 font-mono text-xs" value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Owner setup link" />
          <button
            className="btn btn-secondary mt-2"
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="btn btn-primary" href="/admin/instances">View all stores</Link>
          <Link className="btn btn-secondary" href={`/s/${state.subdomain}`} target="_blank">Preview the store</Link>
          <button type="button" className="btn btn-secondary" onClick={() => { router.push("/admin/instances/new"); router.refresh(); }}>Create another</button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="card" noValidate>
      <label className="field">
        <span>Store name</span>
        <input className="input" name="name" required minLength={2} maxLength={60} placeholder="Crispy Fried Chicken" />
      </label>

      <label className="field">
        <span>Web address</span>
        <div className="flex items-center gap-2">
          <input
            className="input"
            name="subdomain"
            value={sub}
            onChange={(e) => setSub(e.target.value.toLowerCase())}
            required
            autoComplete="off"
            placeholder="crispy-chicken"
            aria-describedby="sub-status"
          />
          <span className="whitespace-nowrap text-sm text-muted">.{baseDomain}</span>
        </div>
        <div id="sub-status" aria-live="polite" className="min-h-6">
          {check.state === "checking" && <p className="hint">Checking...</p>}
          {check.state === "ok" && <p className="ok pop-in">Available</p>}
          {check.state === "bad" && (
            <div className="pop-in">
              <p className="err">{check.reason}</p>
              {check.suggestions && check.suggestions.length > 0 && (
                <p className="hint">
                  Try:{" "}
                  {check.suggestions.map((s) => (
                    <button type="button" key={s} className="badge badge-indigo me-1 cursor-pointer" onClick={() => setSub(s)}>{s}</button>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>
      </label>

      <fieldset className="field">
        <span>Industry pack</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {packs.map((p, i) => (
            <label key={p.id} className="flex cursor-pointer gap-3 rounded-xl border border-line p-3 transition hover:border-indigo-300 hover:bg-indigo-50/40 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50">
              <input type="radio" name="packId" value={p.id} defaultChecked={i === 0} className="mt-1" />
              <span><strong className="block text-sm">{p.name}</strong><span className="text-xs text-muted">{p.description}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span>Plan</span>
          <select className="input" name="planId" defaultValue="growth">
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Owner email</span>
          <input className="input" name="ownerEmail" type="email" required placeholder="owner@example.com" />
        </label>
      </div>

      {state && "error" in state && (
        <p role="alert" className="err mb-3 pop-in">
          {state.error}
        </p>
      )}
      <button className="btn btn-primary" disabled={pending || check.state === "bad" || check.state === "checking"}>
        {pending ? "Creating the store..." : "Create store"}
      </button>
    </form>
  );
}
