import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import AcctForm from "@/components/store/AcctForm";
import { contactAction } from "../actions";

export const metadata = { title: "Contact us" };

export default async function Contact({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-080")?.enabled === false) notFound();
  return (
    <div className="mx-auto max-w-xl">
      <div className="card pop-in">
        <h1 className="text-2xl font-extrabold">Contact us</h1>
        <p className="mb-4 text-sm text-muted">Questions about an order or a product? Send us a message{s.settings.contactEmail ? <> or write to <span dir="ltr">{s.settings.contactEmail}</span></> : null}.</p>
        <AcctForm action={contactAction.bind(null, sub)} submit="Send message" fields={[
          { name: "name", label: "Your name", autoComplete: "name", required: true, maxLength: 80 },
          { name: "email", label: "Your email", type: "email", autoComplete: "email", required: true, dir: "ltr" },
          { name: "message", label: "Message", required: true, maxLength: 2000 },
        ]}>
          {/* hidden from people, tempting to bots: a filled value means "not a person" */}
          <div className="absolute -start-[9999px]" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        </AcctForm>
      </div>
    </div>
  );
}
