import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { getActor } from "@/lib/auth/current";
import { countSuperAdmins } from "@/lib/platform/users";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin sign in | Storeforge" };

export default async function LoginPage() {
  const actor = await getActor();
  if (actor?.role === "super_admin") redirect("/admin");

  let needsSetup = false;
  let dbDown = false;
  try {
    needsSetup = (await countSuperAdmins()) === 0;
  } catch {
    dbDown = true;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6 text-center"><Link href="/"><Logo /></Link></div>
      <div className="card">
        <h1 className="mb-4 text-xl font-bold">Super Admin sign in</h1>
        {dbDown ? (
          <p role="alert" className="err">The database is not reachable right now, so sign in is unavailable. Please try again shortly.</p>
        ) : needsSetup ? (
          <p>No administrator exists yet. <Link className="underline" href="/setup">Create the first Super Admin</Link>.</p>
        ) : (
          <LoginForm />
        )}
      </div>
    </main>
  );
}
