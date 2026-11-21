# Standards compliance matrix

What the platform does against recognised standards, where the evidence is, and what is still open.
Status: **Met** (implemented and tested), **Partial** (implemented with a stated gap), **Open** (needs a decision, account or external step).

## Security (OWASP ASVS level 2, ISO 27001-style controls)

| Control | Status | Evidence |
|---|---|---|
| Server-side authorisation on every request, deny by default | Met | `lib/auth/rbac.ts`, `lib/commerce/guard.ts`; 103 HTTP tests in `src/e2e/security.http.test.ts` (every admin page x signed-out / other store / wrong role) |
| Tenant isolation (database per store, mandatory TenantContext, instanceId stamp on every query) | Met | `lib/tenant/*`; cross-tenant tests in `integration.test.ts`, `commerce.test.ts`, HTTP suite |
| Tenant derived only from Host / verified route, never from client input | Met | `proxy.ts`, `lib/tenant/resolve.ts`; forged `x-tenant-id` test |
| Password storage | Partial | bcrypt cost 12 (`lib/auth/password.ts`). SRS asks for Argon2id: move before launch (ADR DEC-04 follow-up) |
| Mandatory two-factor for staff (TOTP, RFC 6238) with replay protection | Met | `lib/auth/totp.ts` (RFC vectors tested), enforced in `lib/commerce/load.ts` |
| Rate limiting across serverless instances | Met | DB-backed counters `lib/auth/ratelimit.ts` (login, staff login, setup, invite, checkout, webhook, API) |
| Session management: signed tokens, httpOnly/secure/sameSite cookies, revocation on password change / disable / role change, 30-min impersonation | Met | `lib/auth/session.ts`, `lib/commerce/load.ts` |
| Brute-force resistance without user enumeration (dummy hash, identical errors) | Met | `authenticateStaff` tests |
| Security headers: CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP | Met | `next.config.ts`; header tests |
| CSP with per-request nonce and strict-dynamic (no inline script execution) | Met | `src/proxy.ts`, `lib/csp.ts`; verified in a browser: hydration and server actions work, no violations |
| Input validation (zod, server-side), HTTPS-only image links, regex escaping in search | Met | `lib/commerce/store.ts`; hostile-input tests (no 5xx) |
| Webhook authenticity: HMAC-SHA256, timing-safe compare, 5-minute replay window, dedupe by event id, amount check | Met | `lib/commerce/gateway.ts`, `orders.ts`; webhook tests |
| Append-only audit trail with secret redaction | Partial | app exposes insert only (`lib/audit/log.ts`); database-level append-only role needs a paid Atlas custom role |
| Secrets management | Met | secrets only in env; `.gitignore`; Vercel sensitive variables; npm audit 0 vulnerabilities |
| Vulnerability disclosure | Met | `/.well-known/security.txt` (RFC 9116) with a placeholder contact to replace |
| Dependency / supply chain checks | Met | `npm audit` clean, Dependabot + CI workflow in `.github/` |

## Payments (PCI DSS SAQ-A)

| Control | Status | Evidence |
|---|---|---|
| No card data in pages, databases or logs | Met | no card fields (HTTP DOM scan), only gateway reference stored, log redaction tests |
| Payment proof only from verified webhook, never a browser redirect | Met | order stays `pending` until signed event (`commerce.test.ts`) |
| Idempotent orders and payments; no double charge or oversell | Met | idempotency-key, unique indexes, 25-buyer race test, refund race test |
| Real gateway adapter and PCI scope sign-off | Open | mock gateway only (DEC-02); needs an approved provider account |

## Privacy (GDPR / PDPA style)

| Control | Status | Evidence |
|---|---|---|
| Privacy notice, essential-cookies-only notice | Met | `/privacy`, cookie notice, no `Set-Cookie` on storefront pages |
| Right of access (export) and erasure (anonymise, totals kept) | Met | admin Privacy page, `privacy/export` route, `anonymizeCustomer` tests |
| Data minimisation (no card data, no tracking, no third-party scripts) | Met | CSP `default-src 'self'` |
| Retention / backup expiry / legal hold policy | Open | drafted in ADR DEC-07, needs legal review per market |
| Data region and processor agreements | Open | DEC-05 / D-5 |

## Accessibility (WCAG 2.2 AA)

| Control | Status | Evidence |
|---|---|---|
| Automated scan (axe-core, wcag2a/2aa/21aa/22aa + best practice) on storefront, cart, admin pages | Met | zero violations after fixes; run documented in `docs/runbooks.md` |
| Colour contrast guard for brand colours (4.5:1) | Met | `lib/color.ts`, settings colour picker, layout fallback |
| Keyboard use, visible focus, skip links, landmarks, labels, live regions for errors | Met | components + HTTP structure tests |
| Reduced-motion support, 44px touch targets, responsive to 375px | Met | `globals.css`, mobile screenshot check |
| Right-to-left Urdu layout with logical properties | Met | `[dir="rtl"]` styles, screenshot verified |
| Manual screen-reader and 200% zoom audit | Open | needs a human pass before launch (ADD-066) |

## Web, SEO and PWA

| Control | Status | Evidence |
|---|---|---|
| Per-page title/description, canonical links, JSON-LD Product, robots.txt, sitemap per store | Met | metadata + HTTP tests |
| Installable PWA: manifest, icon, scoped service worker that never caches private pages | Met | `manifest.webmanifest`, `sw.js`, `icon` routes |
| Core Web Vitals field measurement | Open | needs real traffic / RUM (ADD-067) |

## Money and data correctness

| Control | Status | Evidence |
|---|---|---|
| Integer minor units (ISO 4217 exponents), documented calculation order, historic orders immutable | Met | `lib/money`, `pricing.ts`, snapshot tests |
| Order and payment state machines separate, atomic, audited, stale-write safe | Met | `states.ts`, tests |
| Transactional outbox with backoff and dead-letter | Met | `outbox.ts`, tests |

## Operations

| Control | Status | Evidence |
|---|---|---|
| Health endpoint, structured redacted logs | Met | `/api/health`, `lib/log.ts` |
| Backups, restore drills, SLOs | Open | Atlas free tier has no backups; see `docs/runbooks.md` |
| Load test at 1,000 tenants | Open | needs a paid cluster (ADR DEC-04); local 200-request load test passes |
