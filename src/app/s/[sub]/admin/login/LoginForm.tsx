"use client";

import { useActionState } from "react";
import { loginAction, type AdminState } from "../actions";

export default function LoginForm({ sub }: { sub: string }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(loginAction.bind(null, sub), undefined);
  const need2fa = state?.fields?.need2fa === "1";
  return (
    <form action={action} noValidate>
      <label className="field"><span>Email</span><input className="input" name="email" type="email" autoComplete="username" required dir="ltr" /></label>
      <label className="field"><span>Password</span><input className="input" name="password" type="password" autoComplete="current-password" required /></label>
      {need2fa && (
        <label className="field pop-in"><span>6-digit code</span><input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus dir="ltr" /></label>
      )}
      {state?.error && <p role="alert" className="err mb-3 pop-in">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Signing in..." : "Sign in"}</button>
    </form>
  );
}
