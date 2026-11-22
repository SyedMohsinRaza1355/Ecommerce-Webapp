import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import AcctForm from "@/components/store/AcctForm";
import { requestLinkAction } from "../actions";

export const metadata = { title: "Reset password", robots: { index: false } };

export default async function Forgot({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-045")?.enabled === false) notFound();
  return (
    <div className="mx-auto max-w-md">
      <div className="card pop-in">
        <h1 className="text-2xl font-extrabold">Forgot your password?</h1>
        <p className="mb-4 text-sm text-muted">Enter your email and we will send you a link to choose a new one.</p>
        <AcctForm action={requestLinkAction.bind(null, sub, "reset")} submit="Send reset link" fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email", required: true, dir: "ltr" }]} />
      </div>
    </div>
  );
}
