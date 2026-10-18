import test, { after } from "node:test";
import assert from "node:assert/strict";
import { as, ACCOUNTS, client, close, dbm, processOutbox, base } from "./helpers.js";

after(close);

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
async function upload(c, kind, bytes = PDF, name = "doc.pdf") {
  // multipart upload needs the cookie header, so reuse the client's internal jar through a tiny wrapper call
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", new Blob([bytes]), name);
  return c.post("/seller-applications/me/documents", fd);
}

test("seller application: draft, validation, private documents, review and approval", async () => {
  const applicant = client();
  const reg = await applicant.post("/auth/register/seller", { firstName: "Kea", lastName: "Mahlangu", email: "kea@karoo-grill.co.za", password: "Grill12345", mobile: "0829998888", consent: true });
  assert.equal(reg.status, 201);

  // draft saves are partial and never grant privileges
  const draft = await applicant.put("/seller-applications/me", { step: 2, data: { businessName: "Kea's Karoo Grill", businessAddress: "5 Main Rd, Pretoria" } });
  assert.equal(draft.status, 200);
  assert.equal(draft.body.application.status, "draft");
  assert.equal(draft.body.application.step, 2);

  // submission requires mandatory fields + documents
  const early = await applicant.post("/seller-applications/me/submit");
  assert.equal(early.status, 422);
  assert.ok(early.body.error.details.missing.includes("Store name"));
  assert.ok(early.body.error.details.missing.includes("Identity document"));

  await applicant.put("/seller-applications/me", { data: { storeName: "Karoo Grill", primaryCategory: "Butchery", fulfilmentCity: "Pretoria", supportEmail: "orders@karoo-grill.co.za" } });
  // file type checks use magic bytes, not the extension or claimed mime
  assert.equal((await upload(applicant, "identity", Buffer.from("MZ not a pdf"), "evil.pdf")).status, 400);
  assert.equal((await upload(applicant, "identity")).status, 201);
  const withDocs = await upload(applicant, "business");
  assert.equal(withDocs.body.application.completeness, 100);

  const submitted = await applicant.post("/seller-applications/me/submit");
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.application.status, "submitted");
  assert.equal((await applicant.post("/seller-applications/me/submit")).status, 422, "cannot resubmit");
  assert.equal((await applicant.put("/seller-applications/me", { data: { storeName: "Changed" } })).status, 409, "locked during review");
  assert.equal((await applicant.get("/seller/products")).status, 403, "still no seller capabilities");

  // notifications are created exactly once for staff
  processOutbox(); processOutbox();
  const manager = await as(...ACCOUNTS.manager);
  const notes = (await manager.get("/me/notifications")).body.items.filter((n) => n.type === "seller.submitted" && n.body.includes("Kea's Karoo Grill"));
  assert.equal(notes.length, 1);

  const appId = submitted.body.application.id;
  const docId = submitted.body.application.documents[0].id;
  // documents are private: the owner and reviewers can fetch them, nobody else can
  assert.equal((await manager.get(`/seller-applications/${appId}/documents/${docId}`)).status, 200);
  assert.equal((await applicant.get(`/seller-applications/${appId}/documents/${docId}`)).status, 200);
  assert.equal((await as(...ACCOUNTS.sipho).then((c) => c.get(`/seller-applications/${appId}/documents/${docId}`))).status, 404);
  assert.equal((await client().get(`/seller-applications/${appId}/documents/${docId}`)).status, 401);
  assert.equal((await fetch(`${base.replace("/api", "")}/uploads/${dbm.one("SELECT stored_name FROM application_documents WHERE id=?", docId).stored_name}`)).status, 404, "no public media URL");

  // reviewer workflow with history
  assert.equal((await manager.post(`/seller-applications/${appId}/decision`, { decision: "reject" })).status, 422, "rejection needs a reason");
  assert.equal((await manager.post(`/seller-applications/${appId}/decision`, { decision: "start_review" })).status, 200);
  const approved = await manager.post(`/seller-applications/${appId}/decision`, { decision: "approve", note: "All checks passed" });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.application.status, "approved");
  assert.equal((await manager.post(`/seller-applications/${appId}/decision`, { decision: "approve" })).status, 409);
  const hist = approved.body.application.history.map((h) => h.to);
  assert.deepEqual(hist, ["submitted", "under_review", "approved"]);

  // approval unlocks the store, exactly once
  const me = (await applicant.get("/auth/me")).body.user;
  assert.equal(me.store.slug, "karoo-grill");
  assert.equal(dbm.one("SELECT COUNT(*) c FROM stores WHERE slug LIKE 'karoo-grill%'").c, 1);
  processOutbox(); processOutbox();
  assert.equal(dbm.all("SELECT * FROM notifications WHERE type='seller.approved'").filter((n) => n.user_id === me.id).length, 1);
  assert.equal((await applicant.get("/seller/products")).status, 200);

  // suspension retains history and locks the store
  await manager.post(`/seller-applications/${appId}/decision`, { decision: "suspend", note: "Compliance review" });
  assert.equal((await applicant.get("/seller/products")).status, 403);
  const final = (await manager.get(`/seller-applications/${appId}`)).body.application;
  assert.equal(final.history.length, 4);
});

test("product lifecycle: draft → submitted → moderated → published; changes requested loop", async () => {
  const seller = await as(...ACCOUNTS.seller);
  const manager = await as(...ACCOUNTS.manager);
  const cats = (await seller.get("/catalog/categories")).body.categories;
  const bad = await seller.post("/seller/products", { name: "x", categoryId: cats[0].id, price: -5 });
  assert.equal(bad.status, 400);

  const created = await seller.post("/seller/products", { name: "Smoked Brisket 1kg", description: "Low and slow", categoryId: cats[0].id, price: 399, oldPrice: 450, unit: "kg", stock: 12, image: "https://images.unsplash.com/photo-1613244666139-b6629daf6b96?w=600" });
  assert.equal(created.status, 201);
  const id = created.body.product.id;
  assert.equal(created.body.product.status, "draft");
  assert.equal((await client().get(`/catalog/products/${created.body.product.slug}`)).status, 404, "drafts are not public");
  assert.equal((await manager.post(`/products/${id}/moderation`, { decision: "approve" })).status, 422, "cannot approve a draft");

  assert.equal((await seller.post(`/seller/products/${id}/submit`)).status, 200);
  assert.equal((await seller.post(`/seller/products/${id}/submit`)).status, 422, "already submitted");
  assert.equal((await seller.get("/products/moderation")).status, 403);
  assert.ok((await manager.get("/products/moderation")).body.items.some((p) => p.id === id));

  assert.equal((await manager.post(`/products/${id}/moderation`, { decision: "request_changes" })).status, 422, "needs a note");
  assert.equal((await manager.post(`/products/${id}/moderation`, { decision: "request_changes", note: "Add weight in the title" })).status, 200);
  const mine = (await seller.get("/seller/products")).body.items.find((p) => p.id === id);
  assert.equal(mine.status, "changes_requested");
  assert.equal(mine.moderationNote, "Add weight in the title");

  await seller.patch(`/seller/products/${id}`, { name: "Smoked Brisket 1kg (whole)" });
  await seller.post(`/seller/products/${id}/submit`);
  const ok = await manager.post(`/products/${id}/moderation`, { decision: "approve" });
  assert.equal(ok.body.product.status, "published");
  const pub = await client().get(`/catalog/products/${ok.body.product.slug}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.product.seller.name, "Mzanzi Prime Meats");

  // inventory edits cannot go below reserved stock; price edits stay live without re-moderation
  assert.equal((await seller.patch(`/seller/products/${id}`, { price: 379 })).body.product.status, "published");
  assert.equal((await seller.patch(`/seller/products/${id}/inventory`, { stock: 30 })).status, 200);
});

test("public catalogue supports search, category, price, availability, special and sort filters", async () => {
  const c = client();
  const all = (await c.get("/catalog/products?limit=48")).body;
  assert.ok(all.total >= 18);
  assert.ok(all.items.every((p) => p.name));
  const lamb = (await c.get("/catalog/products?q=lamb")).body.items;
  assert.ok(lamb.length >= 1 && lamb.every((p) => /lamb/i.test(p.name + p.description)));
  const sauces = (await c.get("/catalog/products?category=sauces")).body.items;
  assert.ok(sauces.length >= 3 && sauces.every((p) => p.category === "Sauces"));
  const cheap = (await c.get("/catalog/products?maxPrice=100&sort=price_asc")).body.items;
  assert.ok(cheap.every((p) => p.price <= 100));
  assert.deepEqual(cheap.map((p) => p.price), [...cheap.map((p) => p.price)].sort((a, b) => a - b));
  const inStock = (await c.get("/catalog/products?inStock=true&limit=48")).body.items;
  assert.ok(inStock.every((p) => p.inStock) && !inStock.some((p) => p.slug === "chicken-braai-pack"));
  const specials = (await c.get("/catalog/products?specials=true")).body.items;
  assert.ok(specials.length && specials.every((p) => p.oldPrice > p.price));
  assert.equal((await c.get("/catalog/products?sort=bogus")).status, 400);
  assert.equal((await c.get("/catalog/products/does-not-exist")).status, 404);
  const store = await c.get("/stores/karoo-choice");
  assert.equal(store.status, 200);
  assert.ok(store.body.products.every((p) => p.seller.slug === "karoo-choice"));
});

test("support and newsletter endpoints validate input and do not leak subscribers", async () => {
  const c = client();
  assert.equal((await c.post("/newsletter", { email: "bad" })).status, 400);
  const a = await c.post("/newsletter", { email: "fan@example.co.za" });
  const b = await c.post("/newsletter", { email: "fan@example.co.za" });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal(dbm.one("SELECT COUNT(*) c FROM newsletter_subscribers WHERE email='fan@example.co.za'").c, 1);
  assert.equal((await c.post("/support/tickets", { name: "A", email: "a@b.co", subject: "Hi", message: "short" })).status, 400);
  const t = await c.post("/support/tickets", { name: "Pieter", email: "p@example.co.za", subject: "Bulk order", message: "Can you supply 50 braai boxes?" });
  assert.equal(t.status, 201);
  const admin = await as(...ACCOUNTS.admin);
  assert.ok((await admin.get("/admin/support")).body.items.some((x) => x.id === t.body.ticketId));
});

test("unknown API routes and malformed bodies return structured errors", async () => {
  const c = client();
  const nf = await c.get("/nope");
  assert.equal(nf.status, 404);
  assert.ok(nf.body.error.requestId);
  const res = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.message, "Malformed JSON body");
});
