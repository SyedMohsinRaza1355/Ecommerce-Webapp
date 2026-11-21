import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { validateSubdomain } from "@/lib/tenant/host";
import { platformDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Store owner sign in | Storeforge" };

async function go(form: FormData) {
  "use server";
  const raw = String(form.get("store") ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/.:]/)[0];
  if (!validateSubdomain(raw).ok) redirect("/signin?error=format");
  const found = await (await platformDb()).collection("instances").countDocuments({ subdomain: raw, status: { $in: ["active", "suspended"] } });
  if (!found) redirect(`/signin?error=missing&store=${encodeURIComponent(raw)}`);
  redirect(`/s/${raw}/admin/login`);
}

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string; store?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6 text-center"><Link href="/"><Logo /></Link></div>
      <div className="card pop-in">
        <h1 className="text-xl font-extrabold">Store owner sign in</h1>
        <p className="mb-5 mt-1 text-sm text-muted">Enter your store&apos;s address, the short name you were given when your store was created.</p>
        <form action={go} noValidate>
          <label className="field">
            <span>Store address</span>
            <input className="input" name="store" placeholder="for example: demo" autoComplete="off" autoCapitalize="none" required defaultValue={sp.store ?? ""} dir="ltr" />
          </label>
          {sp.error === "format" && <p role="alert" className="err mb-3">Use only letters, numbers and hyphens (3 to 30 characters).</p>}
          {sp.error === "missing" && <p role="alert" className="err mb-3">We could not find a store called &ldquo;{sp.store}&rdquo;. Check the spelling with whoever created your store.</p>}
          <button className="btn btn-primary w-full">Continue</button>
        </form>
        <p className="mt-5 text-sm text-muted">Platform administrator? <Link className="underline" href="/admin/login">Sign in here</Link>.</p>
      </div>
    </main>
  );
}
