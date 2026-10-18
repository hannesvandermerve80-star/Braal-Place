import { Router } from "express";
import { z } from "zod";
import { all, one, run, tx } from "../db/index.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { notFound, unprocessable, wrap } from "../lib/httpError.js";
import { assertTransition, PRODUCT_TRANSITIONS } from "../lib/stateMachines.js";
import { PRODUCT_SELECT, serializeProduct } from "../services/catalog.js";
import { publish } from "../services/outbox.js";
import { audit } from "../services/audit.js";

const router = Router();

/** Moderation queue for staff */
router.get("/moderation", requireAuth, requirePermission("product.moderate"), wrap((_req, res) => {
  const rows = all(`${PRODUCT_SELECT} WHERE p.status IN ('submitted','changes_requested') ORDER BY p.updated_at ASC`);
  res.json({ items: rows.map((r) => serializeProduct(r, { includeInternal: true })) });
}));

router.post("/:id/moderation", requireAuth, requirePermission("product.moderate"), validate(z.object({ decision: z.enum(["approve", "request_changes"]), note: z.string().trim().max(500).optional() })), wrap((req, res) => {
  const p = one(`${PRODUCT_SELECT} WHERE p.id=?`, Number(req.params.id));
  if (!p) throw notFound("Product not found");
  tx(() => {
    if (req.body.decision === "approve") {
      assertTransition(PRODUCT_TRANSITIONS, p.status, "approved", "product status");
      assertTransition(PRODUCT_TRANSITIONS, "approved", "published", "product status");
      run("UPDATE products SET status='published', moderation_note=NULL, updated_at=datetime('now') WHERE id=?", p.id);
      publish("product.approved", { productId: p.id, name: p.name, storeId: p.store_id });
    } else {
      if (!req.body.note) throw unprocessable("Tell the seller what to change", { fields: { note: "A note is required" } });
      assertTransition(PRODUCT_TRANSITIONS, p.status, "changes_requested", "product status");
      run("UPDATE products SET status='changes_requested', moderation_note=?, updated_at=datetime('now') WHERE id=?", req.body.note, p.id);
      publish("product.changes_requested", { productId: p.id, name: p.name, storeId: p.store_id, note: req.body.note });
    }
    audit(req, `product.${req.body.decision}`, "product", p.id, { note: req.body.note });
  });
  res.json({ product: serializeProduct(one(`${PRODUCT_SELECT} WHERE p.id=?`, p.id), { includeInternal: true }) });
}));

export default router;
