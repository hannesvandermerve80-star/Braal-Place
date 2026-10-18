import crypto from "node:crypto";
import { all, one, run, tx } from "../db/index.js";
import { config } from "../config.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/httpError.js";
import { assertTransition, ORDER_TRANSITIONS, rollupOrderStatus } from "../lib/stateMachines.js";
import { hasPermission } from "../lib/permissions.js";
import { toRand } from "../lib/money.js";
import { computeTotals } from "./pricing.js";
import { audit } from "./audit.js";
import { publish } from "./outbox.js";

export const STATUS_TITLES = {
  pending_payment: "Awaiting payment",
  confirmed: "Order confirmed",
  accepted: "Seller accepted your order",
  packing: "Seller is packing your order",
  ready: "Ready for chilled collection",
  dispatched: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Order cancelled",
  refunded: "Order refunded",
};

const addEvent = (orderId, sellerOrderId, status, actorId = null, title = STATUS_TITLES[status]) =>
  run("INSERT INTO order_events (order_id, seller_order_id, status, title, actor_id) VALUES (?,?,?,?,?)", orderId, sellerOrderId, status, title, actorId);

function estimatedDelivery() {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // no Sunday delivery
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ create */
/**
 * Creates an order from raw items [{productId, qty}]. All prices, delivery, discount, VAT and stock are
 * recalculated server-side. Stock is *reserved* with a conditional UPDATE so concurrent checkouts can never oversell.
 */
export function createOrder({ user = null, contact, address, items, promoCode = null, idempotencyKey = null, now = null }) {
  return tx(() => {
    if (idempotencyKey) {
      const existing = one("SELECT * FROM orders WHERE idempotency_key = ?", idempotencyKey);
      if (existing) return { order: existing, replayed: true };
    }
    if (!items.length) throw badRequest("Your cart is empty");

    const lines = [];
    for (const { productId, qty } of items) {
      const p = one(`SELECT p.*, s.status AS store_status FROM products p JOIN stores s ON s.id=p.store_id WHERE p.id = ?`, productId);
      if (!p || p.status !== "published" || p.store_status !== "active") throw conflict(`"${p?.name ?? "A product"}" is no longer available`);
      if (qty < 1 || qty > config.commerce.maxQtyPerLine) throw badRequest(`Invalid quantity for ${p.name}`);
      // Atomic reservation: only succeeds if enough un-reserved stock remains
      const r = run("UPDATE inventory SET reserved = reserved + ? WHERE product_id = ? AND stock - reserved >= ?", qty, productId, qty);
      if (!r.changes) {
        const avail = one("SELECT stock - reserved AS a FROM inventory WHERE product_id = ?", productId)?.a ?? 0;
        throw conflict(avail > 0 ? `Only ${avail} of "${p.name}" left in stock` : `"${p.name}" is out of stock`, { productId, available: Math.max(0, avail) });
      }
      lines.push({ p, qty });
    }

    const subtotalCents = lines.reduce((n, l) => n + l.p.price_cents * l.qty, 0);
    const totals = computeTotals(subtotalCents, promoCode);
    if (promoCode && !totals.promo.valid) throw badRequest(totals.promo.message || "Invalid promo code");

    const nextId = (one("SELECT COALESCE(MAX(id),0)+1 AS n FROM orders").n);
    const number = `BK-${10000 + nextId}`;
    const created = now || new Date().toISOString().replace("T", " ").slice(0, 19);
    const res = run(
      `INSERT INTO orders (number, user_id, contact, address, status, payment_status, subtotal_cents, delivery_cents, discount_cents, total_cents, vat_cents, promo_code, idempotency_key, estimated_delivery, created_at, updated_at)
       VALUES (?,?,?,?, 'pending_payment','initiated', ?,?,?,?,?,?,?,?,?,?)`,
      number, user?.id ?? null, JSON.stringify(contact), JSON.stringify(address),
      totals.subtotalCents, totals.deliveryCents, totals.discountCents, totals.totalCents, totals.vatCents,
      totals.promo.valid ? totals.promo.code : null, idempotencyKey, estimatedDelivery(), created, created,
    );
    const orderId = Number(res.lastInsertRowid);

    const byStore = new Map();
    for (const l of lines) byStore.set(l.p.store_id, [...(byStore.get(l.p.store_id) || []), l]);
    for (const [storeId, group] of byStore) {
      const sub = group.reduce((n, l) => n + l.p.price_cents * l.qty, 0);
      const commission = Math.round(sub * config.commerce.commissionRate);
      const so = run("INSERT INTO seller_orders (order_id, store_id, status, subtotal_cents, commission_cents, net_cents, updated_at) VALUES (?,?,?,?,?,?,?)",
        orderId, storeId, "pending_payment", sub, commission, sub - commission, created);
      const soId = Number(so.lastInsertRowid);
      for (const l of group) {
        run(`INSERT INTO order_items (order_id, seller_order_id, product_id, store_id, name, sku, image, unit_price_cents, qty, line_total_cents)
             VALUES (?,?,?,?,?,?,?,?,?,?)`, orderId, soId, l.p.id, storeId, l.p.name, l.p.sku, l.p.image, l.p.price_cents, l.qty, l.p.price_cents * l.qty);
      }
    }

    run("INSERT INTO order_events (order_id, status, title, actor_id, created_at) VALUES (?,?,?,?,?)", orderId, "pending_payment", "Order placed — awaiting payment", user?.id ?? null, created);
    const paymentRef = `pay_${crypto.randomBytes(9).toString("hex")}`;
    run("INSERT INTO payments (order_id, provider, provider_ref, amount_cents, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", orderId, "demo", paymentRef, totals.totalCents, "initiated", created, created);

    publish("order.placed", { orderId, number, userId: user?.id ?? null, storeIds: [...byStore.keys()] });
    return { order: one("SELECT * FROM orders WHERE id=?", orderId), replayed: false };
  });
}

/* --------------------------------------------------------------- serialize */
export function serializeOrder(order, { storeId = null, withInternal = false } = {}) {
  const sos = all(`SELECT so.*, s.name AS store_name, s.slug AS store_slug FROM seller_orders so JOIN stores s ON s.id=so.store_id WHERE so.order_id=? ${storeId ? "AND so.store_id=?" : ""} ORDER BY so.id`, ...(storeId ? [order.id, storeId] : [order.id]));
  const items = all(`SELECT * FROM order_items WHERE order_id=? ${storeId ? "AND store_id=?" : ""} ORDER BY id`, ...(storeId ? [order.id, storeId] : [order.id]));
  const events = all(`SELECT * FROM order_events WHERE order_id=? ${storeId ? "AND (seller_order_id IS NULL OR seller_order_id IN (SELECT id FROM seller_orders WHERE order_id=? AND store_id=?))" : ""} ORDER BY id`, ...(storeId ? [order.id, order.id, storeId] : [order.id]));
  const contact = JSON.parse(order.contact);
  const address = JSON.parse(order.address);
  const payment = one("SELECT provider_ref, status, provider FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1", order.id);
  const base = {
    id: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: order.payment_status,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    estimatedDelivery: order.estimated_delivery,
    subtotal: toRand(order.subtotal_cents),
    delivery: toRand(order.delivery_cents),
    discount: toRand(order.discount_cents),
    total: toRand(order.total_cents),
    vat: toRand(order.vat_cents),
    promoCode: order.promo_code,
    contact: withInternal ? contact : { firstName: contact.firstName, lastName: contact.lastName },
    address,
    customer: `${contact.firstName} ${contact.lastName}`,
    items: items.map((i) => ({ id: i.id, productId: i.product_id, storeId: i.store_id, name: i.name, sku: i.sku, image: i.image, unitPrice: toRand(i.unit_price_cents), qty: i.qty, lineTotal: toRand(i.line_total_cents) })),
    sellers: sos.map((s) => ({ storeId: s.store_id, name: s.store_name, slug: s.store_slug, status: s.status, subtotal: toRand(s.subtotal_cents), commission: toRand(s.commission_cents), net: toRand(s.net_cents) })),
    timeline: events.map((e) => ({ status: e.status, title: e.title, at: e.created_at, storeId: e.seller_order_id ? sos.find((s) => s.id === e.seller_order_id)?.store_id ?? null : null })),
    payment: payment ? { provider: payment.provider, reference: payment.provider_ref, status: payment.status } : null,
  };
  if (storeId && sos[0]) { base.status = sos[0].status; base.total = toRand(sos[0].subtotal_cents); }
  return base;
}

/* ----------------------------------------------------------------- access */
/** Returns the order if the viewer may see it (owner / guest email match / seller of an item / staff), else throws 404. */
export function getOrderForViewer(number, user, { email = null } = {}) {
  const order = one("SELECT * FROM orders WHERE number = ?", number);
  if (!order) throw notFound("Order not found");
  if (user) {
    if (order.user_id === user.id) return { order, scope: "buyer" };
    if (user.role === "admin" || hasPermission(user, "orders.manage")) return { order, scope: "staff" };
    if (user.role === "seller") {
      const store = one("SELECT m.store_id FROM store_members m JOIN seller_orders so ON so.store_id=m.store_id AND so.order_id=? WHERE m.user_id=?", order.id, user.id);
      if (store) return { order, scope: "seller", storeId: store.store_id };
    }
  }
  if (email && !order.user_id) {
    const contact = JSON.parse(order.contact);
    if (contact.email?.toLowerCase() === String(email).toLowerCase()) return { order, scope: "guest" };
  }
  throw notFound("Order not found"); // do not reveal existence
}

/* ------------------------------------------------------------ transitions */
const SELLER_ALLOWED = new Set(["accepted", "packing", "ready", "dispatched", "delivered", "cancelled"]);
const BUYER_ALLOWED = new Set(["cancelled"]);

function releaseOrRestock(sellerOrderId, paymentConfirmed) {
  for (const it of all("SELECT product_id, qty FROM order_items WHERE seller_order_id=?", sellerOrderId)) {
    if (paymentConfirmed) run("UPDATE inventory SET stock = stock + ? WHERE product_id=?", it.qty, it.product_id);
    else run("UPDATE inventory SET reserved = MAX(0, reserved - ?) WHERE product_id=?", it.qty, it.product_id);
  }
}

/**
 * Apply a status transition. `to` is validated against the state machine and the actor's scope.
 * `storeId` targets one seller sub-order; omitted = all active sub-orders (staff & buyer cancellation).
 */
export function transitionOrder({ req, order, scope, viewerStoreId = null, to, storeId = null, note = null }) {
  return tx(() => {
    const actor = req.user ?? null;
    if (scope === "buyer" && !BUYER_ALLOWED.has(to)) throw forbidden("Customers can only cancel orders");
    if (scope === "seller" && !SELLER_ALLOWED.has(to)) throw forbidden("Sellers cannot set that status");
    if (scope === "guest") throw forbidden("Sign in to manage this order");
    const target = scope === "seller" ? viewerStoreId : storeId;

    let sos = all("SELECT * FROM seller_orders WHERE order_id=?", order.id);
    if (target) sos = sos.filter((s) => s.store_id === target);
    if (!sos.length) throw notFound("Seller order not found");
    if (scope === "buyer") {
      const advanced = sos.some((s) => !["pending_payment", "confirmed", "cancelled"].includes(s.status));
      if (advanced) throw conflict("This order is already being prepared. Please contact support to cancel.");
    }
    // Skip already-final sub-orders when acting on the whole order (e.g. cancel everything still cancellable)
    const actionable = target ? sos : sos.filter((s) => ORDER_TRANSITIONS[s.status].includes(to));
    if (!actionable.length) assertTransition(ORDER_TRANSITIONS, sos[0].status, to, "order status");

    const paymentConfirmed = order.payment_status === "confirmed" || order.payment_status === "partially_refunded";
    for (const so of actionable) {
      assertTransition(ORDER_TRANSITIONS, so.status, to, "order status");
      if (to === "cancelled") releaseOrRestock(so.id, paymentConfirmed && so.status !== "pending_payment");
      run("UPDATE seller_orders SET status=?, updated_at=datetime('now') WHERE id=?", to, so.id);
      addEvent(order.id, so.id, to, actor?.id, note ? `${STATUS_TITLES[to]} — ${note}` : STATUS_TITLES[to]);
      if (to === "cancelled" && paymentConfirmed && so.status !== "pending_payment") {
        const payment = one("SELECT id FROM payments WHERE order_id=? AND status IN ('confirmed','partially_refunded') ORDER BY id DESC LIMIT 1", order.id);
        if (payment) run("INSERT INTO refunds (payment_id, order_id, amount_cents, reason, status, requested_by) VALUES (?,?,?,?, 'requested', ?)", payment.id, order.id, so.subtotal_cents, `Cancelled ${so.id}${note ? `: ${note}` : ""}`, actor?.id ?? null);
      }
    }
    if (to === "cancelled" && order.payment_status === "initiated") run("UPDATE payments SET status='failed', updated_at=datetime('now') WHERE order_id=? AND status IN ('initiated','pending')", order.id);

    const rolled = rollupOrderStatus(all("SELECT status FROM seller_orders WHERE order_id=?", order.id).map((s) => s.status));
    run("UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=?", rolled, order.id);
    publish("order.status_changed", { orderId: order.id, number: order.number, userId: order.user_id, status: to, title: STATUS_TITLES[to] });
    audit(req, "order.transition", "order", order.number, { to, storeId: target, note });
    return one("SELECT * FROM orders WHERE id=?", order.id);
  });
}

/** Cancel pending-payment orders that were never paid so reserved stock is returned. */
export function expireStaleOrders(minutes = 30) {
  const stale = all("SELECT * FROM orders WHERE status='pending_payment' AND payment_status IN ('initiated','pending','failed') AND created_at <= datetime('now', ?)", `-${minutes} minutes`);
  for (const order of stale) {
    tx(() => {
      for (const so of all("SELECT * FROM seller_orders WHERE order_id=?", order.id)) {
        releaseOrRestock(so.id, false);
        run("UPDATE seller_orders SET status='cancelled' WHERE id=?", so.id);
        addEvent(order.id, so.id, "cancelled", null, "Cancelled — payment not completed in time");
      }
      run("UPDATE orders SET status='cancelled', updated_at=datetime('now') WHERE id=?", order.id);
      run("UPDATE payments SET status='failed' WHERE order_id=? AND status IN ('initiated','pending')", order.id);
    });
  }
  return stale.length;
}
