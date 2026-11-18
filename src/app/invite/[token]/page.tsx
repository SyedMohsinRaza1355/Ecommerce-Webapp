import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icons";
import { platformDb } from "@/lib/db/client";
import { hashToken, type Invite } from "@/lib/platform/provision";
import type { InstanceRecord } from "@/lib/tenant/resolve";
import AcceptForm from "./AcceptForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up your store | Storeforge" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let storeName: string | null = null;
  let valid = false;
  if (token === "done") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 text-center">
        <div className="icon-chip pop-in mx-auto">{Icon.check}</div>
        <h1 className="mt-5 text-2xl font-extrabold">Your password is set</h1>
        <p className="mt-2 text-muted">Your store account is ready. The store owner sign in arrives in the next step.</p>
        <Link href="/" className="btn btn-primary mx-auto mt-6">Back to home</Link>
      </main>
    );
  }
  try {
    const db = await platformDb();
    const inv = await db.collection<Invite>("invites").findOne({ _id: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } });
    if (inv) {
      valid = true;
      storeName = (await db.collection<InstanceRecord>("instances").findOne({ _id: inv.instanceId }))?.name ?? null;
    }
  } catch {
    valid = false;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6 text-center"><Link href="/"><Logo /></Link></div>
      <div className="card pop-in">
        {valid ? (
          <>
            <h1 className="text-xl font-extrabold">Welcome{storeName ? `, ${storeName}` : ""}</h1>
            <p className="mb-5 mt-1 text-sm text-muted">Choose a password to finish setting up your store account.</p>
            <AcceptForm token={token} />
          </>
        ) : (
          <>
            <h1 className="text-xl font-extrabold">This link is no longer valid</h1>
            <p className="mt-2 text-sm text-muted">Setup links work once and expire after an hour. Ask your administrator to send a new one.</p>
          </>
        )}
      </div>
    </main>
  );
}
