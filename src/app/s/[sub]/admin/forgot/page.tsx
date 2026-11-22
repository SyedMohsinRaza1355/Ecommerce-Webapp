import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { loadStore } from "@/lib/commerce/load";
import AcctForm from "@/components/store/AcctForm";
import { staffForgotAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forgot password", robots: { index: false, follow: false } };

export default async function StaffForgot({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6 text-center"><Link href={`/s/${sub}`}><Logo /></Link></div>
      <div className="card pop-in">
        <h1 className="text-xl font-extrabold">Forgot your password?</h1>
        <p className="mb-4 text-sm text-muted">Enter your work email. We will send a link to choose a new one. You will still need your authenticator code to sign in.</p>
        <AcctForm action={staffForgotAction.bind(null, sub)} submit="Send reset link" fields={[{ name: "email", label: "Work email", type: "email", autoComplete: "email", required: true, dir: "ltr" }]} />
        <p className="mt-4 text-sm"><Link className="underline" href={`/s/${sub}/admin/login`}>Back to sign in</Link></p>
      </div>
    </main>
  );
}
