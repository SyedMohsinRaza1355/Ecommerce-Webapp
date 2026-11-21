import { guard } from "@/lib/commerce/guard";
import { AF } from "@/components/admin/Forms";
import { anonymizeAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Privacy requests" };

export default async function PrivacyPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  await guard(sub, "privacy.manage");
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Privacy requests</h1>
      <p className="mb-5 text-muted">If a customer asks you to delete their personal data, you can remove their name, email, phone and address from all their orders here. Order totals stay for accounting and tax records.</p>
      <AF action={anonymizeAction.bind(null, sub)} submit="Remove personal data" className="card">
        <label className="field"><span>Customer email</span><input className="input" type="email" name="email" required dir="ltr" /></label>
        <label className="field"><span>Type DELETE to confirm</span><input className="input" name="confirm" autoComplete="off" /><p className="hint">This cannot be undone. The action is recorded in the audit log.</p></label>
      </AF>
    </div>
  );
}
