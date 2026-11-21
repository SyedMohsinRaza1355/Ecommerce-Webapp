import type { Metadata } from "next";
import Link from "next/link";
import Explorer from "./Explorer";
import { Logo } from "@/components/Logo";
import { TOGGLES } from "@/lib/toggles/catalog";
import { IMPLEMENTED } from "@/lib/toggles/handlers";

export const dynamic = "force-dynamic"; // nonce-based CSP needs per-request rendering
export const metadata: Metadata = { title: "Feature toggle explorer | Storeforge" };

export default function TogglesPage() {
  return (
    <div>
      <header className="glass sticky top-0 z-20 border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/"><Logo /></Link>
          <Link href="/admin/login" className="btn btn-primary">Admin sign in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-8">
        <h1 className="reveal text-3xl font-extrabold tracking-tight">Feature catalogue</h1>
        <p className="reveal reveal-1 mt-2 max-w-2xl text-muted">
          All {TOGGLES.length} features a store can switch on. {IMPLEMENTED.size} already work; the rest are planned. Flip a switch to see what it needs, and open the simulator to see how Super Admin rules beat store owner choices.
        </p>
        <Explorer defs={TOGGLES} implemented={[...IMPLEMENTED]} />
      </main>
    </div>
  );
}
