import { PACKS } from "@/catalog/packs";
import { env } from "@/lib/env";
import { listPlans } from "@/lib/platform/plans";
import CreateForm from "./CreateForm";

export const metadata = { title: "Create a store | Storeforge Super Admin" };

export default async function NewStorePage() {
  const plans = await listPlans();
  return (
    <div className="max-w-2xl">
      <h1 className="reveal text-2xl font-extrabold tracking-tight">Create a store</h1>
      <p className="reveal reveal-1 mb-6 mt-1 text-muted">Pick a name, an address and an industry pack. The store, its private database and an owner invitation are created together.</p>
      <div className="reveal reveal-2">
        <CreateForm
          packs={PACKS.map((p) => ({ id: p.id, name: p.name, description: p.description }))}
          plans={plans.map((p) => ({ id: p._id, name: p.name }))}
          baseDomain={env().baseDomain}
        />
      </div>
    </div>
  );
}
