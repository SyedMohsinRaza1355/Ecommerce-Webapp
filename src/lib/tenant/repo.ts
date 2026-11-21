import type { Collection, Document, Filter, OptionalUnlessRequiredId, WithId } from "mongodb";
import { tenantDb } from "./schema";
import { assertTenantContext, type TenantContext } from "./context";

type Owned = Document & { instanceId?: string };

/**
 * Tenant-scoped repository. Every call needs a TenantContext (compile-time brand
 * plus runtime assertion). The database comes from ctx, and every filter and
 * insert is additionally stamped with instanceId as defence in depth, so a
 * resource id from another tenant can never match (SRS 8.4, 8.5).
 */
export class TenantRepo<T extends Owned> {
  constructor(private readonly name: string) {}

  /** Escape hatch for atomic operations; always combine with scope(). */
  async collection(ctx: TenantContext): Promise<Collection<T>> {
    return this.col(ctx);
  }

  private async col(ctx: TenantContext): Promise<Collection<T>> {
    assertTenantContext(ctx);
    return (await tenantDb(ctx)).collection<T>(this.name);
  }

  scope(ctx: TenantContext, filter: Filter<T> = {}): Filter<T> {
    return { ...filter, instanceId: ctx.instanceId } as Filter<T>;
  }

  async findById(ctx: TenantContext, id: T["_id"]): Promise<WithId<T> | null> {
    const c = await this.col(ctx);
    return c.findOne(this.scope(ctx, { _id: id } as Filter<T>)) as Promise<WithId<T> | null>;
  }

  async count(ctx: TenantContext, filter: Filter<T> = {}): Promise<number> {
    const c = await this.col(ctx);
    return c.countDocuments(this.scope(ctx, filter));
  }

  async find(ctx: TenantContext, filter: Filter<T> = {}, limit = 100): Promise<WithId<T>[]> {
    const c = await this.col(ctx);
    return c.find(this.scope(ctx, filter)).limit(Math.min(limit, 500)).toArray() as Promise<WithId<T>[]>;
  }

  async insert(ctx: TenantContext, doc: Omit<T, "instanceId">): Promise<T["_id"]> {
    const c = await this.col(ctx);
    const res = await c.insertOne({ ...doc, instanceId: ctx.instanceId } as unknown as OptionalUnlessRequiredId<T>);
    return res.insertedId as T["_id"];
  }

  async updateById(ctx: TenantContext, id: T["_id"], set: Partial<T>): Promise<boolean> {
    const c = await this.col(ctx);
    const { instanceId: _ignored, ...safe } = set as Record<string, unknown>;
    void _ignored;
    const r = await c.updateOne(this.scope(ctx, { _id: id } as Filter<T>), { $set: safe } as never);
    return r.matchedCount === 1;
  }

  async deleteById(ctx: TenantContext, id: T["_id"]): Promise<boolean> {
    const c = await this.col(ctx);
    const r = await c.deleteOne(this.scope(ctx, { _id: id } as Filter<T>));
    return r.deletedCount === 1;
  }
}
