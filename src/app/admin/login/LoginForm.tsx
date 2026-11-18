"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, undefined);
  return (
    <form action={action} noValidate>
      <label className="field">
        <span>Email</span>
        <input className="input" name="email" type="email" autoComplete="username" required />
      </label>
      <label className="field">
        <span>Password</span>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      {state?.error && <p role="alert" className="err mb-3">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Signing in..." : "Sign in"}</button>
    </form>
  );
}
