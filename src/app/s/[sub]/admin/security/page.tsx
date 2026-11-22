import Link from "next/link";
import QRCode from "qrcode";
import { requireStaff } from "@/lib/commerce/load";
import { otpauthUrl } from "@/lib/auth/totp";
import { AF } from "@/components/admin/Forms";
import { changePasswordAction, confirmTotpAction } from "@/app/s/[sub]/admin/actions";
import SetupTotp from "./SetupTotp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account security", robots: { index: false, follow: false } };

export default async function SecurityPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store, staff } = await requireStaff(sub, { allowSetup2fa: true });
  const u = staff.user;
  const pending = u?.totp && !u.totp.enabled ? u.totp.secret : null;
  const required = store.eff.get("F-109")?.enabled;
  const link = pending && u ? otpauthUrl(pending, u.email, store.settings.branding.storeName || store.instance.name) : "";
  const qr = link ? await QRCode.toDataURL(link, { margin: 2, width: 220, errorCorrectionLevel: "M" }) : "";
  return (
    <main className="mx-auto max-w-xl p-4 sm:p-8">
      <Link href={`/s/${sub}/admin`} className="text-sm underline">Back to admin</Link>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Account security</h1>
      {staff.impersonating || !u ? <p className="card mt-5">Security settings cannot be changed in a support session.</p> : (
        <>
          <section className="card mt-5" aria-labelledby="tf">
            <h2 id="tf" className="font-extrabold">Two-step sign in</h2>
            {u.totp?.enabled ? <p className="ok mt-2">On. You will be asked for a code from your authenticator app each time you sign in.</p> : (
              <>
                {required && <p role="alert" className="err mt-2">Two-step sign in is required for staff accounts. Set it up to continue.</p>}
                <p className="mt-2 text-sm text-muted">Use an authenticator app such as Google Authenticator, Microsoft Authenticator or Authy.</p>
                <SetupTotp sub={sub} />
                {pending && (
                  <div className="pop-in mt-4">
                    <p className="text-sm">Open your authenticator app, choose &ldquo;scan a QR code&rdquo; and scan this picture, then type the 6-digit code it shows.</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr} alt="QR code to add this account to your authenticator app" width={220} height={220} className="mx-auto mt-3 rounded-xl ring-1 ring-line" />
                    <p className="mt-3 text-sm">Cannot scan? Choose &ldquo;enter a setup key&rdquo; in your app and type this key instead:</p>
                    <p className="mt-2 break-all rounded-xl bg-slate-50 p-3 font-mono text-sm tracking-wider" dir="ltr">{pending}</p>
                    <p className="hint break-all" dir="ltr">{link}</p>
                    <AF action={confirmTotpAction.bind(null, sub)} submit="Turn on two-step sign in" className="mt-3">
                      <label className="field"><span>6-digit code</span><input className="input" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" dir="ltr" required /></label>
                    </AF>
                  </div>
                )}
              </>
            )}
          </section>
          <section className="card mt-5" aria-labelledby="pw">
            <h2 id="pw" className="font-extrabold">Change password</h2>
            <AF action={changePasswordAction.bind(null, sub)} submit="Change password" className="mt-3">
              <label className="field"><span>Current password</span><input className="input" type="password" name="current" autoComplete="current-password" required /></label>
              <label className="field"><span>New password</span><input className="input" type="password" name="next" autoComplete="new-password" required /><p className="hint">At least 10 characters with letters and numbers.</p></label>
              <label className="field"><span>Repeat new password</span><input className="input" type="password" name="confirm" autoComplete="new-password" required /></label>
            </AF>
          </section>
        </>
      )}
    </main>
  );
}
