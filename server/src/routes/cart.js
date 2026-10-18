import { Router } from "express";
import { z } from "zod";
import { run } from "../db/index.js";
import { validate } from "../middleware/validate.js";
import { wrap } from "../lib/httpError.js";
import { addItem, applyPromo, cartView, removeItem, resolveCart, setQty } from "../services/cart.js";
import { config } from "../config.js";

const router = Router();
const qty = z.number().int().min(1).max(config.commerce.maxQtyPerLine);

router.get("/", wrap((req, res) => res.json(cartView(resolveCart(req, res, { create: false })))));

router.post("/items", validate(z.object({ productId: z.number().int().positive(), qty: qty.default(1) })), wrap((req, res) => {
  const cart = resolveCart(req, res);
  addItem(cart, req.body.productId, req.body.qty);
  res.status(201).json(cartView(cart));
}));

router.patch("/items/:id", validate(z.object({ qty })), wrap((req, res) => {
  const cart = resolveCart(req, res);
  setQty(cart, Number(req.params.id), req.body.qty);
  res.json(cartView(cart));
}));

router.delete("/items/:id", wrap((req, res) => {
  const cart = resolveCart(req, res);
  removeItem(cart, Number(req.params.id));
  res.json(cartView(cart));
}));

router.post("/promo", validate(z.object({ code: z.string().trim().min(1).max(30) })), wrap((req, res) => {
  const cart = resolveCart(req, res);
  applyPromo(cart, req.body.code);
  res.json(cartView({ ...cart, promo_code: req.body.code.toUpperCase() }));
}));

router.delete("/promo", wrap((req, res) => {
  const cart = resolveCart(req, res);
  run("UPDATE carts SET promo_code=NULL WHERE id=?", cart.id);
  res.json(cartView({ ...cart, promo_code: null }));
}));

router.delete("/", wrap((req, res) => {
  const cart = resolveCart(req, res);
  run("DELETE FROM cart_items WHERE cart_id=?", cart.id);
  run("UPDATE carts SET promo_code=NULL WHERE id=?", cart.id);
  res.json(cartView({ ...cart, promo_code: null }));
}));

export default router;
