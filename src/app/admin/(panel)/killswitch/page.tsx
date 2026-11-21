import { getKillSwitch, setKillSwitch } from "@/lib/platform/killswitch";
import { requireSuperAdmin } from "@/lib/auth/current";
import { TOGGLES, CATALOG } from "@/lib/toggles/catalog";
import { revalidatePath } from "next/cache";

export const metadata = { title: "Kill switch | Storeforge Super Admin" };

async function apply(form: FormData) {
  "use server";
  const actor = await requireSuperAdmin();
  const mode = String(form.get("mode"));
  if (mode === "off" || mode === "on" || mode === "clear") await setKillSwitch(actor, String(form.get("id")), mode);
  revalidatePath("/admin/killswitch");
}

export default async function KillSwitchPage() {
  await requireSuperAdmin();
  const flags = await getKillSwitch();
  const active = Object.entries(flags);
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Emergency kill switch</h1>
      <p className="mb-5 text-muted">Force one feature off (or on) for every store at once, for example when a provider is down. It beats every lock, override and owner choice and takes effect within about 30 seconds, with no deploy.</p>
      <form action={apply} className="card">
        <label className="field"><span>Feature</span>
          <select name="id" className="input">{TOGGLES.map((t) => <option key={t.id} value={t.id}>{t.id} {t.name}</option>)}</select>
        </label>
        <label className="field"><span>Action</span>
          <select name="mode" className="input"><option value="off">Force OFF everywhere</option><option value="on">Force ON everywhere</option><option value="clear">Remove the switch</option></select>
        </label>
        <button className="btn btn-danger">Apply</button>
      </form>
      <div className="card mt-5">
        <h2 className="font-extrabold">Active switches</h2>
        {active.length === 0 ? <p className="mt-2 text-sm text-muted">None. Everything follows normal rules.</p> : (
          <ul className="mt-3 divide-y divide-line text-sm">
            {active.map(([id, v]) => (
              <li key={id} className="flex items-center justify-between gap-3 py-2">
                <span>{id} {CATALOG.get(id)?.name}</span>
                <span className={`badge ${v ? "badge-green" : "badge-red"}`}>{v ? "Forced on" : "Forced off"}</span>
                <form action={apply}><input type="hidden" name="id" value={id} /><input type="hidden" name="mode" value="clear" /><button className="btn btn-secondary">Remove</button></form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
