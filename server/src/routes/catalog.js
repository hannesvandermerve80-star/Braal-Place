import { Router } from "express";
import { z } from "zod";
import { all, one } from "../db/index.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { notFound, wrap, conflict } from "../lib/httpError.js";
import { getCategories, getPublishedProduct, listProducts, PRODUCT_SELECT, serializeProduct } from "../services/catalog.js";
import { run } from "../db/index.js";

const router = Router();

router.get("/categories", (_req, res) => res.json({ categories: getCategories() }));

const listQuery = z.object({
  category: z.string().max(60).optional(),
  q: z.string().trim().max(80).optional(),
  seller: z.string().max(80).optional(),
  sort: z.enum(["featured", "price_asc", "price_desc", "rating", "newest"]).optional(),
  maxPrice: z.coerce.number().positive().max(100000).optional(),
  inStock: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  specials: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  featured: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

router.get("/products", validate(listQuery, "query"), (req, res) => res.json(listProducts(req.query)));

router.get("/products/:slug", wrap((req, res) => {
  const p = getPublishedProduct(req.params.slug);
  if (!p) throw notFound("Product not found");
  const related = all(`${PRODUCT_SELECT} WHERE p.status='published' AND s.status='active' AND p.id != ? ORDER BY (p.category_id = ?) DESC, p.review_count DESC LIMIT 4`, p.id, p.category_id);
  const reviews = all(`SELECT r.id, r.rating, r.body, r.created_at, u.first_name, substr(u.last_name,1,1) AS last_initial FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? ORDER BY r.id DESC LIMIT 10`, p.id)
    .map((r) => ({ id: r.id, rating: r.rating, body: r.body, createdAt: r.created_at, author: `${r.first_name} ${r.last_initial}.` }));
  res.json({ product: serializeProduct(p), related: related.map((r) => serializeProduct(r)), reviews });
}));

router.post("/products/:id/reviews", requireAuth, validate(z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().max(1000).default("") })), wrap((req, res) => {
  const id = Number(req.params.id);
  // Only verified purchasers (paid, non-cancelled order containing the product) may review
  const bought = one(`SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=? AND o.user_id=? AND o.payment_status IN ('confirmed','partially_refunded') LIMIT 1`, id, req.user.id);
  if (!bought) throw conflict("Only customers who bought this product can review it");
  const prev = one("SELECT rating FROM reviews WHERE product_id=? AND user_id=?", id, req.user.id);
  const prod = one("SELECT rating, review_count FROM products WHERE id=?", id);
  run(`INSERT INTO reviews (product_id, user_id, rating, body) VALUES (?,?,?,?)
       ON CONFLICT(product_id, user_id) DO UPDATE SET rating=excluded.rating, body=excluded.body`, id, req.user.id, req.body.rating, req.body.body);
  // Blend into the running average (seed/aggregate rating + new customer reviews)
  const count = prev ? prod.review_count : prod.review_count + 1;
  const sum = prod.rating * prod.review_count - (prev ? prev.rating : 0) + req.body.rating;
  const agg = { a: sum / Math.max(1, count) };
  run("UPDATE products SET rating=?, review_count=? WHERE id=?", Math.round(agg.a * 10) / 10, count, id);
  res.status(201).json({ ok: true, rating: Math.round(agg.a * 10) / 10 });
}));

/** Public store page (mounted at /api/stores) */
export const storesRouter = Router();
storesRouter.get("/:slug", wrap((req, res) => {
  const store = one("SELECT * FROM stores WHERE slug=? AND status='active'", req.params.slug);
  if (!store) throw notFound("Store not found");
  const products = listProducts({ seller: store.slug, page: 1, limit: 48, sort: "featured" }).items;
  res.json({ store: { id: store.id, slug: store.slug, name: store.name, description: store.description, city: store.city, verified: !!store.verified, rating: store.rating }, products });
}));

export default router;
