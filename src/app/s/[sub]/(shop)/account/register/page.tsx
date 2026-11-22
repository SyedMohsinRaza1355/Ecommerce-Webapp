import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { currentCustomer } from "@/lib/commerce/customers";
import AcctForm from "@/components/store/AcctForm";
import { registerAction } from "../actions";

export const metadata = { title: "Create account", robots: { index: false } };

export default async function Register({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<{ next?: string; ref?: string }> }) {
  const { sub } = await params;
  const { next = "", ref = "" } = await searchParams;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-045")?.enabled === false) notFound();
  if (await currentCustomer(s)) redirect(`/s/${sub}/account`);
  return (
    <div className="mx-auto max-w-md">
      <div className="card pop-in">
        <h1 className="text-2xl font-extrabold">Create your account</h1>
        <p className="mb-4 text-sm text-muted">Follow your orders and check out faster next time. You can still order as a guest.</p>
        <AcctForm action={registerAction.bind(null, sub)} submit="Create account" hidden={{ next }} initial={{ ref: ref.slice(0, 20) }} fields={[
          { name: "name", label: "Full name", autoComplete: "name", required: true, maxLength: 100 },
          { name: "email", label: "Email", type: "email", autoComplete: "email", required: true, dir: "ltr" },
          { name: "phone", label: "Phone (optional)", type: "tel", autoComplete: "tel", dir: "ltr" },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password", required: true, hint: "At least 10 characters with letters and numbers." },
          { name: "confirm", label: "Repeat password", type: "password", autoComplete: "new-password", required: true },
          ...(s.feat.referral ? [{ name: "ref", label: "Friend's invite code (optional)", dir: "ltr" as const, maxLength: 20 }] : []),
        ]} />
        <p className="mt-4 text-sm">Already have an account? <Link href={`/s/${sub}/account/login`} className="underline">Sign in</Link></p>
      </div>
    </div>
  );
}
