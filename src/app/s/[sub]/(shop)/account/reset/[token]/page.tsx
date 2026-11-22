import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import AcctForm from "@/components/store/AcctForm";
import { resetAction } from "../../actions";

export const metadata = { title: "Choose a new password", robots: { index: false } };

export default async function Reset({ params }: { params: Promise<{ sub: string; token: string }> }) {
  const { sub, token } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-045")?.enabled === false) notFound();
  return (
    <div className="mx-auto max-w-md">
      <div className="card pop-in">
        <h1 className="text-2xl font-extrabold">Choose a new password</h1>
        <div className="mt-4">
          <AcctForm action={resetAction.bind(null, sub, token)} submit="Save password" fields={[
            { name: "password", label: "New password", type: "password", autoComplete: "new-password", required: true, hint: "At least 10 characters with letters and numbers." },
            { name: "confirm", label: "Repeat new password", type: "password", autoComplete: "new-password", required: true },
          ]} />
        </div>
      </div>
    </div>
  );
}
