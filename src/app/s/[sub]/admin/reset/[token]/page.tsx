import { notFound } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { loadStore } from "@/lib/commerce/load";
import AcctForm from "@/components/store/AcctForm";
import { staffResetAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default async function StaffReset({ params }: { params: Promise<{ sub: string; token: string }> }) {
  const { sub, token } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6 text-center"><Link href={`/s/${sub}`}><Logo /></Link></div>
      <div className="card pop-in">
        <h1 className="text-xl font-extrabold">Choose a new password</h1>
        <div className="mt-4">
          <AcctForm action={staffResetAction.bind(null, sub, token)} submit="Save password" fields={[
            { name: "password", label: "New password", type: "password", autoComplete: "new-password", required: true, hint: "At least 10 characters with letters and numbers." },
            { name: "confirm", label: "Repeat new password", type: "password", autoComplete: "new-password", required: true },
          ]} />
        </div>
      </div>
    </main>
  );
}
