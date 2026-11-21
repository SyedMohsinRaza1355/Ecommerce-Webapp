"use client";

import { useState, useTransition } from "react";
import { loginAction, type AdminState } from "../actions";

export default function LoginForm({ sub }: { sub: string }) {
  const [state, setState] = useState<AdminState>();
  const [pending, start] = useTransition();
  const need2fa = state?.fields?.need2fa === "1";
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => setState(await loginAction(sub, undefined, fd)));
      }}
    >
      <label className="field"><span>Email</span><input className="input" name="email" type="email" autoComplete="username" required dir="ltr" /></label>
      <label className="field"><span>Password</span><input className="input" name="password" type="password" autoComplete="current-password" required /></label>
      {need2fa && (
        <label className="field pop-in"><span>6-digit code</span><input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus dir="ltr" /></label>
      )}
      <div aria-live="polite">{state?.error && <p role="alert" className="err mb-3 pop-in">{state.error}</p>}</div>
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Signing in..." : "Sign in"}</button>
    </form>
  );
}
