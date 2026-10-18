import { Router } from "express";
import { z } from "zod";
import { all, one, run } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { badRequest, conflict, forbidden, notFound, wrap } from "../lib/httpError.js";
import { slugify } from "../lib/slug.js";
import { toCents, toRand } from "../lib/money.js";
import { assertTransition, PRODUCT_TRANSITIONS } from "../lib/stateMachines.js";
import { PRODUCT_SELECT, serializeProduct } from "../services/catalog.js";
import { storeBalance, listPayouts } from "../services/ledger.js";
import { publish } from "../services/outbox.js";
import { audit } from "../services/audit.js";
import { tx } from "../db/index.js";
import { email } from "../lib/validators.js";

const router = Router();
router.use(requireAuth, requireRole("seller"));

/** Tenant scope: every query below is bound to the caller's store membership. */
router.use((req, _res, next) => {
  const store = one("SELECT s.* FROM stores s JOIN store_members m ON m.store_id=s.id WHERE m.user_id=? LIMIT 1", req.user.id);
  if (!store) return next(forbidden("Your seller application has not been approved yet. Product publishing and payouts unlock once approved."));
  if (store.status !== "active") return next(forbidden("Your store is suspended. Contact support."));
  req.store = store;
  next();
});

const serializeStore = (s) => ({ id: s.id, slug: s.slug, name: s.name, description: s.description, city: s.city, supportEmail: s.support_email, verified: !!s.verified, rating: s.rating, status: s.status });

router.get("/store", (req, res) => res.json({ store: serializeStore(req.store) }));
router.patch("/store", validate(z.object({ name: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(500).optional(), city: z.string().trim().max(60).optional(), supportEmail: email.optional() })), wrap((req, res) => {
  const b = req.body;
  run("UPDATE stores SET name=COALESCE(?,name), description=COALESCE(?,description), city=COALESCE(?,city), support_email=COALESCE(?,support_email) WHERE id=?", b.name ?? null, b.description ?? null, b.city ?? null, b.supportEmail ?? null, req.store.id);
  audit(req, "store.updated", "store", req.store.id, b);
  res.json({ store: serializeStore(one("SELECT * FROM stores WHERE id=?", req.store.id)) });
}));

/* ------------------------------------------------------------- products */
const productBase = z.object({
  name: z.string().trim().min(3, "Name is too short").max(120),
  description: z.string().trim().max(1000).default(""),
  categoryId: z.number().int().positive(),
  unit: z.string().trim().max(20).default("each"),
  price: z.number().positive("Price must be greater than 0").max(100000),
  oldPrice: z.number().positive().max(100000).nullable().optional(),
  image: z.string().url().max(500).nullable().optional(),
  stock: z.number().int().min(0).max(100000).default(0),
  lowStockThreshold: z.number().int().min(0).max(10000).default(10),
});

const own = (req, id) => {
  const p = one(`${PRODUCT_SELECT} WHERE p.id=? AND p.store_id=?`, id, req.store.id);
  if (!p) throw notFound("Product not found");
  return p;
};

router.get("/products", wrap((req, res) => {
  const rows = all(`${PRODUCT_SELECT} WHERE p.store_id=? ORDER BY p.id DESC`, req.store.id);
  res.json({ items: rows.map((r) => serializeProduct(r, { includeInternal: true })) });
}));

router.post("/products", validate(productBase), wrap((req, res) => {
  const b = req.body;
  if (!one("SELECT 1 FROM categories WHERE id=?", b.categoryId)) throw badRequest("Unknown category", { fields: { categoryId: "Choose a category" } });
  if (b.oldPrice && b.oldPrice <= b.price) throw badRequest("Was-price must be higher than the price", { fields: { oldPrice: "Must be higher than the price" } });
  const id = tx(() => {
    let slug = slugify(`${b.name}`), n = 2; const base = slug;
    while (one("SELECT 1 FROM products WHERE slug=?", slug)) slug = `${base}-${n++}`;
    const sku = `${req.store.slug.slice(0, 3).toUpperCase()}-${String(Date.now()).slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
    const r = run(`INSERT INTO products (store_id, category_id, slug, sku, name, description, unit, price_cents, old_price_cents, image, status) VALUES (?,?,?,?,?,?,?,?,?,?, 'draft')`,
      req.store.id, b.categoryId, slug, sku, b.name, b.description, b.unit, toCents(b.price), b.oldPrice ? toCents(b.oldPrice) : null, b.image ?? null);
    const pid = Number(r.lastInsertRowid);
    run("INSERT INTO inventory (product_id, stock, low_stock_threshold) VALUES (?,?,?)", pid, b.stock, b.lowStockThreshold);
    audit(req, "product.created", "product", pid, { name: b.name });
    return pid;
  });
  res.status(201).json({ product: serializeProduct(one(`${PRODUCT_SELECT} WHERE p.id=?`, id), { includeInternal: true }) });
}));

router.patch("/products/:id", validate(productBase.partial()), wrap((req, res) => {
  const p = own(req, Number(req.params.id));
  const b = req.body;
  const price = b.price ?? p.price_cents / 100;
  const old = b.oldPrice === undefined ? (p.old_price_cents ? p.old_price_cents / 100 : null) : b.oldPrice;
  if (old && old <= price) throw badRequest("Was-price must be higher than the price", { fields: { oldPrice: "Must be higher than the price" } });
  tx(() => {
    // Content edits to a live product send it back through moderation; price/stock edits do not.
    const contentChanged = ["name", "description", "categoryId", "image"].some((k) => b[k] !== undefined && String(b[k]) !== String({ name: p.name, description: p.description, categoryId: p.category_id, image: p.image }[k]));
    run(`UPDATE products SET name=COALESCE(?,name), description=COALESCE(?,description), category_id=COALESCE(?,category_id), unit=COALESCE(?,unit),
         price_cents=?, old_price_cents=?, image=COALESCE(?,image), updated_at=datetime('now') WHERE id=?`,
      b.name ?? null, b.description ?? null, b.categoryId ?? null, b.unit ?? null, toCents(price), old ? toCents(old) : null, b.image ?? null, p.id);
    if (b.stock !== undefined) run("UPDATE inventory SET stock=? WHERE product_id=?", Math.max(b.stock, p.reserved), p.id);
    if (b.lowStockThreshold !== undefined) run("UPDATE inventory SET low_stock_threshold=? WHERE product_id=?", b.lowStockThreshold, p.id);
    if (contentChanged && p.status === "published") run("UPDATE products SET status='submitted' WHERE id=?", p.id);
    audit(req, "product.updated", "product", p.id, b);
  });
  res.json({ product: serializeProduct(one(`${PRODUCT_SELECT} WHERE p.id=?`, p.id), { includeInternal: true }) });
}));

router.patch("/products/:id/inventory", validate(z.object({ stock: z.number().int().min(0).max(100000), lowStockThreshold: z.number().int().min(0).max(10000).optional() })), wrap((req, res) => {
  const p = own(req, Number(req.params.id));
  if (req.body.stock < p.reserved) throw conflict(`${p.reserved} units are reserved for open orders; stock cannot go below that`);
  run("UPDATE inventory SET stock=?, low_stock_threshold=COALESCE(?, low_stock_threshold) WHERE product_id=?", req.body.stock, req.body.lowStockThreshold ?? null, p.id);
  audit(req, "inventory.updated", "product", p.id, req.body);
  res.json({ product: serializeProduct(one(`${PRODUCT_SELECT} WHERE p.id=?`, p.id), { includeInternal: true }) });
}));

router.post("/products/:id/submit", wrap((req, res) => {
  const p = own(req, Number(req.params.id));
  assertTransition(PRODUCT_TRANSITIONS, p.status, "submitted", "product status");
  if (!p.image) throw badRequest("Add a product image before submitting", { fields: { image: "Image required" } });
  tx(() => {
    run("UPDATE products SET status='submitted', moderation_note=NULL, updated_at=datetime('now') WHERE id=?", p.id);
    publish("product.submitted", { productId: p.id, name: p.name, storeId: p.store_id });
    audit(req, "product.submitted", "product", p.id);
  });
  res.json({ product: serializeProduct(one(`${PRODUCT_SELECT} WHERE p.id=?`, p.id), { includeInternal: true }) });
}));

router.delete("/products/:id", wrap((req, res) => {
  const p = own(req, Number(req.params.id));
  assertTransition(PRODUCT_TRANSITIONS, p.status, "archived", "product status");
  run("UPDATE products SET status='archived', updated_at=datetime('now') WHERE id=?", p.id);
  audit(req, "product.archived", "product", p.id);
  res.json({ ok: true });
}));

/* -------------------------------------------------------------- payouts */
router.get("/payouts", wrap((req, res) => {
  const recent = all(`SELECT le.kind, le.amount_cents, le.created_at, o.number FROM ledger_entries le JOIN orders o ON o.id=le.order_id WHERE le.store_id=? ORDER BY le.id DESC LIMIT 20`, req.store.id)
    .map((e) => ({ kind: e.kind, amount: toRand(e.amount_cents), at: e.created_at, order: e.number }));
  res.json({ balance: storeBalance(req.store.id), payouts: listPayouts(req.store.id), ledger: recent });
}));

export default router;
