import type { Metadata } from "next";
import Link from "next/link";
import Explorer from "./Explorer";
import { Logo } from "@/components/Logo";
import { TOGGLES } from "@/lib/toggles/catalog";
import { IMPLEMENTED } from "@/lib/toggles/handlers";

export const metadata: Metadata = { title: "Feature toggle explorer | Storeforge" };

export default function TogglesPage() {
  return (
    <div>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/"><Logo /></Link>
          <Link href="/admin/login" className="btn btn-primary">Admin sign in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-8">
        <h1 className="text-2xl font-bold">Feature toggle explorer</h1>
        <p className="mt-2 text-sm text-muted">
          {TOGGLES.length} toggles, {IMPLEMENTED.size} with working behaviour so far. Change a row to see precedence and prerequisites at work.
        </p>
        <Explorer defs={TOGGLES} implemented={[...IMPLEMENTED]} />
      </main>
    </div>
  );
}
