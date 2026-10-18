import { Router } from "express";
import { z } from "zod";
import { all, one, run, tx } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { notFound, wrap } from "../lib/httpError.js";
import { addressSchema } from "../lib/validators.js";
import { PRODUCT_SELECT, serializeProduct } from "../services/catalog.js";

const router = Router();
router.use(requireAuth);

const addr = (a) => ({ id: a.id, label: a.label, street: a.street, suburb: a.suburb, city: a.city, postalCode: a.postal_code, isDefault: !!a.is_default });

/* addresses */
router.get("/addresses", (req, res) => res.json({ items: all("SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, id", req.user.id).map(addr) }));
router.post("/addresses", validate(addressSchema.extend({ label: z.string().trim().max(30).default("Home"), isDefault: z.boolean().optional() })), wrap((req, res) => {
  const b = req.body;
  const first = one("SELECT COUNT(*) c FROM addresses WHERE user_id=?", req.user.id).c === 0;
  const id = tx(() => {
    const makeDefault = b.isDefault || first;
    if (makeDefault) run("UPDATE addresses SET is_default=0 WHERE user_id=?", req.user.id);
    return Number(run("INSERT INTO addresses (user_id, label, street, suburb, city, postal_code, is_default) VALUES (?,?,?,?,?,?,?)", req.user.id, b.label, b.street, b.suburb, b.city, b.postalCode, makeDefault ? 1 : 0).lastInsertRowid);
  });
  res.status(201).json({ address: addr(one("SELECT * FROM addresses WHERE id=?", id)) });
}));
router.post("/addresses/:id/default", wrap((req, res) => {
  const a = one("SELECT * FROM addresses WHERE id=? AND user_id=?", Number(req.params.id), req.user.id);
  if (!a) throw notFound("Address not found");
  tx(() => { run("UPDATE addresses SET is_default=0 WHERE user_id=?", req.user.id); run("UPDATE addresses SET is_default=1 WHERE id=?", a.id); });
  res.json({ ok: true });
}));
router.delete("/addresses/:id", wrap((req, res) => {
  const r = run("DELETE FROM addresses WHERE id=? AND user_id=?", Number(req.params.id), req.user.id);
  if (!r.changes) throw notFound("Address not found");
  res.json({ ok: true });
}));

/* wishlist */
router.get("/wishlist", (req, res) => {
  const rows = all(`${PRODUCT_SELECT} JOIN wishlist w ON w.product_id=p.id WHERE w.user_id=? AND p.status='published' ORDER BY w.created_at DESC`, req.user.id);
  res.json({ items: rows.map((r) => serializeProduct(r)), ids: all("SELECT product_id FROM wishlist WHERE user_id=?", req.user.id).map((r) => r.product_id) });
});
router.put("/wishlist/:productId", wrap((req, res) => {
  const id = Number(req.params.productId);
  if (!one("SELECT 1 FROM products WHERE id=? AND status='published'", id)) throw notFound("Product not found");
  run("INSERT OR IGNORE INTO wishlist (user_id, product_id) VALUES (?,?)", req.user.id, id);
  res.json({ ok: true });
}));
router.delete("/wishlist/:productId", (req, res) => {
  run("DELETE FROM wishlist WHERE user_id=? AND product_id=?", req.user.id, Number(req.params.productId));
  res.json({ ok: true });
});

/* notifications */
router.get("/notifications", (req, res) => {
  const items = all("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30", req.user.id).map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: !!n.read, createdAt: n.created_at }));
  res.json({ items, unread: one("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0", req.user.id).c });
});
router.post("/notifications/read", (req, res) => { run("UPDATE notifications SET read=1 WHERE user_id=?", req.user.id); res.json({ ok: true }); });

/* support tickets (own) */
router.get("/tickets", (req, res) => {
  res.json({ items: all("SELECT * FROM support_tickets WHERE user_id=? ORDER BY id DESC", req.user.id).map((t) => ({ id: t.id, subject: t.subject, message: t.message, status: t.status, reply: t.reply, orderNumber: t.order_number, createdAt: t.created_at })) });
});

export default router;
