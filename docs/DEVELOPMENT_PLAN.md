# Development Plan: Multi-Tenant Ecommerce Platform

Baseline: Master SRS v3.0 (145 toggles, ADD-001..078, DEC-01..12). Process: AI_Workflow (Phases 0-7).
Status: DRAFT for owner approval. Nothing below is built yet.

## 1. Bottlenecks found in the plan and the fix for each

| # | Bottleneck | Why it blocks | Fix adopted |
|---|-----------|---------------|-------------|
| B1 | Per-tenant Atlas DB users (SRS 8.4) vs ADD-004 warning | Atlas caps DB users per project and each user adds connection/credential overhead; unprovable on a free cluster | **ADR-004**: one DB per tenant (`tenant_{id}`), one app credential, isolation enforced by a mandatory `TenantContext` repository layer + cross-tenant tests. Per-tenant users stay an optional hardening step, decided after a load test on M30+. |
| B2 | Free-tier Atlas (collection and connection caps) | Cannot hold many tenant DBs; load test impossible | Dev uses ~3-5 tenants. A `TENANT_DB_STRATEGY` switch is not built; instead repositories take a `Db` from a single `getTenantDb(ctx)` function so the topology can change later without touching callers. 1,000-tenant proof is a Phase 7 task on a paid cluster. |
| B3 | Toggle IDs renumbered v1 -> v2 and the PDF catalogue text is scrambled | Wrong IDs would break tests and prerequisites | Catalogue is a **typed data file** `catalog/toggles.ts` built once, reviewed by the owner, with a unit test per entry (default, prerequisites, handler). v2.0 IDs win; v1 names are not used. |
| B4 | 145 toggles, each needing a registered handler (SRS 7.3) | Biggest scope risk | Every toggle gets a catalogue entry + handler stub on day one (so the DAG and engine are complete). Handlers marked `implemented: false` evaluate to Off and are hidden in the UI until built. Launch gate counts implemented ones honestly. |
| B5 | Redis, Inngest, S3, email/SMS/WhatsApp, Stripe/regional gateways need accounts | Workflow forbids silent paid accounts | **Ports and adapters** with local implementations first: in-memory/Mongo cache + lock, Mongo-backed job queue and outbox worker, local-disk object storage, console/file mailer, **mock payment gateway** with signed webhooks. Real providers are separate approved tasks. |
| B6 | Two phase schemes (SRS Stages 0-3, workflow Phases 0-7) | Ambiguous sequencing | Use workflow Phases 0-7; Stage mapping in section 3. |
| B7 | Decisions DEC-01..09 are launch-blocking | Cannot finish payments, retention, etc. | Draft ADRs with safe defaults (section 4). Build proceeds on the defaults; owner confirms before Phase 4. |
| B8 | SRS conflicts: TLS 1.3 vs 1.2+, WCAG 2.1 vs 2.2, SA-xx references | Inconsistent tests | Adopt ADD rules: TLS 1.2+ (1.3 preferred), WCAG 2.2 AA, and a single `docs/traceability.md` that maps real requirement IDs. |
| B9 | Provisioning must finish in 60 s and be retry-safe | Serverless timeout and partial tenants | Provisioning is an idempotent **saga** with a step log per instance (create record, create indexes/collections, seed pack, owner invite, subdomain). Each step is re-runnable; failure leaves a `provisioning_failed` instance, never an active one. |
| B10 | 60 s toggle propagation with serverless | Stale caches | Settings carry `configVersion`; in-process cache TTL 30 s; version check on request; `revalidateTag('tenant-<id>')` on save. Verified by a test. |
| B11 | Money and inventory correctness | Overselling, float errors | Integer minor units only (`Money` type with currency exponent). Stock deduction via conditional atomic `findOneAndUpdate`; reservation is advisory. |
| B12 | Local dev needs subdomains | Host-based routing hard to test | Use `*.localhost` (resolves to loopback). Tenant resolved from Host header only. |
| B13 | Time: the SRS is very large | Cannot finish everything | Ship vertical slices per phase. Order of value: tenant core -> toggles -> provisioning/Super Admin -> catalog/storefront -> cart/checkout/orders -> staff/fulfilment -> extras. |

## 2. Architecture (what gets built)

- Next.js 16 App Router, TypeScript, Tailwind 4. One app, `proxy`/middleware resolves Host -> instance.
- Route groups: `(platform)` public site + signup, `(superadmin)`, `(admin)` store admin, `(store)` storefront.
- `lib/tenant`: `resolveHost()`, `TenantContext` (branded type, immutable), `getTenantDb(ctx)`.
- `lib/db`: single global `MongoClient`; platform DB (`platform`: instances, plans, toggle catalog, audit_log append-only, users for super admins) and `tenant_{id}` DBs.
- `lib/toggles`: catalogue, DAG validation (cycle check), evaluator implementing SRS 7.1 precedence, kill-switch.
- `lib/auth`: argon-class hashing (bcryptjs for now, ADR to move to Argon2id), signed session cookies via jose, RBAC with named actions, deny by default.
- `lib/money`, `lib/audit`, `lib/outbox`, `lib/jobs`, `lib/ports/*` (payments, mail, storage, cache).
- `catalog/packs/*.json` for the 8 industry packs.
- i18n: English + Urdu with CSS logical properties and `dir` switching.

## 3. Phases (workflow Phases 0-7, with SRS Stage mapping)

| Phase | Scope | SRS stage | Exit gate (summary) |
|-------|-------|-----------|---------------------|
| 0 | Repo foundation: tsconfig, lint, vitest, env template, ADRs, traceability, status file | Stage 0 | Builds; no secrets committed; decisions documented |
| 1 | Tenant foundation: host resolution, TenantContext, repositories, RBAC, audit, toggle engine + full 145 catalogue, migrations runner | Stage 0 | Unknown host 404; cross-tenant tests pass; toggle precedence deterministic |
| 2 | Super Admin, provisioning saga, subdomain checks, plans, impersonation, owner invite, setup wizard | Stage 1 | Retry-safe provisioning; suspend/reactivate keeps data |
| 3 | Catalog, categories, variants, media, storefront grid/search/PDP, branding, EN/UR RTL | Stage 1 | Tenant-isolated catalog; a11y and RTL checks |
| 4 | Cart, checkout, mock gateway + webhooks, order/payment state machines, stock | Stage 1 | Totals match snapshot; duplicate webhooks safe; no oversell in concurrency test |
| 5 | Staff roles, order queue/KDS, notifications via outbox, refunds/returns, customer accounts | Stage 2 | Least privilege; idempotent notifications |
| 6 | Imports/exports, webhooks, reports, custom domains, PWA, loyalty, AI copy (draft-only) | Stage 3 | Each integration scoped, audited, health-checked |
| 7 | Security review, load/restore/DR evidence, a11y audit, runbooks | Stage 2-3 | SRS section 25 evidence complete |

## 4. Draft decisions (defaults; owner to confirm, recorded in docs/decisions/)

- DEC-01 Markets: Pakistan first; currencies PKR (+USD display); languages EN/UR. Tax: configurable rate per instance, no legal advice implied.
- DEC-02 Payments: mock gateway adapter now; Stripe + one regional adapter later. Authorize/capture split modeled; refunds idempotent.
- DEC-03 Provisioning: operator-created first (Phase 2); paid self-service after Phase 4 payments work.
- DEC-04 Isolation: see B1/B2.
- DEC-05 State machines: order `pending -> confirmed -> processing -> (partially_)fulfilled -> completed | cancelled`; payment `requires_payment -> authorized -> captured -> (partially_)refunded | failed | disputed`. Separate and audited.
- DEC-06 Inventory: DB conditional decrement is authoritative; 10-minute advisory reservation; release on failure/expiry.
- DEC-07 Retention: audit 2 y hot + archive; orders kept for tax period; deletion schedule documented, backups expire on rotation.
- DEC-08 SLOs: 99.5% storefront; RPO 24 h (daily backup) until PITR is on.
- DEC-09 Toggles: forced-off/forced-on separate; kill-switch outranks all; AND/OR prerequisite groups explicit in data.

## 5. Working rules for this repository

- Secrets only in `.env.local` (git-ignored). `atlas-credentials.env` never committed or logged.
- No commits, pushes, deploys or paid accounts without the owner asking.
- Every change: tests, then report PASS / FAIL / NOT RUN / BLOCKED honestly.
- New ideas go to `docs/feature-proposals.md` unless small and in-phase.

## 6. Next smallest task (needs owner approval to start)

Phase 0: tsconfig/eslint/vitest config, `.env.example`, ADR files for DEC-01..09, `docs/traceability.md`, then Phase 1 tenant core with the first cross-tenant test.
