# Bekies Braai Place — marketplace website

React 19 + Vite + Tailwind v4 frontend (ported from the Figma Make design) and a Node/Express 4 API backed by SQLite (`node:sqlite`). Node 22+ required.

## Run it
```bash
npm install
cp .env.example server/.env      # then edit secrets
npm run seed                     # optional: wipe + reseed demo data
npm run dev                      # API :4000 + Vite :5173 (proxying /api)
```
Production: `npm run build && npm start` → one server on :4000 serves `client/dist` and `/api`.
Tests: `npm test` (25 API tests).

## Demo accounts (DEMO_MODE=true)
| Role | Email | Password |
|---|---|---|
| Admin | admin@bekies.test | Admin123! |
| Manager | manager@bekies.test | Manager123! |
| Seller | seller@bekies.test | Seller123! |
| Buyer | lerato@bekies.test | Buyer123! |

Promo codes: `BRAAI10`, `WELCOME50`, `FREESHIP`. Free delivery over R750, otherwise R85.

## Environment
`PORT`, `JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `CLIENT_ORIGIN`, `DATABASE_FILE`, `UPLOAD_DIR`, `DEMO_MODE`, optional `ADMIN_EMAIL`/`ADMIN_PASSWORD` to seed a first admin.

## What's inside
- **Storefront**: home, shop (filters, sort, pagination), product + reviews, cart (guest cookie merges on login), promo codes, checkout, order tracking, wishlist, store pages, help/contact/policy pages.
- **Seller onboarding**: 5-step application, draft save, document upload (magic-byte validated, private storage), admin review workflow.
- **Portals** (`/portal`): role-specific overview, orders (state machine, seller sub-orders), products + moderation, inventory, payouts, payments/refunds, users & roles with granular permissions, audit log, support tickets, addresses, store/account settings.
- **Backend rules**: atomic stock reservation, HMAC-signed idempotent payment webhooks (a browser redirect never confirms payment), ledger with 10% commission, refunds needing permission + password re-entry, append-only audit log, transactional outbox for notifications, helmet/CORS/rate limits, httpOnly JWT cookie.

## Going live checklist
1. **Set `DEMO_MODE=false`** and `ADMIN_EMAIL` / `ADMIN_PASSWORD` — this seeds only categories + promo codes and creates your first admin (change the password after first sign-in). No demo accounts or fake orders.
2. **Email** — set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (any SMTP provider). Used for password resets, email confirmation, receipts, dispatch/delivery notices, refunds and seller decisions. Failed sends retry with backoff. Check `GET /api/health` and the `emails` table for `failed` rows.
3. **Payments** — create a PayFast merchant account, set `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE` and `PAYFAST_SANDBOX=false`. Set `PUBLIC_URL` to your public https address — PayFast calls `PUBLIC_URL/api/payments/payfast/itn`, so it must be reachable from the internet. Orders are only marked paid after PayFast's signed notification passes signature, merchant, amount and PayFast-postback checks; the browser redirect never confirms payment. If neither PayFast nor `DEMO_MODE` is on in production, checkout is disabled rather than accepting unpaid orders.
4. **Storage** — mount a persistent volume for `DATABASE_FILE` and `UPLOAD_DIR` and back it up. Product photos live in `UPLOAD_DIR/public`; seller verification documents stay private in `UPLOAD_DIR`.
5. **Business details** — update phone/email/address in `client/src/siteConfig.ts` and `server/src/config.js`, and have the policy pages (`client/src/pages/Content.tsx`) reviewed by a lawyer. Set payout banking details process (payouts are recorded in the ledger; the actual EFT to sellers is manual).

## Before going live
The payment provider is a **demo** that signs events through the real webhook path. You still need: a real payment gateway adapter (e.g. PayFast/Stripe), an email/SMS provider (outbox consumers are stubs), private object storage for documents, DB backups (or a server DB), email verification/MFA, and legal review of the template policy pages. Product images are hotlinked from Unsplash — replace with your own.

## Deploy to Railway
1. New Project → Deploy from GitHub repo → this repo (`railway.json` configures build/start).
2. Add a **Volume** mounted at `/data`.
3. Variables: `NODE_ENV=production`, `JWT_SECRET` (long random), `PAYMENT_WEBHOOK_SECRET` (long random), `DATABASE_FILE=/data/bekies.db`, `UPLOAD_DIR=/data/uploads`, `CLIENT_ORIGIN=https://<your-app>.up.railway.app`, `DEMO_MODE=true` (or `false` plus `ADMIN_EMAIL`/`ADMIN_PASSWORD`). Railway supplies `PORT`.
4. Settings → Networking → Generate Domain.
