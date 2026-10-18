import { all, one, run, tx } from "../db/index.js";

/** Publish a domain event. Call inside the same tx as the state change. */
export function publish(type, payload) {
  run("INSERT INTO outbox (type, payload) VALUES (?, ?)", type, JSON.stringify(payload));
}

const notify = (userId, type, title, body, link, eventId) => {
  if (!userId) return;
  run(
    "INSERT OR IGNORE INTO notifications (user_id, type, title, body, link, source_event_id) VALUES (?,?,?,?,?,?)",
    userId, type, title, body ?? null, link ?? null, eventId,
  );
};
const adminsAndManagers = () => all("SELECT id FROM users WHERE role IN ('admin','manager') AND status='active'");
const storeOwners = (storeId) => all("SELECT user_id AS id FROM store_members WHERE store_id=?", storeId);

/**
 * Consumers are idempotent: notifications are unique per (user, type, event id),
 * so a retried event never creates duplicates.
 */
const consumers = {
  "seller.submitted": (e, p) => adminsAndManagers().forEach((u) => notify(u.id, e.type, "New seller application", `${p.businessName || "A seller"} submitted an application for review.`, "/portal/applications", e.id)),
  "seller.approved": (e, p) => notify(p.userId, e.type, "Application approved", "Your seller application was approved. Your store is now live.", "/portal/products", e.id),
  "seller.rejected": (e, p) => notify(p.userId, e.type, "Application update", p.note || "Your seller application was not approved.", "/sell", e.id),
  "seller.suspended": (e, p) => notify(p.userId, e.type, "Store suspended", p.note || "Your store has been suspended.", null, e.id),
  "product.submitted": (e, p) => adminsAndManagers().forEach((u) => notify(u.id, e.type, "Product awaiting moderation", `${p.name} was submitted for approval.`, "/portal/products", e.id)),
  "product.approved": (e, p) => storeOwners(p.storeId).forEach((u) => notify(u.id, e.type, "Product published", `${p.name} is now live in the marketplace.`, "/portal/products", e.id)),
  "product.changes_requested": (e, p) => storeOwners(p.storeId).forEach((u) => notify(u.id, e.type, "Changes requested", `${p.name}: ${p.note || "please review the moderation note."}`, "/portal/products", e.id)),
  "order.placed": (e, p) => {
    if (p.userId) notify(p.userId, e.type, `Order ${p.number} placed`, "We have received your order and are awaiting payment confirmation.", `/track/${p.number}`, e.id);
    p.storeIds.forEach((sid) => storeOwners(sid).forEach((u) => notify(u.id, e.type, `New order ${p.number}`, "A new order includes your products.", "/portal/orders", e.id)));
  },
  "payment.confirmed": (e, p) => {
    if (p.userId) notify(p.userId, e.type, `Payment received for ${p.number}`, "Your payment was confirmed. Sellers are preparing your order.", `/track/${p.number}`, e.id);
  },
  "order.status_changed": (e, p) => {
    if (p.userId) notify(p.userId, e.type, `Order ${p.number}: ${String(p.status).replace(/_/g, " ")}`, p.title, `/track/${p.number}`, e.id);
  },
  "refund.completed": (e, p) => { if (p.userId) notify(p.userId, e.type, `Refund processed for ${p.number}`, `R${(p.amountCents / 100).toFixed(2)} will reach you in 3–5 working days.`, `/track/${p.number}`, e.id); },
  "support.created": (e, p) => adminsAndManagers().forEach((u) => notify(u.id, e.type, "New support request", p.subject, "/portal/support", e.id)),
};

const MAX_ATTEMPTS = 5;

/** Process due events once. Failed events retry with bounded exponential backoff. */
export function processOutbox(limit = 50) {
  const due = all("SELECT * FROM outbox WHERE status='pending' AND next_attempt_at <= datetime('now') ORDER BY id LIMIT ?", limit);
  for (const evt of due) {
    try {
      tx(() => {
        const handler = consumers[evt.type];
        if (handler) handler(evt, JSON.parse(evt.payload));
        run("UPDATE outbox SET status='done', processed_at=datetime('now') WHERE id=?", evt.id);
      });
    } catch (err) {
      const attempts = evt.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) run("UPDATE outbox SET status='failed', attempts=?, last_error=? WHERE id=?", attempts, String(err.message), evt.id);
      else {
        const delay = Math.min(2 ** attempts * 5, 300);
        run("UPDATE outbox SET attempts=?, last_error=?, next_attempt_at=datetime('now', ?) WHERE id=?", attempts, String(err.message), `+${delay} seconds`, evt.id);
      }
    }
  }
  return due.length;
}

let timer;
export function startOutboxWorker(intervalMs = 2000) {
  stopOutboxWorker();
  timer = setInterval(() => { try { processOutbox(); } catch (e) { console.error("[outbox]", e); } }, intervalMs);
  timer.unref();
}
export function stopOutboxWorker() { if (timer) clearInterval(timer); }
export const pendingCount = () => one("SELECT COUNT(*) c FROM outbox WHERE status='pending'").c;
