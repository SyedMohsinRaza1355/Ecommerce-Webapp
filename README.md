# Multi-Tenant Ecommerce Platform

Next.js 16 + MongoDB Atlas. Spec: Master SRS v3.0. Plan: `docs/DEVELOPMENT_PLAN.md`. Status: `docs/implementation-status.md`.

## Run locally
```bash
npm install
cp .env.example .env.local   # fill MONGODB_URI and SESSION_SECRET
npm run dev
```
Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## Payments and email (what each store owner does)
- Owners open **Payments** in their store admin. For card payments they paste their own Stripe secret key (one field); the platform checks it, stores it encrypted and registers the payment notification in the owner's Stripe account. Money goes straight to the owner.
- Owners without Stripe can add Easypaisa, JazzCash or bank transfer details. Customers pay, enter their receipt number, and the owner presses **Mark as paid**.
- Platform operator, once: set `RESEND_API_KEY` and `EMAIL_FROM` (see `.env.example`) so order emails are really delivered, and `CRON_SECRET` so the daily housekeeping job can run.

Never commit `.env*` files or credentials.
