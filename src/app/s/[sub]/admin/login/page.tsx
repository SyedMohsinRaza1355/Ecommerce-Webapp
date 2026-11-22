import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { loadStore, getStaff } from "@/lib/commerce/load";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function StaffLogin({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<{ reset?: string }> }) {
  const { sub } = await params;
  const { reset } = await searchParams;
  const s = await loadStore(sub);
  if (s.status === "not_found") notFound();
  if (s.status === "suspended") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 text-center">
        <h1 className="text-xl font-extrabold">{s.name}</h1>
        <p className="mt-2 text-muted">This store is suspended. Please contact billing support.</p>
      </main>
    );
  }
  if (await getStaff(s)) redirect(`/s/${sub}/admin`);
  const name = s.settings.branding.storeName || s.instance.name;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6 text-center"><Link href={`/s/${sub}`}><Logo /></Link></div>
      <div className="card pop-in">
        <h1 className="text-xl font-extrabold">{name}</h1>
        <p className="mb-5 text-sm text-muted">Staff sign in</p>
        {reset && <p role="status" className="ok mb-3">Your password was changed. Sign in with the new one.</p>}
        <LoginForm sub={sub} />
        <p className="mt-4 text-sm"><Link className="underline" href={`/s/${sub}/admin/forgot`}>Forgot your password?</Link></p>
      </div>
    </main>
  );
}
