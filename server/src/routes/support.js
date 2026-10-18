import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { one, run, tx } from "../db/index.js";
import { config } from "../config.js";
import { validate } from "../middleware/validate.js";
import { wrap } from "../lib/httpError.js";
import { email, str } from "../lib/validators.js";
import { publish } from "../services/outbox.js";

const router = Router();
const limiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: config.isTest ? 10000 : 15, standardHeaders: true, legacyHeaders: false, message: { error: { status: 429, message: "Too many requests. Please try again shortly." } } });

router.post("/newsletter", limiter, validate(z.object({ email })), wrap((req, res) => {
  const exists = one("SELECT 1 FROM newsletter_subscribers WHERE email=?", req.body.email);
  if (!exists) run("INSERT INTO newsletter_subscribers (email) VALUES (?)", req.body.email);
  // Same response either way: do not reveal who is subscribed
  res.status(201).json({ ok: true, message: "Thanks! You're on the list." });
}));

router.post("/support/tickets", limiter, validate(z.object({
  name: str(2, 80, "Your name is required"),
  email,
  subject: str(3, 120, "Subject is required"),
  message: str(10, 2000, "Tell us a bit more (at least 10 characters)"),
  orderNumber: z.string().trim().max(30).optional().or(z.literal("")),
})), wrap((req, res) => {
  const b = req.body;
  const id = tx(() => {
    const r = run("INSERT INTO support_tickets (user_id, name, email, subject, message, order_number) VALUES (?,?,?,?,?,?)", req.user?.id ?? null, b.name, b.email, b.subject, b.message, b.orderNumber || null);
    publish("support.created", { ticketId: Number(r.lastInsertRowid), subject: b.subject });
    return Number(r.lastInsertRowid);
  });
  res.status(201).json({ ok: true, ticketId: id, message: "Thanks — we'll respond within 24 hours." });
}));

router.get("/meta/site", (_req, res) => {
  res.json({
    brand: config.brand,
    freeDeliveryThreshold: config.commerce.freeDeliveryThresholdCents / 100,
    deliveryFee: config.commerce.deliveryFeeCents / 100,
    demoMode: config.demoMode,
    demoAccounts: config.demoMode ? [
      { role: "admin", label: "Super Admin", email: "admin@bekies.test", password: "Admin123!" },
      { role: "manager", label: "Operations Manager", email: "manager@bekies.test", password: "Manager123!" },
      { role: "seller", label: "Verified Seller", email: "seller@bekies.test", password: "Seller123!" },
      { role: "buyer", label: "Customer", email: "lerato@bekies.test", password: "Buyer123!" },
    ] : [],
  });
});

export default router;
