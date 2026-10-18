import crypto from "node:crypto";
import { all, one, run, tx } from "../db/index.js";
import { config } from "../config.js";
import { badRequest, conflict, notFound } from "../lib/httpError.js";
import { PRODUCT_SELECT, serializeProduct } from "./catalog.js";
import { computeTotals, serializeTotals } from "./pricing.js";
import { toRand } from "../lib/money.js";

export const GUEST_COOKIE = "bekies_cart";

/** Find (or create) the cart for the signed-in user or the anonymous guest cookie. */
export function resolveCart(req, res, { create = true } = {}) {
  if (req.user) {
    let cart = one("SELECT * FROM carts WHERE user_id = ?", req.user.id);
    const guestToken = req.cookies?.[GUEST_COOKIE];
    if (!cart) { run("INSERT INTO carts (user_id) VALUES (?)", req.user.id); cart = one("SELECT * FROM carts WHERE user_id = ?", req.user.id); }
    if (guestToken) {
      const guest = one("SELECT * FROM carts WHERE guest_token = ?", guestToken);
      if (guest) mergeCarts(guest.id, cart.id);
      res.clearCookie(GUEST_COOKIE, { path: "/" });
    }
    return cart;
  }
  const token = req.cookies?.[GUEST_COOKIE];
  let cart = token ? one("SELECT * FROM carts WHERE guest_token = ?", token) : null;
  if (!cart && create) {
    const t = crypto.randomBytes(18).toString("hex");
    run("INSERT INTO carts (guest_token) VALUES (?)", t);
    cart = one("SELECT * FROM carts WHERE guest_token = ?", t);
    res.cookie(GUEST_COOKIE, t, { httpOnly: true, sameSite: "lax", secure: config.isProd, maxAge: 30 * 24 * 3600 * 1000, path: "/" });
  }
  return cart;
}

function mergeCarts(fromId, toId) {
  tx(() => {
    for (const item of all("SELECT * FROM cart_items WHERE cart_id = ?", fromId)) {
      run(`INSERT INTO cart_items (cart_id, product_id, qty) VALUES (?,?,?)
           ON CONFLICT(cart_id, product_id) DO UPDATE SET qty = MIN(qty + excluded.qty, ?)`, toId, item.product_id, item.qty, config.commerce.maxQtyPerLine);
    }
    const promo = one("SELECT promo_code FROM carts WHERE id = ?", fromId)?.promo_code;
    if (promo) run("UPDATE carts SET promo_code = COALESCE(promo_code, ?) WHERE id = ?", promo, toId);
    run("DELETE FROM carts WHERE id = ?", fromId);
  });
}

export function loadCartLines(cartId) {
  return all(`${PRODUCT_SELECT.replace("SELECT p.*,", "SELECT ci.id AS line_id, ci.qty AS qty, p.*,")}
              JOIN cart_items ci ON ci.product_id = p.id WHERE ci.cart_id = ? ORDER BY ci.id`, cartId);
}

/** Cart view with server-calculated prices and availability warnings. */
export function cartView(cart) {
  if (!cart) return { items: [], count: 0, totals: serializeTotals(computeTotals(0, null)), warnings: [] };
  const rows = loadCartLines(cart.id);
  const warnings = [];
  let subtotalCents = 0;
  const items = rows.map((r) => {
    const product = serializeProduct(r);
    const purchasable = r.status === "published" && r.store_status === "active";
    const qty = r.qty;
    if (!purchasable) warnings.push({ productId: r.id, message: `${r.name} is no longer available.` });
    else if (product.stock < qty) warnings.push({ productId: r.id, message: product.stock === 0 ? `${r.name} is out of stock.` : `Only ${product.stock} of ${r.name} left.` });
    if (purchasable) subtotalCents += r.price_cents * qty;
    return { id: r.line_id, productId: r.id, qty, lineTotal: toRand(r.price_cents * qty), purchasable, product };
  });
  const totals = computeTotals(subtotalCents, cart.promo_code);
  return {
    items,
    count: items.reduce((n, i) => n + i.qty, 0),
    totals: serializeTotals(totals),
    warnings,
  };
}

export function addItem(cart, productId, qty) {
  const product = one(`${PRODUCT_SELECT} WHERE p.id = ? AND p.status='published' AND s.status='active'`, productId);
  if (!product) throw notFound("Product not found");
  const existing = one("SELECT qty FROM cart_items WHERE cart_id=? AND product_id=?", cart.id, productId)?.qty ?? 0;
  const next = Math.min(existing + qty, config.commerce.maxQtyPerLine);
  if (product.stock - product.reserved < next) throw conflict(`Only ${Math.max(0, product.stock - product.reserved)} available`);
  run(`INSERT INTO cart_items (cart_id, product_id, qty) VALUES (?,?,?)
       ON CONFLICT(cart_id, product_id) DO UPDATE SET qty = excluded.qty`, cart.id, productId, next);
  run("UPDATE carts SET updated_at = datetime('now') WHERE id = ?", cart.id);
}

export function setQty(cart, itemId, qty) {
  const item = one("SELECT ci.*, COALESCE(i.stock,0)-COALESCE(i.reserved,0) AS avail FROM cart_items ci LEFT JOIN inventory i ON i.product_id=ci.product_id WHERE ci.id=? AND ci.cart_id=?", itemId, cart.id);
  if (!item) throw notFound("Cart item not found");
  if (qty > item.avail) throw conflict(`Only ${Math.max(0, item.avail)} available`);
  run("UPDATE cart_items SET qty=? WHERE id=?", qty, itemId);
}

export function removeItem(cart, itemId) {
  const r = run("DELETE FROM cart_items WHERE id=? AND cart_id=?", itemId, cart.id);
  if (!r.changes) throw notFound("Cart item not found");
}

export function applyPromo(cart, code) {
  const rows = loadCartLines(cart.id);
  const subtotal = rows.reduce((n, r) => n + r.price_cents * r.qty, 0);
  const result = computeTotals(subtotal, code).promo;
  if (!result.valid) throw badRequest(result.message || "Invalid promo code");
  run("UPDATE carts SET promo_code=? WHERE id=?", result.code, cart.id);
}
