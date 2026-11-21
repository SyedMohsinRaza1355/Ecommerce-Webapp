import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Privacy notice | Storeforge", description: "How personal data is handled on Storeforge stores." };

const SECTIONS: [string, string][] = [
  ["What we collect", "When you order, the store collects your name, email, phone and delivery address so it can fulfil the order. Staff accounts store an email address and a password hash. We do not collect or store card numbers: payments are handled by the payment provider."],
  ["Why", "To process orders, send order updates, prevent fraud and meet accounting duties. Marketing messages are only sent with separate, revocable consent."],
  ["Cookies", "We use only essential cookies: one keeps your cart, one keeps staff signed in, one remembers your language. No advertising or tracking cookies are used."],
  ["Who sees it", "Only the store you ordered from and its authorised staff. Each store's data is kept in its own separate database and cannot be read by other stores."],
  ["How long", "Order records are kept for the period required for tax and accounting. Audit logs are kept for two years. You can ask a store to remove your personal details from past orders; totals are kept for accounting."],
  ["Your rights", "You can ask the store to access, correct, export or delete your personal data, and to stop marketing messages, using the contact email shown on your order page."],
  ["Security", "Traffic is encrypted, passwords are hashed, staff sign in with two-step verification, and administrative actions are logged. To report a vulnerability see /.well-known/security.txt."],
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/"><Logo /></Link>
      <h1 className="mt-8 text-3xl font-extrabold tracking-tight">Privacy notice</h1>
      <p className="mt-2 text-sm text-muted">Template text for the platform. Each store owner is responsible for their own policy; have it reviewed by a qualified adviser for your market.</p>
      {SECTIONS.map(([h, p]) => (
        <section key={h} className="mt-6"><h2 className="text-lg font-bold">{h}</h2><p className="mt-1 text-muted">{p}</p></section>
      ))}
    </main>
  );
}
