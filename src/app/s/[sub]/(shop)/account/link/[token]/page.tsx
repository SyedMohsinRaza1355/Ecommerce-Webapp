import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { magicLinkAction } from "../../actions";

export const metadata = { title: "Sign in", robots: { index: false } };

/** The link only shows a button: mail scanners that "open" links must not use up a one-time sign-in. */
export default async function MagicLink({ params }: { params: Promise<{ sub: string; token: string }> }) {
  const { sub, token } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-045")?.enabled === false) notFound();
  return (
    <div className="mx-auto max-w-md">
      <div className="card pop-in text-center">
        <h1 className="text-2xl font-extrabold">Sign in to {s.settings.branding.storeName || s.instance.name}</h1>
        <p className="mt-2 text-sm text-muted">Press the button to finish signing in. This link works once.</p>
        <form action={magicLinkAction.bind(null, sub, token)} className="mt-5"><button className="btn btn-primary">Sign in</button></form>
      </div>
    </div>
  );
}
