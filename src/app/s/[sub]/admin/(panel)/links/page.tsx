import { guard } from "@/lib/commerce/guard";
import { originOf } from "@/lib/commerce/orders";
import { liveToken } from "../../../live/[token]/[kind]/route";
import { AF, ActionButton } from "@/components/admin/Forms";
import { linksAction, chatAction, domainCheckAction } from "@/app/s/[sub]/admin/actions";

export const metadata = { title: "Links and feeds" };

export default async function LinksPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const { store } = await guard(sub, "settings.commerce");
  const o = originOf();
  const t = liveToken(String(store.instance._id), store.settings.feedVersion ?? 1);
  const on = (id: string) => store.eff.get(id)?.enabled === true;
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Links and feeds</h1>
      <section className="card space-y-2">
        <h2 className="font-bold">Product feed (Google Shopping and marketplaces)</h2>
        <p className="text-sm text-muted">Paste this address where the marketplace asks for a product feed. It lists your published products.</p>
        <code dir="ltr" className="block break-all rounded bg-slate-100 p-2 text-sm">{on("F-106") ? `${o}/s/${sub}/feed.xml` : "Press Save below to switch this on."}</code>
      </section>
      <section className="card space-y-2">
        <h2 className="font-bold">Live spreadsheet links (Google Sheets)</h2>
        <p className="text-sm text-muted">In Google Sheets type <code>=IMPORTDATA(&quot;link&quot;)</code>. Anyone with a link can read that data, so keep it private. Tick &quot;replace the links&quot; below if one leaks.</p>
        {on("F-104") ? ["orders", "products"].map((k) => <code key={k} dir="ltr" className="block break-all rounded bg-slate-100 p-2 text-sm">{`${o}/s/${sub}/live/${t}/${k}`}</code>) : <p className="text-sm">Press Save below to switch this on.</p>}
      </section>
      <section className="card">
        <h2 className="font-bold">Order alerts and WhatsApp</h2>
        <p className="text-sm text-muted">Get a Telegram message the moment an order arrives (free). Create a bot with @BotFather in Telegram, copy its token, press Start in your bot, then find your chat id with @userinfobot. Add your WhatsApp number to show &quot;Ask on WhatsApp&quot; buttons on products and in the cart.</p>
        <AF action={chatAction.bind(null, sub)} submit="Save" className="mt-3">
          <label className="field"><span>Telegram bot token {store.settings.telegram ? "(saved: leave empty to keep it)" : ""}</span><input className="input" name="telegramToken" type="password" autoComplete="off" dir="ltr" /></label>
          <label className="field"><span>Telegram chat id</span><input className="input" name="telegramChat" defaultValue={store.settings.telegram?.chatId ?? ""} dir="ltr" /></label>
          <label className="field"><span>WhatsApp number with country code (for example 923001234567)</span><input className="input" name="whatsapp" inputMode="tel" defaultValue={store.settings.whatsapp ?? ""} dir="ltr" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="test" /> Send a test message to Telegram now</label>
        </AF>
      </section>
      <section className="card space-y-2">
        <h2 className="font-bold">Is my store address healthy?</h2>
        <p className="text-sm text-muted">Checks that your store answers, how fast, and that it is secure.</p>
        <ActionButton label="Check now" secondary={false} run={domainCheckAction.bind(null, sub)} />
      </section>
      <section className="card">
        <h2 className="font-bold">Redirects and links</h2>
        <AF action={linksAction.bind(null, sub)} submit="Save" className="mt-3">
          <label className="field"><span>Redirects, one per line: /old-address &gt; /new-address</span><textarea className="input min-h-24" name="redirects" dir="ltr" defaultValue={(store.settings.redirects ?? []).map((r) => `${r.from} > ${r.to}`).join(String.fromCharCode(10))} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="rotate" /> Replace the live spreadsheet links with new ones</label>
        </AF>
      </section>
    </div>
  );
}
