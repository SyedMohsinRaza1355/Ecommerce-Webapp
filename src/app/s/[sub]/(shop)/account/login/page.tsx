import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { currentCustomer } from "@/lib/commerce/customers";
import AcctForm from "@/components/store/AcctForm";
import { loginAction, requestLinkAction } from "../actions";

export const metadata = { title: "Sign in", robots: { index: false } };

export default async function CustomerLogin({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<{ next?: string; expired?: string }> }) {
  const { sub } = await params;
  const { next = "", expired } = await searchParams;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-045")?.enabled === false) notFound();
  if (await currentCustomer(s)) redirect(`/s/${sub}/account`);
  const base = `/s/${sub}/account`;
  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="card pop-in">
        <h1 className="text-2xl font-extrabold">Sign in</h1>
        {expired && <p role="alert" className="err mt-2">That link has expired or was already used. Ask for a new one below.</p>}
        <div className="mt-4">
          <AcctForm action={loginAction.bind(null, sub)} submit="Sign in" hidden={{ next }} fields={[
            { name: "email", label: "Email", type: "email", autoComplete: "email", required: true, dir: "ltr" },
            { name: "password", label: "Password", type: "password", autoComplete: "current-password", required: true },
          ]} />
        </div>
        <p className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
          <Link href={`${base}/forgot`} className="underline">Forgot your password?</Link>
          <Link href={`${base}/register`} className="underline">Create an account</Link>
        </p>
      </div>
      {s.eff.get("F-133")?.enabled !== false && (
        <div className="card">
          <h2 className="font-extrabold">Or get a sign-in link</h2>
          <p className="mb-3 text-sm text-muted">No password needed. We email you a button that signs you in once.</p>
          <AcctForm secondary action={requestLinkAction.bind(null, sub, "signin")} submit="Email me a link" fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email", required: true, dir: "ltr" }]} />
        </div>
      )}
    </div>
  );
}
