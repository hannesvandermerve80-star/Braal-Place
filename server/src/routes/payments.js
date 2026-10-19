import { Router } from "express";
import { z } from "zod";
import { one } from "../db/index.js";
import { validate } from "../middleware/validate.js";
import { badRequest, forbidden, wrap } from "../lib/httpError.js";
import express from "express";
import { config } from "../config.js";
import { demoCharge, ensurePaymentAttempt, handleProviderEvent, verifySignature } from "../services/payments.js";
import { buildCheckout, parseItn, postbackValid, verifyItnSignature } from "../services/payfast.js";
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
router.post("/demo/pay", (req, _res, next) => (config.paymentProvider === "demo" ? next() : next(forbidden("Demo payments are disabled"))), validate(z.object({
  orderNumber: z.string().min(3).max(30),
  email: z.string().email().optional(),
  outcome: z.enum(["success", "decline"]).default("success"),
})), wrap((req, res) => {
  const { order } = getOrderForViewer(req.body.orderNumber, req.user, { email: req.body.email });
  const result = demoCharge(order, req.body.outcome, req);
  const fresh = one("SELECT * FROM orders WHERE id=?", order.id);
  res.json({ result, order: serializeOrder(fresh, { withInternal: true }) });
}));

/** PayFast: build the signed hosted-payment redirect for an order. */
router.post("/payfast/init", validate(z.object({ orderNumber: z.string().min(3).max(30), email: z.string().email().optional() })), wrap((req, res) => {
  if (config.paymentProvider !== "payfast") throw badRequest("PayFast is not enabled");
  const { order } = getOrderForViewer(req.body.orderNumber, req.user, { email: req.body.email });
  const payment = ensurePaymentAttempt(order, "payfast");
  res.json(buildCheckout({ order, payment, contact: JSON.parse(order.contact) }));
}));

/**
 * PayFast ITN (Instant Transaction Notification): signature + merchant + amount + PayFast postback are all checked
 * before anything is marked paid. Duplicates are no-ops (idempotent on pf_payment_id).
 */
router.post("/payfast/itn", express.text({ type: () => true, limit: "20kb" }), wrap(async (req, res) => {
  if (config.paymentProvider !== "payfast") throw badRequest("PayFast is not enabled");
  const pairs = parseItn(req.body);
  const f = Object.fromEntries(pairs);
  if (!verifyItnSignature(pairs)) throw forbidden("Invalid signature");
  if (f.merchant_id !== config.payfast.merchantId) throw forbidden("Merchant mismatch");
  if (!config.isTest && !(await postbackValid(pairs))) throw forbidden("PayFast did not validate this notification");
  const payment = one("SELECT * FROM payments WHERE provider='payfast' AND provider_ref=?", f.m_payment_id);
  if (!payment) throw badRequest("Unknown payment");
  const status = f.payment_status;
  if (status === "COMPLETE") {
    const gross = Math.round(parseFloat(f.amount_gross) * 100);
    handleProviderEvent("payfast", { id: `pf_${f.pf_payment_id}`, type: "payment.succeeded", paymentRef: f.m_payment_id, amountCents: gross }, req);
  } else if (status === "FAILED" || status === "CANCELLED") {
    handleProviderEvent("payfast", { id: `pf_${f.pf_payment_id || f.m_payment_id}_${status}`, type: "payment.failed", paymentRef: f.m_payment_id }, req);
  }
  res.status(200).send("OK");
}));

export default router;
