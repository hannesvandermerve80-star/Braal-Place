import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { all, one, run } from "../db/index.js";
import { config } from "../config.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { badRequest, conflict, forbidden, notFound, wrap } from "../lib/httpError.js";
import { hasPermission } from "../lib/permissions.js";
import { DECISIONS, decideApplication, serializeApplication, submitApplication } from "../services/applications.js";
import { audit } from "../services/audit.js";
import { email, mobile } from "../lib/validators.js";

const router = Router();
fs.mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const MAGIC = [
  { mime: "application/pdf", ext: ".pdf", test: (b) => b.subarray(0, 4).toString() === "%PDF" },
  { mime: "image/png", ext: ".png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: ".jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

const myApplication = (user) => one("SELECT * FROM seller_applications WHERE user_id=? ORDER BY id DESC LIMIT 1", user.id);
const DATA_KEYS = ["businessName", "registrationNumber", "taxNumber", "businessAddress", "storeName", "storeDescription", "primaryCategory", "fulfilmentCity", "supportEmail"];

/** Current user's application (creates a draft for customers who want to start selling). */
router.get("/me", requireAuth, wrap((req, res) => {
  let app = myApplication(req.user);
  if (!app && ["buyer", "seller"].includes(req.user.role)) {
    run("INSERT INTO seller_applications (user_id) VALUES (?)", req.user.id);
    app = myApplication(req.user);
  }
  if (!app) throw notFound("No seller application");
  res.json({ application: serializeApplication(app, { detail: true }) });
}));

const draftSchema = z.object({
  step: z.number().int().min(1).max(5).optional(),
  data: z.object({
    businessName: z.string().trim().max(120), registrationNumber: z.string().trim().max(60), taxNumber: z.string().trim().max(60),
    businessAddress: z.string().trim().max(200), storeName: z.string().trim().max(80), storeDescription: z.string().trim().max(500),
    primaryCategory: z.string().trim().max(60), fulfilmentCity: z.string().trim().max(60),
    supportEmail: z.union([email, z.literal("")]),
  }).partial(),
});

router.put("/me", requireAuth, validate(draftSchema), wrap((req, res) => {
  const app = myApplication(req.user);
  if (!app) throw notFound("No seller application");
  if (!["draft", "rejected"].includes(app.status) && !app.needs_documents) throw conflict("This application is locked while it is being reviewed");
  const merged = { ...JSON.parse(app.data || "{}") };
  for (const k of DATA_KEYS) if (req.body.data[k] !== undefined) merged[k] = req.body.data[k];
  run("UPDATE seller_applications SET data=?, step=COALESCE(?, step), updated_at=datetime('now') WHERE id=?", JSON.stringify(merged), req.body.step ?? null, app.id);
  res.json({ application: serializeApplication(one("SELECT * FROM seller_applications WHERE id=?", app.id), { detail: true }) });
}));

/** Private document upload (stored outside any public path; downloads are authorised per request). */
router.post("/me/documents", requireAuth, upload.single("file"), wrap((req, res) => {
  const kind = z.enum(["identity", "business", "food_safety"]).safeParse(req.body.kind);
  if (!kind.success) throw badRequest("Document type must be identity, business or food_safety");
  if (!req.file) throw badRequest("Choose a file to upload");
  const app = myApplication(req.user);
  if (!app) throw notFound("No seller application");
  if (!["draft", "rejected"].includes(app.status) && !app.needs_documents) throw conflict("This application is locked while it is being reviewed");
  const type = MAGIC.find((m) => m.test(req.file.buffer));
  if (!type) throw badRequest("Only PDF, JPG or PNG files are accepted");
  const stored = `${crypto.randomBytes(16).toString("hex")}${type.ext}`;
  fs.writeFileSync(path.join(config.uploadDir, stored), req.file.buffer, { mode: 0o600 });
  const prev = one("SELECT stored_name FROM application_documents WHERE application_id=? AND kind=?", app.id, kind.data);
  if (prev) { fs.rmSync(path.join(config.uploadDir, prev.stored_name), { force: true }); run("DELETE FROM application_documents WHERE application_id=? AND kind=?", app.id, kind.data); }
  const safeName = path.basename(req.file.originalname).replace(/[^\w.\- ]/g, "_").slice(0, 120);
  run("INSERT INTO application_documents (application_id, kind, original_name, stored_name, mime, size) VALUES (?,?,?,?,?,?)", app.id, kind.data, safeName, stored, type.mime, req.file.size);
  run("UPDATE seller_applications SET updated_at=datetime('now') WHERE id=?", app.id);
  audit(req, "seller.document.uploaded", "seller_application", app.id, { kind: kind.data });
  res.status(201).json({ application: serializeApplication(one("SELECT * FROM seller_applications WHERE id=?", app.id), { detail: true }) });
}));

router.post("/me/submit", requireAuth, wrap((req, res) => {
  const app = myApplication(req.user);
  if (!app) throw notFound("No seller application");
  const updated = submitApplication(req, app);
  res.json({ application: serializeApplication(updated, { detail: true }) });
}));

/* ---------------------------------------------------------------- staff */
const REVIEW = requirePermission("seller.review");

router.get("/", requireAuth, REVIEW, validate(z.object({ status: z.string().optional(), q: z.string().trim().max(60).optional() }), "query"), wrap((req, res) => {
  const where = ["a.status != 'draft'"]; const params = [];
  if (req.query.status) { where.push("a.status = ?"); params.push(req.query.status); }
  if (req.query.q) { where.push("(a.business_name LIKE ?)"); params.push(`%${req.query.q}%`); }
  const rows = all(`SELECT a.* FROM seller_applications a WHERE ${where.join(" AND ")} ORDER BY a.escalated DESC, a.submitted_at DESC, a.id DESC LIMIT 200`, ...params);
  res.json({ items: rows.map((a) => serializeApplication(a)) });
}));

router.get("/:id", requireAuth, wrap((req, res) => {
  const app = one("SELECT * FROM seller_applications WHERE id=?", Number(req.params.id));
  if (!app || (app.user_id !== req.user.id && !hasPermission(req.user, "seller.review"))) throw notFound("Application not found");
  res.json({ application: serializeApplication(app, { detail: true }) });
}));

router.post("/:id/decision", requireAuth, REVIEW, validate(z.object({ decision: z.enum(DECISIONS), note: z.string().trim().max(500).optional() })), wrap((req, res) => {
  const app = one("SELECT * FROM seller_applications WHERE id=?", Number(req.params.id));
  if (!app || app.status === "draft") throw notFound("Application not found");
  const updated = decideApplication(req, app, req.body.decision, req.body.note);
  res.json({ application: serializeApplication(updated, { detail: true }) });
}));

/** Authorised document download — owner or reviewer only, never a public URL. */
router.get("/:id/documents/:docId", requireAuth, wrap((req, res) => {
  const app = one("SELECT * FROM seller_applications WHERE id=?", Number(req.params.id));
  if (!app) throw notFound("Document not found");
  if (app.user_id !== req.user.id && !hasPermission(req.user, "seller.review")) throw notFound("Document not found");
  const doc = one("SELECT * FROM application_documents WHERE id=? AND application_id=?", Number(req.params.docId), app.id);
  if (!doc) throw notFound("Document not found");
  audit(req, "seller.document.viewed", "seller_application", app.id, { docId: doc.id, kind: doc.kind });
  res.setHeader("Content-Type", doc.mime);
  res.setHeader("Content-Disposition", `attachment; filename="${doc.original_name}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(path.join(config.uploadDir, doc.stored_name));
}));

export default router;
