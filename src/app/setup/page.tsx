import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { countSuperAdmins } from "@/lib/platform/users";
import SetupForm from "./SetupForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "First-time setup | Storeforge" };

export default async function SetupPage() {
  let exists = false;
  let dbDown = false;
  try {
    exists = (await countSuperAdmins()) > 0;
  } catch {
    dbDown = true;
  }
  if (exists) redirect("/admin/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6 text-center"><Link href="/"><Logo /></Link></div>
      <div className="card">
        <h1 className="mb-1 text-xl font-bold">First-time setup</h1>
        <p className="mb-4 text-sm text-muted">Create the platform&apos;s first Super Admin. This page closes itself afterwards.</p>
        {dbDown ? <p role="alert" className="err">The database is not reachable right now. Please try again shortly.</p> : <SetupForm />}
      </div>
    </main>
  );
}
