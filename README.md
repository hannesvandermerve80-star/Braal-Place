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

## Before going live
The payment provider is a **demo** that signs events through the real webhook path. You still need: a real payment gateway adapter (e.g. PayFast/Stripe), an email/SMS provider (outbox consumers are stubs), private object storage for documents, DB backups (or a server DB), email verification/MFA, and legal review of the template policy pages. Product images are hotlinked from Unsplash — replace with your own.
