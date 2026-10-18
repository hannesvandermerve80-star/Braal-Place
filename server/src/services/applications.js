import { all, one, run, tx } from "../db/index.js";
import { assertTransition, APPLICATION_TRANSITIONS } from "../lib/stateMachines.js";
import { slugify } from "../lib/slug.js";
import { conflict, unprocessable } from "../lib/httpError.js";
import { publish } from "./outbox.js";
import { audit } from "./audit.js";

/** Fields required before an application can be submitted. */
export const REQUIRED_FIELDS = [
  ["businessName", "Registered business name"],
  ["businessAddress", "Business address"],
  ["storeName", "Store name"],
  ["primaryCategory", "Primary category"],
  ["fulfilmentCity", "Fulfilment city"],
  ["supportEmail", "Support email"],
];
export const REQUIRED_DOCS = ["identity", "business"];

export function completeness(app, docs) {
  const data = JSON.parse(app.data || "{}");
  const total = REQUIRED_FIELDS.length + REQUIRED_DOCS.length;
  const done = REQUIRED_FIELDS.filter(([k]) => String(data[k] ?? "").trim()).length + REQUIRED_DOCS.filter((k) => docs.some((d) => d.kind === k)).length;
  return Math.round((done / total) * 100);
}

export function displayStatus(app) {
  if (app.escalated) return "Escalated";
  if (app.needs_documents) return "Documents needed";
  return { draft: "Draft", submitted: "Submitted", under_review: "Under review", approved: "Approved", rejected: "Rejected", suspended: "Suspended" }[app.status];
}

export function serializeApplication(app, { detail = false } = {}) {
  const docs = all("SELECT id, kind, original_name, mime, size, created_at FROM application_documents WHERE application_id=?", app.id).map((d) => ({ ...d }));
  const user = one("SELECT id, first_name, last_name, email, mobile FROM users WHERE id=?", app.user_id);
  const out = {
    id: app.id,
    status: app.status,
    displayStatus: displayStatus(app),
    step: app.step,
    businessName: app.business_name || JSON.parse(app.data || "{}").businessName || null,
    owner: user ? `${user.first_name} ${user.last_name}` : null,
    risk: app.risk,
    escalated: !!app.escalated,
    needsDocuments: !!app.needs_documents,
    completeness: completeness(app, docs),
    submittedAt: app.submitted_at,
    updatedAt: app.updated_at,
    decisionNote: app.decision_note,
    storeId: app.store_id,
    data: JSON.parse(app.data || "{}"),
    documents: docs.map((d) => ({ id: d.id, kind: d.kind, name: d.original_name, mime: d.mime, size: d.size, uploadedAt: d.created_at })),
  };
  if (detail) {
    out.representative = user ? { firstName: user.first_name, lastName: user.last_name, email: user.email, mobile: user.mobile } : null;
    out.history = all(`SELECT h.from_status, h.to_status, h.note, h.created_at, u.first_name, u.last_name FROM application_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.application_id=? ORDER BY h.id`, app.id)
      .map((h) => ({ from: h.from_status, to: h.to_status, note: h.note, at: h.created_at, actor: h.first_name ? `${h.first_name} ${h.last_name}` : "System" }));
  }
  return out;
}

const history = (appId, from, to, actorId, note) =>
  run("INSERT INTO application_history (application_id, from_status, to_status, actor_id, note) VALUES (?,?,?,?,?)", appId, from, to, actorId ?? null, note ?? null);

export function submitApplication(req, app) {
  return tx(() => {
    const data = JSON.parse(app.data || "{}");
    const docs = all("SELECT kind FROM application_documents WHERE application_id=?", app.id);
    const missing = [
      ...REQUIRED_FIELDS.filter(([k]) => !String(data[k] ?? "").trim()).map(([, label]) => label),
      ...REQUIRED_DOCS.filter((k) => !docs.some((d) => d.kind === k)).map((k) => `${k === "identity" ? "Identity" : "Business"} document`),
    ];
    if (missing.length) throw unprocessable("Your application is missing required information", { missing });
    assertTransition(APPLICATION_TRANSITIONS, app.status, "submitted", "application status");
    run("UPDATE seller_applications SET status='submitted', business_name=?, needs_documents=0, submitted_at=datetime('now'), updated_at=datetime('now') WHERE id=?", data.businessName, app.id);
    history(app.id, app.status, "submitted", req.user.id, "Application submitted");
    publish("seller.submitted", { applicationId: app.id, userId: app.user_id, businessName: data.businessName });
    audit(req, "seller.application.submitted", "seller_application", app.id);
    return one("SELECT * FROM seller_applications WHERE id=?", app.id);
  });
}

export const DECISIONS = ["start_review", "approve", "reject", "request_documents", "suspend", "reinstate", "escalate"];

export function decideApplication(req, app, decision, note) {
  return tx(() => {
    let to = app.status;
    switch (decision) {
      case "start_review": to = "under_review"; break;
      case "approve": to = "approved"; break;
      case "reject": to = "rejected"; break;
      case "suspend": to = "suspended"; break;
      case "reinstate": to = "approved"; break;
      case "request_documents":
        run("UPDATE seller_applications SET needs_documents=1, decision_note=?, updated_at=datetime('now') WHERE id=?", note ?? "Additional documents required", app.id);
        history(app.id, app.status, app.status, req.user.id, note ?? "Additional documents requested");
        audit(req, "seller.application.documents_requested", "seller_application", app.id, { note });
        return one("SELECT * FROM seller_applications WHERE id=?", app.id);
      case "escalate":
        run("UPDATE seller_applications SET escalated=1, updated_at=datetime('now') WHERE id=?", app.id);
        history(app.id, app.status, app.status, req.user.id, note ?? "Escalated to Super Admin");
        audit(req, "seller.application.escalated", "seller_application", app.id, { note });
        return one("SELECT * FROM seller_applications WHERE id=?", app.id);
    }
    if (["reject", "suspend"].includes(decision) && !String(note ?? "").trim()) throw unprocessable("A reason is required for this decision");
    if (decision === "approve" && app.status === "approved") throw conflict("Already approved");
    assertTransition(APPLICATION_TRANSITIONS, app.status, to, "application status");

    let storeId = app.store_id;
    const data = JSON.parse(app.data || "{}");
    if (to === "approved" && !storeId) {
      const base = slugify(data.storeName || data.businessName || `store-${app.id}`) || `store-${app.id}`;
      let slug = base, n = 2;
      while (one("SELECT 1 FROM stores WHERE slug=?", slug)) slug = `${base}-${n++}`;
      const r = run("INSERT INTO stores (slug, name, description, city, support_email, status, verified) VALUES (?,?,?,?,?, 'active', 1)",
        slug, data.storeName || data.businessName, data.storeDescription ?? null, data.fulfilmentCity ?? null, data.supportEmail ?? null);
      storeId = Number(r.lastInsertRowid);
      run("INSERT INTO store_members (store_id, user_id, role) VALUES (?,?, 'owner')", storeId, app.user_id);
      run("UPDATE users SET role='seller' WHERE id=? AND role='buyer'", app.user_id);
    }
    if (storeId) {
      if (to === "suspended") run("UPDATE stores SET status='suspended' WHERE id=?", storeId);
      if (to === "approved") run("UPDATE stores SET status='active' WHERE id=?", storeId);
    }
    run("UPDATE seller_applications SET status=?, store_id=?, assigned_to=COALESCE(assigned_to, ?), decision_note=?, escalated=0, needs_documents=0, updated_at=datetime('now') WHERE id=?",
      to, storeId, req.user.id, note ?? null, app.id);
    history(app.id, app.status, to, req.user.id, note);
    const evt = { start_review: null, approve: "seller.approved", reinstate: "seller.approved", reject: "seller.rejected", suspend: "seller.suspended" }[decision];
    if (evt) publish(evt, { applicationId: app.id, userId: app.user_id, note, businessName: data.businessName });
    audit(req, `seller.application.${decision}`, "seller_application", app.id, { note, from: app.status, to });
    return one("SELECT * FROM seller_applications WHERE id=?", app.id);
  });
}
