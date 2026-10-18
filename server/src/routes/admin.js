import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { all, one, run, tx } from "../db/index.js";
import { assertRecentAuth, publicUser, requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { badRequest, conflict, forbidden, notFound, wrap } from "../lib/httpError.js";
import { ALL_PERMISSIONS, DEFAULT_MANAGER_PERMISSIONS } from "../lib/permissions.js";
import { toRand } from "../lib/money.js";
import { decideRefund } from "../services/payments.js";
import { listPayouts, runPayouts } from "../services/ledger.js";
import { audit } from "../services/audit.js";
import { email, mobile, password, str } from "../lib/validators.js";

const router = Router();
router.use(requireAuth);

/* ----------------------------------------------------------- users & roles */
const U = requirePermission("users.manage");
router.get("/users", U, (_req, res) => {
  const items = all("SELECT * FROM users ORDER BY id").map((u) => ({ ...publicUser(u), emailVerified: !!u.email_verified }));
  res.json({ items, allPermissions: ALL_PERMISSIONS });
});

router.post("/users", U, validate(z.object({ firstName: str(1, 60), lastName: str(1, 60), email, mobile, password, role: z.enum(["manager"]).default("manager"), permissions: z.array(z.enum(ALL_PERMISSIONS)).default(DEFAULT_MANAGER_PERMISSIONS), confirmPassword: z.string() })), wrap((req, res) => {
  assertRecentAuth(req, req.body.confirmPassword);
  if (one("SELECT 1 FROM users WHERE email=?", req.body.email)) throw conflict("An account with that email already exists");
  const b = req.body;
  const r = run("INSERT INTO users (email, password_hash, first_name, last_name, mobile, role, permissions, email_verified) VALUES (?,?,?,?,?,?,?,1)", b.email, bcrypt.hashSync(b.password, 10), b.firstName, b.lastName, b.mobile, "manager", JSON.stringify(b.permissions));
  audit(req, "user.created", "user", Number(r.lastInsertRowid), { role: "manager", permissions: b.permissions });
  res.status(201).json({ user: publicUser(one("SELECT * FROM users WHERE id=?", Number(r.lastInsertRowid))) });
}));

router.patch("/users/:id", U, validate(z.object({
  role: z.enum(["admin", "manager", "seller", "buyer"]).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS)).optional(),
  confirmPassword: z.string(),
})), wrap((req, res) => {
  assertRecentAuth(req, req.body.confirmPassword); // sensitive: recent authentication + confirmation
  const target = one("SELECT * FROM users WHERE id=?", Number(req.params.id));
  if (!target) throw notFound("User not found");
  if (target.id === req.user.id && (req.body.role || req.body.status === "suspended")) throw forbidden("You cannot change your own role or suspend yourself");
  const b = req.body;
  tx(() => {
    run("UPDATE users SET role=COALESCE(?,role), status=COALESCE(?,status), permissions=COALESCE(?,permissions) WHERE id=?", b.role ?? null, b.status ?? null, b.permissions ? JSON.stringify(b.permissions) : null, target.id);
    audit(req, "user.updated", "user", target.id, { before: { role: target.role, status: target.status, permissions: JSON.parse(target.permissions) }, after: { role: b.role, status: b.status, permissions: b.permissions } });
  });
  res.json({ user: publicUser(one("SELECT * FROM users WHERE id=?", target.id)) });
}));

/* -------------------------------------------------------------- audit log */
router.get("/audit-logs", requirePermission("audit.view"), validate(z.object({ q: z.string().trim().max(60).optional(), page: z.coerce.number().int().min(1).default(1) }), "query"), (req, res) => {
  const where = req.query.q ? "WHERE action LIKE ? OR actor_label LIKE ? OR target_id LIKE ?" : "";
  const params = req.query.q ? Array(3).fill(`%${req.query.q}%`) : [];
  const items = all(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT 50 OFFSET ?`, ...params, (req.query.page - 1) * 50)
    .map((a) => ({ id: a.id, actor: a.actor_label, action: a.action, targetType: a.target_type, targetId: a.target_id, meta: JSON.parse(a.meta || "{}"), requestId: a.request_id, at: a.created_at }));
  res.json({ items, total: one(`SELECT COUNT(*) c FROM audit_logs ${where}`, ...params).c });
});

/* --------------------------------------------------------------- payments */
router.get("/payments", requirePermission("payments.view"), (_req, res) => {
  const payments = all(`SELECT p.*, o.number FROM payments p JOIN orders o ON o.id=p.order_id ORDER BY p.id DESC LIMIT 100`)
    .map((p) => ({ id: p.id, order: p.number, provider: p.provider, reference: p.provider_ref, amount: toRand(p.amount_cents), refunded: toRand(p.refunded_cents), status: p.status, createdAt: p.created_at }));
  const refunds = all(`SELECT r.*, o.number FROM refunds r JOIN orders o ON o.id=r.order_id ORDER BY r.id DESC LIMIT 100`)
    .map((r) => ({ id: r.id, order: r.number, amount: toRand(r.amount_cents), reason: r.reason, status: r.status, createdAt: r.created_at }));
  const totals = {
    captured: toRand(one("SELECT COALESCE(SUM(amount_cents),0) s FROM payments WHERE status IN ('confirmed','partially_refunded','refunded')").s),
    refunded: toRand(one("SELECT COALESCE(SUM(refunded_cents),0) s FROM payments").s),
    commission: toRand(-one("SELECT COALESCE(SUM(amount_cents),0) s FROM ledger_entries WHERE kind IN ('commission','refund_commission')").s),
    failed: one("SELECT COUNT(*) c FROM payments WHERE status='failed'").c,
  };
  res.json({ payments, refunds, totals, payouts: listPayouts(null) });
});

router.post("/refunds/:id/decision", requirePermission("refund.approve"), validate(z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional(), confirmPassword: z.string() })), wrap((req, res) => {
  assertRecentAuth(req, req.body.confirmPassword);
  const refund = decideRefund({ req, refundId: Number(req.params.id), approve: req.body.approve, note: req.body.note });
  res.json({ refund: { id: refund.id, status: refund.status } });
}));

router.post("/payouts/run", requirePermission("payments.view"), validate(z.object({ confirmPassword: z.string() })), wrap((req, res) => {
  assertRecentAuth(req, req.body.confirmPassword);
  res.json({ created: runPayouts(req) });
}));

/* ----------------------------------------------------------------- support */
router.get("/support", requirePermission("support.manage"), (_req, res) => {
  res.json({ items: all("SELECT * FROM support_tickets ORDER BY (status='open') DESC, id DESC LIMIT 100").map((t) => ({ id: t.id, name: t.name, email: t.email, subject: t.subject, message: t.message, orderNumber: t.order_number, status: t.status, reply: t.reply, createdAt: t.created_at })) });
});
router.post("/support/:id/reply", requirePermission("support.manage"), validate(z.object({ reply: str(2, 2000), close: z.boolean().optional() })), wrap((req, res) => {
  const t = one("SELECT * FROM support_tickets WHERE id=?", Number(req.params.id));
  if (!t) throw notFound("Ticket not found");
  run("UPDATE support_tickets SET reply=?, status=? WHERE id=?", req.body.reply, req.body.close ? "closed" : "replied", t.id);
  if (t.user_id) run("INSERT OR IGNORE INTO notifications (user_id, type, title, body, link, source_event_id) VALUES (?,?,?,?,?,?)", t.user_id, "support.reply", "Support replied", req.body.reply.slice(0, 120), "/portal/support", t.id);
  audit(req, "support.replied", "ticket", t.id);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ stores */
router.get("/stores", requirePermission("seller.review"), (_req, res) => {
  res.json({ items: all(`SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.store_id=s.id AND p.status='published') AS products FROM stores s ORDER BY s.id`).map((s) => ({ id: s.id, slug: s.slug, name: s.name, city: s.city, status: s.status, verified: !!s.verified, products: s.products })) });
});

export default router;
