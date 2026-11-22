import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { bookableDates, slotTimes, DEFAULT_BOOKING } from "@/lib/commerce/operations";
import AcctForm from "@/components/store/AcctForm";
import { bookTableAction } from "../actions";

export const metadata = { title: "Book a table" };
export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok" || s.eff.get("F-118")?.enabled !== true) notFound();
  const cfg = { ...DEFAULT_BOOKING, ...(s.settings.booking ?? {}) };
  const dates = bookableDates(cfg, new Date());
  const times = slotTimes(cfg);
  return (
    <div className="mx-auto max-w-lg">
      <div className="card">
        <h1 className="text-2xl font-extrabold">Book a table</h1>
        <p className="mb-4 text-sm text-muted">Pick a day and time. We confirm by email straight away and hold your table for 15 minutes. For groups over {cfg.maxParty}, please call us.</p>
        <AcctForm action={bookTableAction.bind(null, sub)} submit="Book my table" fields={[
          { name: "name", label: "Your name", required: true, autoComplete: "name", maxLength: 80 },
          { name: "email", label: "Email", type: "email", required: true, autoComplete: "email", dir: "ltr" },
          { name: "phone", label: "Phone", type: "tel", required: true, autoComplete: "tel", dir: "ltr", maxLength: 30 },
          { name: "party", label: `Number of people (1 to ${cfg.maxParty})`, type: "number", required: true, dir: "ltr" },
          { name: "note", label: "Anything we should know? (optional)", maxLength: 300 },
        ]}>
          <label className="field"><span>Day</span><select className="input" name="date" required>{dates.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
          <label className="field"><span>Time</span><select className="input" name="time" required>{times.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        </AcctForm>
      </div>
    </div>
  );
}
