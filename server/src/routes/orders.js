import { Router } from "express";
import { z } from "zod";
import { all, one } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { forbidden, wrap, badRequest } from "../lib/httpError.js";
import { hasPermission } from "../lib/permissions.js";
import { ORDER_STATUSES } from "../lib/stateMachines.js";
import { getOrderForViewer, serializeOrder, transitionOrder } from "../services/orders.js";
import { requestRefund } from "../services/payments.js";
import { toCents } from "../lib/money.js";

const router = Router();

const listQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Role-scoped list: buyers see only their own orders, sellers only orders containing their products, staff see all. */
router.get("/", requireAuth, validate(listQuery, "query"), wrap((req, res) => {
  const { status, q, page, limit } = req.query;
  const u = req.user;
  const where = [];
  const params = [];
  let storeId = null;
  if (u.role === "admin" || hasPermission(u, "orders.manage")) { /* all */ }
  else if (u.role === "seller") {
    const m = one("SELECT store_id FROM store_members WHERE user_id=?", u.id);
    if (!m) return res.json({ items: [], total: 0, page, pages: 1 });
    storeId = m.store_id;
    where.push("o.id IN (SELECT order_id FROM seller_orders WHERE store_id=?)"); params.push(storeId);
  } else { where.push("o.user_id = ?"); params.push(u.id); }
  if (status) { where.push(storeId ? "(SELECT status FROM seller_orders WHERE order_id=o.id AND store_id=?) = ?" : "o.status = ?"); if (storeId) params.push(storeId); params.push(status); }
  if (q) { where.push("(o.number LIKE ? OR o.contact LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = one(`SELECT COUNT(*) c FROM orders o ${w}`, ...params).c;
  const rows = all(`SELECT o.* FROM orders o ${w} ORDER BY o.id DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  res.json({ items: rows.map((o) => serializeOrder(o, { storeId, withInternal: u.role !== "seller" })), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

/** Guests may look up an order with number + the email used at checkout. */
router.get("/:number", wrap((req, res) => {
  const { order, scope, storeId } = getOrderForViewer(req.params.number, req.user, { email: req.query.email });
  res.json({ order: serializeOrder(order, { storeId: scope === "seller" ? storeId : null, withInternal: scope !== "seller" }), scope });
}));

const transitionSchema = z.object({ to: z.enum(ORDER_STATUSES), storeId: z.number().int().positive().optional(), note: z.string().trim().max(200).optional() });
router.post("/:number/transitions", requireAuth, validate(transitionSchema), wrap((req, res) => {
  const { order, scope, storeId } = getOrderForViewer(req.params.number, req.user);
  const updated = transitionOrder({ req, order, scope, viewerStoreId: storeId, to: req.body.to, storeId: req.body.storeId ?? null, note: req.body.note ?? null });
  res.json({ order: serializeOrder(updated, { storeId: scope === "seller" ? storeId : null, withInternal: scope !== "seller" }) });
}));

router.post("/:number/refunds", requireAuth, validate(z.object({ amount: z.number().positive().optional(), reason: z.string().trim().min(3).max(300) })), wrap((req, res) => {
  const { order, scope } = getOrderForViewer(req.params.number, req.user);
  if (scope === "seller" || scope === "guest") throw forbidden();
  if (order.status !== "delivered" && scope === "buyer") throw badRequest("Refunds can be requested once an order has been delivered");
  const refund = requestRefund({ req, order, amountCents: req.body.amount ? toCents(req.body.amount) : null, reason: req.body.reason });
  res.status(201).json({ refund: { id: refund.id, status: refund.status, amount: refund.amount_cents / 100 } });
}));

export default router;
