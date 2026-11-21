# Operations runbooks

## Everyday commands

```bash
npm run lint && npm run typecheck && npm test        # unit + database integration tests
npm run build                                        # production build
```

Black-box security and standards suite (needs a running production build against a scratch database):

```bash
PLATFORM_DB_NAME=e2e_ui PLATFORM_BASE_DOMAIN=localhost:3100 npx next start -p 3100 &
E2E=1 PLATFORM_DB_NAME=e2e_ui PLATFORM_BASE_DOMAIN=localhost:3100 npx vitest run src/e2e
```

The suite expects a store called `demo-burgers` with an owner (created through the UI walkthrough). Drop the scratch database afterwards.

Accessibility scan: copy `node_modules/axe-core/axe.min.js` to `public/`, open a page, load `/axe.min.js`, run `axe.run()`. Remove the file before deploying.

## Create a demo store on any environment

`SEED_DEMO=1 PLATFORM_DB_NAME=platform npx vitest run src/e2e/seed-demo.test.ts`. Credentials are written to `files and creds/demo-credentials.txt` (git-ignored), never printed.

## Incidents

**A feature is misbehaving everywhere (provider outage, bug)**
Super Admin, Kill switch, force the feature off. Takes effect in about 30 seconds, no deploy. Remove the switch afterwards. Every change is in the audit log.

**One store is misbehaving**
Super Admin, Stores, open the store. Lock or override the feature, or suspend the store (customers see a notice, data is kept). Use "Sign in as owner" (reason required, 30 minutes, owner emailed, every page logged) to reproduce.

**Suspected cross-store data exposure**
1. Kill switch the suspect feature, suspend affected stores.
2. Preserve evidence: do not delete audit log entries or databases.
3. Run `src/e2e/security.http.test.ts` and `commerce.test.ts` isolation tests to localise.
4. Rotate `SESSION_SECRET` (signs everyone out) and the Atlas database password; update Vercel variables and redeploy.
5. Notify affected store owners (breach notice obligations depend on the market: see ADR DEC-01/DEC-07).

**Payments look wrong**
Orders only become paid through signed webhooks. Check `payment_events` (deduplicated by event id) and the order history timeline. Orders flagged "Refund due" were paid after being cancelled and need a manual refund. Abandoned card orders expire after 30 minutes and return their stock.

**Customer emails not arriving**
Admin, Messages shows queued, sent and dead messages. Messages retry with exponential backoff up to 5 times, then become "failed for good". This build records messages instead of sending; connect a real provider through the `lib/commerce/outbox.ts` adapter boundary.

**Rate limiting blocks real users**
Counters live in the `rate_limits` collection (TTL-expired). Delete the document for the key to unblock a user.

## Backups and restore (open item)

The development Atlas cluster is the free tier: no scheduled backups. Before launch:
- Use M10 or higher with continuous backup and point-in-time restore; target RPO 24 hours or better, RTO 60 minutes (ADR DEC-08).
- Restore drill monthly: restore one tenant database to a scratch cluster, run the commerce integration tests against it, record the time.
- Tenant offboarding: export (`Export store data`), then drop `tenant_<id>` and remove the instance record after the grace period (DEC-07).

## Configuration reference

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string (secret) |
| `PLATFORM_DB_NAME` | platform control-plane database (default `platform`) |
| `SESSION_SECRET` | signs sessions and tracking tokens, derives the webhook secret (secret, 32+ chars) |
| `PLATFORM_BASE_DOMAIN` | host that serves the platform; `name.<domain>` serves a store |
| `SETUP_KEY` | one-time key for creating the first Super Admin (remove after use) |
| `GATEWAY_WEBHOOK_SECRET` | optional dedicated webhook secret |
