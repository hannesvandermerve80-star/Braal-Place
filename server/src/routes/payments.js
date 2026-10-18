import { Router } from "express";
import { z } from "zod";
import { one } from "../db/index.js";
import { validate } from "../middleware/validate.js";
import { badRequest, forbidden, wrap } from "../lib/httpError.js";
import { demoCharge, handleProviderEvent, verifySignature } from "../services/payments.js";
import { getOrderForViewer, serializeOrder } from "../services/orders.js";

const router = Router();

/**
 * Provider webhook. The body is verified against an HMAC signature over the raw bytes.
 * Idempotent on the provider event id so retries/duplicates never double-process.
 */
router.post("/webhooks/:provider", wrap((req, res) => {
  const signature = req.get("x-signature");
  if (!verifySignature(req.rawBody, signature)) throw forbidden("Invalid webhook signature");
  const event = z.object({ id: z.string().min(1), type: z.string().min(1), paymentRef: z.string().min(1), amountCents: z.number().int().optional() }).safeParse(req.body);
  if (!event.success) throw badRequest("Malformed event");
  const result = handleProviderEvent(req.params.provider, event.data, req);
  res.status(200).json({ received: true, ...result });
}));

/**
 * Demo checkout: stands in for the provider's hosted payment page. It does not mark anything paid by itself —
 * it emits a signed provider event that goes through the same verified path as a real webhook.
 */
router.post("/demo/pay", validate(z.object({
  orderNumber: z.string().min(3).max(30),
  email: z.string().email().optional(),
  outcome: z.enum(["success", "decline"]).default("success"),
})), wrap((req, res) => {
  const { order } = getOrderForViewer(req.body.orderNumber, req.user, { email: req.body.email });
  const result = demoCharge(order, req.body.outcome, req);
  const fresh = one("SELECT * FROM orders WHERE id=?", order.id);
  res.json({ result, order: serializeOrder(fresh, { withInternal: true }) });
}));

export default router;
