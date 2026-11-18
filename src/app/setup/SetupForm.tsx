"use client";

import { useActionState } from "react";
import { setupAction, type SetupState } from "./actions";

export default function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, undefined);
  return (
    <form action={action} noValidate>
      <label className="field">
        <span>Setup key</span>
        <input className="input" name="setupKey" type="password" autoComplete="off" required />
        <p className="hint">The SETUP_KEY value from your server configuration.</p>
      </label>
      <label className="field">
        <span>Your email</span>
        <input className="input" name="email" type="email" autoComplete="username" required />
      </label>
      <label className="field">
        <span>Choose a password</span>
        <input className="input" name="password" type="password" autoComplete="new-password" required />
        <p className="hint">At least 10 characters with letters and numbers.</p>
      </label>
      <label className="field">
        <span>Repeat password</span>
        <input className="input" name="confirm" type="password" autoComplete="new-password" required />
      </label>
      {state?.error && <p role="alert" className="err mb-3">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Creating..." : "Create Super Admin"}</button>
    </form>
  );
}
