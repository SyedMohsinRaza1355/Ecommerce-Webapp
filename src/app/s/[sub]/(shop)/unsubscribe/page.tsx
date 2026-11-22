import { notFound } from "next/navigation";
import { loadStore } from "@/lib/commerce/load";
import { verifyUnsubscribe } from "@/lib/commerce/extras";
import { unsubscribeAction } from "../actions";

export const metadata = { title: "Unsubscribe", robots: { index: false } };

/** Shows a button instead of acting on the link, so mail scanners that open links do not unsubscribe people by accident. */
export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<{ e?: string; t?: string; done?: string; bad?: string }> }) {
  const { sub } = await params;
  const { e = "", t = "", done, bad } = await searchParams;
  const s = await loadStore(sub);
  if (s.status !== "ok") notFound();
  const valid = e.length > 3 && e.length < 160 && verifyUnsubscribe(s.ctx.instanceId, e, t);
  return (
    <div className="mx-auto max-w-md">
      <div className="card pop-in text-center">
        <h1 className="text-2xl font-extrabold">Unsubscribe</h1>
        {done ? <p role="status" className="ok mt-3">You are unsubscribed. We will not email you news any more.</p>
          : bad || !valid ? <p role="alert" className="err mt-3">This unsubscribe link is not valid. Reply to any of our emails and we will remove you.</p>
          : (
            <>
              <p className="mt-2 text-sm text-muted">Stop news emails to <strong dir="ltr">{e}</strong>?</p>
              <form action={unsubscribeAction.bind(null, sub, e, t)} className="mt-4"><button className="btn btn-primary">Yes, unsubscribe me</button></form>
            </>
          )}
      </div>
    </div>
  );
}
