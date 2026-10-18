import { Router } from "express";
import { z } from "zod";
import { all, one, run, tx } from "../db/index.js";
import { validate } from "../middleware/validate.js";
import { badRequest, wrap } from "../lib/httpError.js";
import { addressSchema, contactSchema } from "../lib/validators.js";
import { cartView, resolveCart } from "../services/cart.js";
import { createOrder, serializeOrder } from "../services/orders.js";
import { audit } from "../services/audit.js";

const router = Router();

/** Server-side quote: recalculates price, delivery, discount, VAT and checks stock. */
router.post("/quote", wrap((req, res) => {
  const cart = resolveCart(req, res, { create: false });
  res.json(cartView(cart));
}));

const orderSchema = z.object({
  contact: contactSchema,
  address: addressSchema,
  saveAddress: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

router.post("/orders", validate(orderSchema), wrap((req, res) => {
  const cart = resolveCart(req, res, { create: false });
  if (!cart) throw badRequest("Your cart is empty");
  const items = all("SELECT product_id AS productId, qty FROM cart_items WHERE cart_id=?", cart.id).map((r) => ({ ...r }));
  const { order, replayed } = tx(() => {
    const result = createOrder({
      user: req.user ?? null,
      contact: req.body.contact,
      address: req.body.address,
      items,
      promoCode: cart.promo_code,
      idempotencyKey: req.body.idempotencyKey ?? null,
    });
    if (!result.replayed) {
      run("DELETE FROM cart_items WHERE cart_id=?", cart.id);
      run("UPDATE carts SET promo_code=NULL WHERE id=?", cart.id);
      if (req.user && req.body.saveAddress) {
        const a = req.body.address;
        const has = one("SELECT 1 FROM addresses WHERE user_id=? AND street=? AND postal_code=?", req.user.id, a.street, a.postalCode);
        if (!has) run("INSERT INTO addresses (user_id, label, street, suburb, city, postal_code, is_default) VALUES (?,?,?,?,?,?,?)", req.user.id, "Home", a.street, a.suburb, a.city, a.postalCode, one("SELECT COUNT(*) c FROM addresses WHERE user_id=?", req.user.id).c === 0 ? 1 : 0);
      }
      audit(req, "order.placed", "order", result.order.number, { total: result.order.total_cents });
    }
    return result;
  });
  res.status(replayed ? 200 : 201).json({ order: serializeOrder(order, { withInternal: true }), replayed });
}));

export default router;
