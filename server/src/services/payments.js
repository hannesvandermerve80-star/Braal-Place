import crypto from "node:crypto";
import { all, one, run, tx } from "../db/index.js";
import { config } from "../config.js";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../lib/httpError.js";
import { assertTransition, PAYMENT_TRANSITIONS, rollupOrderStatus } from "../lib/stateMachines.js";
import { audit } from "./audit.js";
import { publish } from "./outbox.js";

/* ---- webhook signing (HMAC-SHA256 over the raw body) ---- */
export const signPayload = (raw) => crypto.createHmac("sha256", config.webhookSecret).update(raw).digest("hex");
export function verifySignature(raw, signature) {
  if (!signature || !raw) return false;
  const expected = Buffer.from(signPayload(raw));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

const setPayment = (id, to, extra = "") => {
  const p = one("SELECT * FROM payments WHERE id=?", id);
  assertTransition(PAYMENT_TRANSITIONS, p.status, to, "payment status");
  run(`UPDATE payments SET status=?, updated_at=datetime('now') ${extra} WHERE id=?`, to, id);
};

/**
 * Idempotent provider-event handler. Only a verified event can mark a payment confirmed —
 * a frontend redirect never does. A duplicate provider event id is a no-op.
 */
export function handleProviderEvent(provider, event, req = null) {
  return tx(() => {
    const seen = one("SELECT 1 FROM webhook_events WHERE provider=? AND provider_event_id=?", provider, event.id);
    if (seen) return { duplicate: true };
    run("INSERT INTO webhook_events (provider, provider_event_id, type) VALUES (?,?,?)", provider, event.id, event.type);

    const payment = one("SELECT * FROM payments WHERE provider=? AND provider_ref=?", provider, event.paymentRef);
    if (!payment) throw notFound("Unknown payment reference");
    const order = one("SELECT * FROM orders WHERE id=?", payment.order_id);

    if (event.type === "payment.succeeded") {
      if (event.amountCents !== undefined && event.amountCents !== payment.amount_cents) throw unprocessable("Amount mismatch");
      if (payment.status === "confirmed") return { duplicate: true };
      if (order.status === "cancelled") throw conflict("Order was cancelled before payment completed");
      setPayment(payment.id, "confirmed");
      run("UPDATE orders SET payment_status='confirmed', status='confirmed', updated_at=datetime('now') WHERE id=?", order.id);
      for (const so of all("SELECT * FROM seller_orders WHERE order_id=?", order.id)) {
        run("UPDATE seller_orders SET status='confirmed', updated_at=datetime('now') WHERE id=?", so.id);
        run("INSERT INTO order_events (order_id, seller_order_id, status, title) VALUES (?,?,?,?)", order.id, so.id, "confirmed", "Payment confirmed — order confirmed");
        // Commit reserved stock
        for (const it of all("SELECT product_id, qty FROM order_items WHERE seller_order_id=?", so.id)) {
          run("UPDATE inventory SET stock = stock - ?, reserved = MAX(0, reserved - ?) WHERE product_id=?", it.qty, it.qty, it.product_id);
        }
        // Single server-side ledger: one sale + one commission entry per seller sub-order
        run("INSERT INTO ledger_entries (store_id, order_id, seller_order_id, kind, amount_cents) VALUES (?,?,?,?,?)", so.store_id, order.id, so.id, "sale", so.subtotal_cents);
        run("INSERT INTO ledger_entries (store_id, order_id, seller_order_id, kind, amount_cents) VALUES (?,?,?,?,?)", so.store_id, order.id, so.id, "commission", -so.commission_cents);
      }
      if (order.user_id) run("UPDATE users SET rewards_points = rewards_points + ? WHERE id=?", Math.floor(order.total_cents / 1000), order.user_id);
      publish("payment.confirmed", { orderId: order.id, number: order.number, userId: order.user_id });
      publish("order.status_changed", { orderId: order.id, number: order.number, userId: order.user_id, status: "confirmed", title: "Payment confirmed — order confirmed" });
      audit(req, "payment.confirmed", "order", order.number, { provider, ref: payment.provider_ref });
      return { duplicate: false, status: "confirmed" };
    }

    if (event.type === "payment.failed") {
      if (payment.status === "confirmed") return { duplicate: true };
      setPayment(payment.id, "failed");
      run("UPDATE orders SET payment_status='failed', updated_at=datetime('now') WHERE id=? AND payment_status != 'confirmed'", order.id);
      run("INSERT INTO order_events (order_id, status, title) VALUES (?,?,?)", order.id, "pending_payment", "Payment failed — you can try again");
      audit(req, "payment.failed", "order", order.number, { provider, ref: payment.provider_ref });
      return { duplicate: false, status: "failed" };
    }
    throw badRequest(`Unsupported event type: ${event.type}`);
  });
}

/**
 * Demo provider: simulates the hosted payment page by sending a *signed* event through the same
 * code path a real provider webhook uses. Never exposed with real card data.
 */
export function demoCharge(order, outcome, req) {
  if (order.payment_status === "confirmed") throw conflict("This order is already paid");
  if (order.status === "cancelled") throw conflict("This order was cancelled");
  let payment = one("SELECT * FROM payments WHERE order_id=? AND status IN ('initiated','pending') ORDER BY id DESC LIMIT 1", order.id);
  if (!payment) {
    // previous attempt failed — open a fresh payment attempt
    run("INSERT INTO payments (order_id, provider, provider_ref, amount_cents, status) VALUES (?,?,?,?,?)", order.id, "demo", `pay_${crypto.randomBytes(9).toString("hex")}`, order.total_cents, "initiated");
    run("UPDATE orders SET payment_status='initiated' WHERE id=?", order.id);
    payment = one("SELECT * FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1", order.id);
  }
  const body = JSON.stringify({
    id: `evt_${crypto.randomBytes(8).toString("hex")}`,
    type: outcome === "success" ? "payment.succeeded" : "payment.failed",
    paymentRef: payment.provider_ref,
    amountCents: payment.amount_cents,
  });
  // simulate the provider → webhook hop, including signature verification
  if (!verifySignature(body, signPayload(body))) throw forbidden("Bad signature");
  return handleProviderEvent("demo", JSON.parse(body), req);
}

/** Open (or reuse) a payment attempt for an order with the given provider. */
export function ensurePaymentAttempt(order, provider) {
  if (order.payment_status === "confirmed") throw conflict("This order is already paid");
  if (order.status === "cancelled") throw conflict("This order was cancelled");
  return tx(() => {
    let payment = one("SELECT * FROM payments WHERE order_id=? AND provider=? AND status IN ('initiated','pending') ORDER BY id DESC LIMIT 1", order.id, provider);
    if (!payment) {
      run("INSERT INTO payments (order_id, provider, provider_ref, amount_cents, status) VALUES (?,?,?,?,?)", order.id, provider, `${provider === "payfast" ? "pf" : "pay"}_${crypto.randomBytes(9).toString("hex")}`, order.total_cents, "initiated");
      run("UPDATE orders SET payment_status='initiated' WHERE id=?", order.id);
      payment = one("SELECT * FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1", order.id);
    }
    return payment;
  });
}

/* ------------------------------------------------------------------ refunds */
export function requestRefund({ req, order, amountCents, reason }) {
  return tx(() => {
    const payment = one("SELECT * FROM payments WHERE order_id=? AND status IN ('confirmed','partially_refunded') ORDER BY id DESC LIMIT 1", order.id);
    if (!payment) throw conflict("No captured payment to refund");
    const pending = one("SELECT COALESCE(SUM(amount_cents),0) s FROM refunds WHERE payment_id=? AND status IN ('requested','approved')", payment.id).s;
    const refundable = payment.amount_cents - payment.refunded_cents - pending;
    const amount = amountCents ?? refundable;
    if (amount <= 0 || amount > refundable) throw unprocessable(`Refund cannot exceed the captured funds (refundable: R${(Math.max(0, refundable) / 100).toFixed(2)})`);
    const r = run("INSERT INTO refunds (payment_id, order_id, amount_cents, reason, status, requested_by) VALUES (?,?,?,?, 'requested', ?)", payment.id, order.id, amount, reason ?? null, req.user?.id ?? null);
    audit(req, "refund.requested", "order", order.number, { amountCents: amount, reason });
    return one("SELECT * FROM refunds WHERE id=?", Number(r.lastInsertRowid));
  });
}

export function decideRefund({ req, refundId, approve, note }) {
  return tx(() => {
    const refund = one("SELECT * FROM refunds WHERE id=?", refundId);
    if (!refund) throw notFound("Refund not found");
    if (refund.status !== "requested") throw conflict(`Refund already ${refund.status}`);
    if (!approve) {
      run("UPDATE refunds SET status='rejected', decided_by=?, decided_at=datetime('now') WHERE id=?", req.user.id, refund.id);
      audit(req, "refund.rejected", "refund", refund.id, { note });
      return one("SELECT * FROM refunds WHERE id=?", refund.id);
    }
    const payment = one("SELECT * FROM payments WHERE id=?", refund.payment_id);
    const order = one("SELECT * FROM orders WHERE id=?", refund.order_id);
    if (refund.amount_cents > payment.amount_cents - payment.refunded_cents) throw unprocessable("Refund cannot exceed captured funds");

    const newRefunded = payment.refunded_cents + refund.amount_cents;
    const full = newRefunded >= payment.amount_cents;
    setPayment(payment.id, full ? "refunded" : "partially_refunded", ", refunded_cents = " + newRefunded);
    run("UPDATE orders SET payment_status=?, updated_at=datetime('now') WHERE id=?", full ? "refunded" : "partially_refunded", order.id);

    // Allocate the refund across seller sub-orders proportionally (commission is clawed back pro-rata)
    const sos = all("SELECT * FROM seller_orders WHERE order_id=?", order.id);
    const totalSub = sos.reduce((n, s) => n + s.subtotal_cents, 0) || 1;
    let remaining = refund.amount_cents;
    sos.forEach((so, idx) => {
      const share = idx === sos.length - 1 ? remaining : Math.min(remaining, Math.round((refund.amount_cents * so.subtotal_cents) / totalSub));
      remaining -= share;
      if (share <= 0) return;
      const commissionShare = Math.round((share * so.commission_cents) / Math.max(1, so.subtotal_cents));
      run("INSERT INTO ledger_entries (store_id, order_id, seller_order_id, kind, amount_cents) VALUES (?,?,?,?,?)", so.store_id, order.id, so.id, "refund", -share);
      run("INSERT INTO ledger_entries (store_id, order_id, seller_order_id, kind, amount_cents) VALUES (?,?,?,?,?)", so.store_id, order.id, so.id, "refund_commission", commissionShare);
    });
    if (full) {
      for (const so of sos) {
        if (so.status === "delivered") {
          run("UPDATE seller_orders SET status='refunded', updated_at=datetime('now') WHERE id=?", so.id);
          run("INSERT INTO order_events (order_id, seller_order_id, status, title) VALUES (?,?,?,?)", order.id, so.id, "refunded", "Order refunded");
        }
      }
      run("UPDATE orders SET status=? WHERE id=?", rollupOrderStatus(all("SELECT status FROM seller_orders WHERE order_id=?", order.id).map((s) => s.status)), order.id);
    }
    run("UPDATE refunds SET status='completed', decided_by=?, decided_at=datetime('now') WHERE id=?", req.user.id, refund.id);
    publish("refund.completed", { number: order.number, userId: order.user_id, amountCents: refund.amount_cents });
    audit(req, "refund.approved", "refund", refund.id, { amountCents: refund.amount_cents, order: order.number, note });
    return one("SELECT * FROM refunds WHERE id=?", refund.id);
  });
}
