"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { beginTotpAction } from "@/app/s/[sub]/admin/actions";

export default function SetupTotp({ sub }: { sub: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button className="btn btn-secondary mt-3" disabled={pending} onClick={() => start(async () => { await beginTotpAction(sub); router.refresh(); })}>
      {pending ? "..." : "Get a setup key"}
    </button>
  );
}
