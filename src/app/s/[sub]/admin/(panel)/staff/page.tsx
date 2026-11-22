import { guard } from "@/lib/commerce/guard";
import { listStaff, INVITABLE_ROLES } from "@/lib/commerce/staff";
import { platformDb } from "@/lib/db/client";
import { AF, ActionButton } from "@/components/admin/Forms";
import { fmtDate } from "@/lib/i18n";
import { inviteStaffAction, staffChangeAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Staff" };

const NAMES: Record<string, string> = { store_owner: "Owner", manager: "Manager", cashier: "Cashier", kitchen_ops: "Kitchen / operations" };

export default async function StaffPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "staff.manage");
  const [{ users, invites }, plan] = await Promise.all([
    listStaff(store.ctx),
    platformDb().then((d) => d.collection<{ _id: string; quotas: { staffSeats: number } }>("plans").findOne({ _id: store.instance.planId })),
  ]);
  const seats = plan?.quotas.staffSeats ?? 1;
  const used = users.filter((u) => !u.disabled).length + invites.length;
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Staff</h1>
      <p className="text-muted">{used} of {seats} seats used on your plan.</p>

      <AF action={inviteStaffAction.bind(null, sub)} submit="Create invitation" className="card mt-5">
        <h2 className="mb-3 font-extrabold">Invite someone</h2>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <label className="field"><span>Email</span><input className="input" type="email" name="email" required dir="ltr" /></label>
          <label className="field"><span>Role</span>
            <select className="input" name="role">{INVITABLE_ROLES.map((r) => <option key={r} value={r}>{NAMES[r]}</option>)}</select>
          </label>
        </div>
        <p className="hint mb-3">Managers run the shop, cashiers process orders, kitchen/operations staff only move orders through preparation. Nobody can change their own access.</p>
      </AF>

      <div className="card mt-5 overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Person</th><th>Role</th><th>Two-step</th><th>Last sign in</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="font-semibold">{u.email}{u.disabled && <span className="badge badge-red ms-2">Disabled</span>}</td>
                <td>{NAMES[u.role]}</td>
                <td>{u.twoFactor ? <span className="badge badge-green">On</span> : <span className="badge badge-amber">Off</span>}</td>
                <td className="text-xs">{u.lastLoginAt ? fmtDate(u.lastLoginAt, "en") : "Never"}</td>
                <td className="text-end">
                  {u.role !== "store_owner" && u.twoFactor && (
                    <ActionButton label="Reset two-step" confirmText="Remove this person's authenticator? They must set up a new one next time they sign in. Do this if they lost their phone." run={staffChangeAction.bind(null, sub, u.id, { resetTwoFactor: true })} />
                  )}
                  {u.role !== "store_owner" && (
                    <ActionButton label={u.disabled ? "Enable" : "Disable"} danger={!u.disabled} run={staffChangeAction.bind(null, sub, u.id, { disabled: !u.disabled })} confirmText={u.disabled ? undefined : "Disable this person? They are signed out immediately."} />
                  )}
                </td>
              </tr>
            ))}
            {invites.map((i) => (
              <tr key={i.email}><td className="text-muted">{i.email}</td><td>{NAMES[i.role]}</td><td colSpan={2} className="text-xs text-muted">Invitation pending, expires {fmtDate(i.expiresAt, "en")}</td><td /></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
