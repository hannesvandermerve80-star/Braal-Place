import { all, one } from "../db/index.js";
import { toRand } from "../lib/money.js";

export const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug,
         s.name AS store_name, s.slug AS store_slug, s.verified AS store_verified, s.rating AS store_rating, s.status AS store_status,
         COALESCE(i.stock,0) AS stock, COALESCE(i.reserved,0) AS reserved, COALESCE(i.low_stock_threshold,10) AS low_threshold
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN stores s ON s.id = p.store_id
  LEFT JOIN inventory i ON i.product_id = p.id`;

export function serializeProduct(p, { includeInternal = false } = {}) {
  const available = Math.max(0, p.stock - p.reserved);
  const out = {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    category: p.category_name,
    categorySlug: p.category_slug,
    unit: p.unit,
    price: toRand(p.price_cents),
    oldPrice: p.old_price_cents ? toRand(p.old_price_cents) : null,
    savings: p.old_price_cents ? toRand(p.old_price_cents - p.price_cents) : 0,
    image: p.image,
    rating: p.rating,
    reviews: p.review_count,
    featured: !!p.featured,
    seller: { id: p.store_id, slug: p.store_slug, name: p.store_name, verified: !!p.store_verified, rating: p.store_rating },
    stock: available,
    inStock: available > 0,
    lowStock: available > 0 && available <= p.low_threshold,
  };
  if (includeInternal) {
    Object.assign(out, { sku: p.sku, status: p.status, moderationNote: p.moderation_note, onHand: p.stock, reserved: p.reserved, lowStockThreshold: p.low_threshold, storeId: p.store_id, updatedAt: p.updated_at });
  }
  return out;
}

export const getCategories = () =>
  all(`SELECT c.id, c.slug, c.name,
        (SELECT COUNT(*) FROM products p JOIN stores s ON s.id=p.store_id WHERE p.category_id=c.id AND p.status='published' AND s.status='active') AS count
       FROM categories c ORDER BY c.sort_order, c.name`).map((c) => ({ ...c }));

export function listProducts(q) {
  const where = ["p.status = 'published'", "s.status = 'active'"];
  const params = [];
  if (q.category && q.category !== "all") { where.push("(c.slug = ? OR c.name = ?)"); params.push(q.category, q.category); }
  if (q.q) { where.push("(p.name LIKE ? OR s.name LIKE ? OR p.description LIKE ?)"); params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  if (q.seller) { where.push("s.slug = ?"); params.push(q.seller); }
  if (q.maxPrice) { where.push("p.price_cents <= ?"); params.push(Math.round(q.maxPrice * 100)); }
  if (q.inStock) where.push("(COALESCE(i.stock,0) - COALESCE(i.reserved,0)) > 0");
  if (q.specials) where.push("p.old_price_cents IS NOT NULL AND p.old_price_cents > p.price_cents");
  if (q.featured) where.push("p.featured = 1");
  const order = {
    price_asc: "p.price_cents ASC",
    price_desc: "p.price_cents DESC",
    rating: "p.rating DESC, p.review_count DESC",
    newest: "p.created_at DESC, p.id DESC",
    featured: "p.featured DESC, p.review_count DESC",
  }[q.sort || "featured"];
  const base = `${PRODUCT_SELECT} WHERE ${where.join(" AND ")}`;
  const total = one(`SELECT COUNT(*) c FROM products p JOIN categories c ON c.id=p.category_id JOIN stores s ON s.id=p.store_id LEFT JOIN inventory i ON i.product_id=p.id WHERE ${where.join(" AND ")}`, ...params).c;
  const rows = all(`${base} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, q.limit, (q.page - 1) * q.limit);
  return { items: rows.map((r) => serializeProduct(r)), total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)) };
}

export const getPublishedProduct = (idOrSlug) =>
  one(`${PRODUCT_SELECT} WHERE (p.slug = ? OR p.id = ?) AND p.status='published' AND s.status='active'`, String(idOrSlug), Number(idOrSlug) || -1);
