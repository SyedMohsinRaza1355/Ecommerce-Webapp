import Link from "next/link";
import { requireStaff } from "@/lib/commerce/load";

export const metadata = { title: "Help" };

const TOPICS: { id: string; title: string; steps: string[]; link?: [string, string] }[] = [
  { id: "payments", title: "Get paid", steps: ["Open Payments.", "For cards, paste your Stripe secret key and press Connect. Money goes to your own Stripe account.", "No Stripe? Add Easypaisa, JazzCash or bank details. Customers send the money and enter their receipt number; you press Mark as paid on the order.", "Cash on delivery is switched on in Features."], link: ["payments", "Open Payments"] },
  { id: "products", title: "Add products", steps: ["Open Products and press Add product.", "Fill in name, price and stock. Choose Published so customers can see it.", "Many products? Use Reports, then Import products from a spreadsheet."], link: ["products", "Open Products"] },
  { id: "orders", title: "Handle an order", steps: ["Open Orders and click the order number.", "Use the buttons to move it forward: processing, ready, fulfilled, completed.", "Customers get an email at each step if emails are on.", "Cancelled orders put the stock back on the shelf automatically."], link: ["orders", "Open Orders"] },
  { id: "sales", title: "Run a sale", steps: ["Open Promotions and create a Flash sale with an end date, or a Basket discount.", "It applies by itself in the cart. Only the best discount applies to an order.", "For codes customers type in, use Discounts."], link: ["promotions", "Open Promotions"] },
  { id: "delivery", title: "Delivery fees and opening hours", steps: ["Open Store setup.", "Set opening hours so orders stop when you are closed.", "Give each city its own delivery fee, or leave the flat fee in Settings."], link: ["setup", "Open Store setup"] },
  { id: "pages", title: "About page, blog and banner", steps: ["Open Content to write an About page, policies or blog posts, and an announcement bar.", "Open Store setup to change the font and add banner slides to your home page."], link: ["content", "Open Content"] },
  { id: "features", title: "Turn features on and off", steps: ["Open Features. Every switch has a plain-language name.", "If a feature needs another one first, press Do it for me.", "Made a mistake? Undo it within 24 hours at the top of the page."], link: ["features", "Open Features"] },
  { id: "till", title: "Use the till and the kitchen screen", steps: ["Cashiers open Till: tap products, choose how the customer paid, press Charge and print receipt. Cash shows the change to give back.", "Kitchen staff open Kitchen: new orders appear by themselves. Press the big button to move an order along. A timer shows how long each one has waited.", "Turn on the beep or automatic ticket printing at the top of the Kitchen screen."], link: ["pos", "Open the till"] },
  { id: "printing", title: "Print receipts and kitchen tickets", steps: ["On any order, choose Print receipt (A4), Print receipt (80 mm) for a till printer, or Print kitchen ticket.", "Choose your receipt printer in the print window and set paper size to 80 mm if it is not picked automatically.", "To print without the window each time, start Chrome with the option --kiosk-printing (add it to the shortcut) and set the receipt printer as the default printer."] },
  { id: "forgot", title: "Forgot a staff password", steps: ["On the staff sign-in page, press Forgot your password and enter your work email.", "Open the email and choose a new password. The link works once for 30 minutes.", "Lost your phone? Ask the owner to press Reset two-step next to your name in Staff, then set up the authenticator again at your next sign in."] },
  { id: "staff", title: "Add a team member", steps: ["Open Staff, enter their email and choose a role.", "We email them the invitation as well. The link works once and lasts 24 hours.", "Managers and cashiers cannot see payments or settings."], link: ["staff", "Open Staff"] },
  { id: "security", title: "Keep your store safe", steps: ["Turn on two-step sign-in when asked; it is required for staff.", "Never share your Stripe key or API keys. You can revoke a key any time.", "Download a backup from Reports if you turn on Store backup download."], link: ["reports", "Open Reports"] },
];

export default async function HelpPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  await requireStaff(sub);
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Help</h1>
      <p className="text-muted">Short answers to the things store owners ask most.</p>
      <nav aria-label="Topics" className="mt-4 flex flex-wrap gap-2">{TOPICS.map((t) => <a key={t.id} href={`#${t.id}`} className="badge badge-indigo">{t.title}</a>)}</nav>
      <div className="mt-6 space-y-4">
        {TOPICS.map((t) => (
          <section key={t.id} id={t.id} className="card" aria-labelledby={`h-${t.id}`}>
            <h2 id={`h-${t.id}`} className="text-lg font-extrabold">{t.title}</h2>
            <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm">{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            {t.link && <p className="mt-3"><Link className="btn btn-secondary" href={`/s/${sub}/admin/${t.link[0]}`}>{t.link[1]}</Link></p>}
          </section>
        ))}
      </div>
    </div>
  );
}
