import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import AcctForm from "@/components/store/AcctForm";
import { trackAction } from "../actions";

export const metadata = { title: "Track your order" };

export default async function Track({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  return (
    <div className="mx-auto max-w-md">
      <div className="card pop-in">
        <h1 className="text-2xl font-extrabold">Track your order</h1>
        <p className="mb-4 text-sm text-muted">Lost your order link? Enter the order number from your confirmation and the email you used.</p>
        <AcctForm action={trackAction.bind(null, sub)} submit="Find my order" fields={[
          { name: "orderNo", label: "Order number (for example 1001)", required: true, dir: "ltr", maxLength: 12 },
          { name: "email", label: "Email used at checkout", type: "email", autoComplete: "email", required: true, dir: "ltr" },
        ]} />
      </div>
    </div>
  );
}
