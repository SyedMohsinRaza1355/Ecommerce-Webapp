"use client";

import { useActionState, useState } from "react";
import { inviteAction, planAction, statusAction, type ActionState } from "./actions";
import { impersonateAction, type SupportState } from "./support";

function Notice({ state }: { state: ActionState }) {
  if (!state) return null;
  if ("error" in state) return <p role="alert" className="err pop-in mt-2">{state.error}</p>;
  if ("message" in state) return <p role="status" className="ok pop-in mt-2">{state.message}</p>;
  return null;
}

export function StatusControl({ id, status }: { id: string; status: string }) {
  const to = status === "suspended" ? "active" : "suspended";
  const [state, action, pending] = useActionState<ActionState, FormData>(statusAction.bind(null, id, to), undefined);
  const [confirm, setConfirm] = useState(false);
  if (status !== "active" && status !== "suspended") return <p className="text-sm text-muted">Status cannot be changed while {status.replace(/_/g, " ")}.</p>;
  return (
    <form action={action}>
      {to === "suspended" && !confirm ? (
        <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>Suspend store</button>
      ) : to === "suspended" ? (
        <div className="pop-in">
          <p className="mb-2 text-sm">Customers will see a notice page and the owner loses access. Data is kept. Continue?</p>
          <button className="btn btn-danger" disabled={pending}>{pending ? "Suspending..." : "Yes, suspend"}</button>{" "}
          <button type="button" className="btn btn-secondary" onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn btn-primary" disabled={pending}>{pending ? "Reactivating..." : "Reactivate store"}</button>
      )}
      <Notice state={state} />
    </form>
  );
}

export function PlanControl({ id, planId, plans }: { id: string; planId: string; plans: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(planAction.bind(null, id), undefined);
  return (
    <form action={action}>
      <label className="field mb-2">
        <span>Plan</span>
        <select className="input" name="planId" defaultValue={planId}>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <button className="btn btn-secondary" disabled={pending}>{pending ? "Saving..." : "Change plan"}</button>
      <Notice state={state} />
    </form>
  );
}

export function InviteControl({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteAction.bind(null, id), undefined);
  const [copied, setCopied] = useState(false);
  const link = state && "inviteToken" in state && typeof window !== "undefined" ? `${window.location.origin}/invite/${state.inviteToken}` : "";
  return (
    <form action={action}>
      <label className="field mb-2">
        <span>Owner email</span>
        <input className="input" type="email" name="ownerEmail" required placeholder="owner@example.com" />
      </label>
      <button className="btn btn-secondary" disabled={pending}>{pending ? "Creating..." : "New setup link"}</button>
      <p className="hint">Creates a one-time link (valid for 1 hour). Earlier links stop working. No password is ever shown.</p>
      <Notice state={state} />
      {link && state && "inviteToken" in state && (
        <div className="pop-in mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-line">
          <input readOnly className="input font-mono text-xs" value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Owner setup link" />
          <p className="hint">Expires {new Date(state.expiresAt).toLocaleString()}. Shown only now.</p>
          <button
            type="button"
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
      )}
    </form>
  );
}

export function ImpersonateControl({ id }: { id: string }) {
  const [state, action, pending] = useActionState<SupportState, FormData>(impersonateAction.bind(null, id), undefined);
  return (
    <form action={action}>
      <label className="field mb-2">
        <span>Support ticket or reason</span>
        <input className="input" name="reason" required minLength={8} maxLength={300} placeholder="Ticket 1234: owner cannot see orders" />
      </label>
      <button className="btn btn-secondary" disabled={pending}>{pending ? "Starting..." : "Sign in as owner"}</button>
      <p className="hint">Lasts 30 minutes, shows a red banner, cannot change the owner&apos;s password, email or two-step settings. The owner is emailed and every page is logged.</p>
      {state?.error && <p role="alert" className="err pop-in mt-2">{state.error}</p>}
    </form>
  );
}
