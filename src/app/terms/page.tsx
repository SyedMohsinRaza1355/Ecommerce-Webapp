import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Terms of use | Storeforge", description: "Basic terms for using Storeforge stores." };

const SECTIONS: [string, string][] = [
  ["Orders", "An order is a request to buy. The store confirms it when payment is received or, for cash on delivery, when the store accepts it. Prices are shown in the store currency and include tax only where the store says so."],
  ["Payments and refunds", "Card payments are processed by the payment provider. Refunds are issued by the store to the original payment method according to the store's return policy."],
  ["Accounts", "Keep your sign-in details private. Staff must use two-step verification. Do not attempt to access data that is not yours."],
  ["Availability", "We aim for high availability but do not promise uninterrupted service. Stock levels can change between adding to a cart and paying."],
];

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/"><Logo /></Link>
      <h1 className="mt-8 text-3xl font-extrabold tracking-tight">Terms of use</h1>
      <p className="mt-2 text-sm text-muted">Template text for the platform. Store owners add their own sales terms, returns and delivery policies.</p>
      {SECTIONS.map(([h, p]) => (
        <section key={h} className="mt-6"><h2 className="text-lg font-bold">{h}</h2><p className="mt-1 text-muted">{p}</p></section>
      ))}
    </main>
  );
}
