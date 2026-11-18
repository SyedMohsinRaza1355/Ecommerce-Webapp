# Multi-Tenant Ecommerce Platform

Next.js 16 + MongoDB Atlas. Spec: Master SRS v3.0. Plan: `docs/DEVELOPMENT_PLAN.md`. Status: `docs/implementation-status.md`.

## Run locally
```bash
npm install
cp .env.example .env.local   # fill MONGODB_URI and SESSION_SECRET
npm run dev
```
Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

Never commit `.env*` files or credentials.
