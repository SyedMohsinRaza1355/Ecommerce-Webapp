"use client";

import { useActionState } from "react";
import { acceptInviteAction, type AcceptState } from "./actions";

export default function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInviteAction.bind(null, token), undefined);
  return (
    <form action={action} noValidate>
      <label className="field">
        <span>Choose a password</span>
        <input className="input" name="password" type="password" autoComplete="new-password" required />
        <p className="hint">At least 10 characters with letters and numbers.</p>
      </label>
      <label className="field">
        <span>Repeat password</span>
        <input className="input" name="confirm" type="password" autoComplete="new-password" required />
      </label>
      {state?.error && <p role="alert" className="err mb-3 pop-in">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Saving..." : "Set password and continue"}</button>
    </form>
  );
}
