import type { Metadata } from "next";
import Explorer from "./Explorer";
import { TOGGLES } from "@/lib/toggles/catalog";
import { IMPLEMENTED } from "@/lib/toggles/handlers";

export const metadata: Metadata = { title: "Feature toggle explorer" };

export default function TogglesPage() {
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <h1 className="text-2xl font-bold">Feature toggle explorer</h1>
      <p className="mt-2 text-sm">
        {TOGGLES.length} toggles. {IMPLEMENTED.size} have working behaviour so far; the rest are registered and
        arrive in later phases. Change a row&apos;s control to see the precedence rules and prerequisites at work.
      </p>
      <Explorer defs={TOGGLES} implemented={[...IMPLEMENTED]} />
    </main>
  );
}
