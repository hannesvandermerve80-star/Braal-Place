import test, { after } from "node:test";
import assert from "node:assert/strict";
import { as, ACCOUNTS, client, close, dbm, productId } from "./helpers.js";

after(close);

test("customer registration validates email, SA mobile, consent and duplicates", async () => {
  const c = client();
  const bad = await c.post("/auth/register/customer", { firstName: "A", lastName: "B", email: "nope", password: "short", mobile: "123", consent: false });
  assert.equal(bad.status, 400);
  for (const f of ["email", "mobile", "password", "consent"]) assert.ok(bad.body.error.details.fields[f], `${f} error`);

  const ok = await c.post("/auth/register/customer", { firstName: "New", lastName: "Customer", email: "new.customer@example.co.za", password: "Braai1234", mobile: "082 123 4567", consent: true });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.user.role, "buyer");
  assert.equal(ok.body.user.mobile, "+27821234567");
  assert.equal((await c.get("/auth/me")).body.user.email, "new.customer@example.co.za");

  const dup = await client().post("/auth/register/customer", { firstName: "New", lastName: "Customer", email: "NEW.customer@example.co.za", password: "Braai1234", mobile: "0821234567", consent: true });
  assert.equal(dup.status, 409);
});

test("login uses a generic error and locks after repeated failures", async () => {
  const c = client();
  const unknown = await c.post("/auth/login", { email: "ghost@example.com", password: "Whatever1" });
  const wrong = await c.post("/auth/login", { email: ACCOUNTS.sipho[0], password: "WrongPass1" });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error.message, unknown.body.error.message, "no account enumeration");
  for (let i = 0; i < 5; i++) await c.post("/auth/login", { email: "zodwa@bekies.test", password: "bad-password1" });
  const locked = await c.post("/auth/login", { email: "zodwa@bekies.test", password: "Buyer123!" });
  assert.equal(locked.status, 401);
  assert.match(locked.body.error.message, /Too many failed attempts/);
});

test("buyer cannot read another buyer's order by changing the identifier", async () => {
  const lerato = await as(...ACCOUNTS.lerato);
  const sipho = await as(...ACCOUNTS.sipho);
  const mine = (await lerato.get("/orders")).body.items[0];
  assert.equal((await lerato.get(`/orders/${mine.number}`)).status, 200);
  assert.equal((await sipho.get(`/orders/${mine.number}`)).status, 404);
  assert.equal((await client().get(`/orders/${mine.number}`)).status, 404);
  assert.equal((await client().get(`/orders/${mine.number}?email=lerato@bekies.test`)).status, 404, "registered-customer orders are not guest-lookupable");
});

test("seller is confined to their own store", async () => {
  const seller = await as(...ACCOUNTS.seller);
  const mine = (await seller.get("/seller/products")).body.items;
  assert.ok(mine.length >= 3 && mine.every((p) => p.seller.name === "Mzanzi Prime Meats"));
  const foreign = dbm.one("SELECT p.id FROM products p JOIN stores s ON s.id=p.store_id WHERE s.name='Karoo Choice' LIMIT 1").id;
  assert.equal((await seller.patch(`/seller/products/${foreign}`, { price: 1 })).status, 404);
  assert.equal((await seller.patch(`/seller/products/${foreign}/inventory`, { stock: 9999 })).status, 404);
  const orders = (await seller.get("/orders?limit=100")).body.items;
  for (const o of orders) assert.ok(o.sellers.every((s) => s.name === "Mzanzi Prime Meats"), "only own seller sub-orders are visible");
  const karooOrder = dbm.one("SELECT o.number FROM orders o JOIN seller_orders so ON so.order_id=o.id JOIN stores s ON s.id=so.store_id WHERE s.name='Karoo Choice' AND o.id NOT IN (SELECT order_id FROM seller_orders WHERE store_id=1) LIMIT 1").number;
  assert.equal((await seller.get(`/orders/${karooOrder}`)).status, 404);
  assert.equal((await seller.post(`/orders/${karooOrder}/transitions`, { to: "accepted" })).status, 404);
});

test("seller with an unapproved application cannot publish products or reach payouts", async () => {
  const c = client();
  const reg = await c.post("/auth/register/seller", { firstName: "New", lastName: "Seller", email: "new.seller@example.co.za", password: "Seller1234", mobile: "0821230000", consent: true });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.role, "seller");
  assert.equal(reg.body.user.store, null);
  assert.equal((await c.get("/seller/products")).status, 403);
  assert.equal((await c.get("/seller/payouts")).status, 403);
});

test("staff permissions are granular and server-enforced", async () => {
  const manager = await as(...ACCOUNTS.manager);
  assert.equal((await manager.get("/admin/payments")).status, 403);
  assert.equal((await manager.get("/admin/users")).status, 403);
  assert.equal((await manager.get("/admin/audit-logs")).status, 403);
  assert.equal((await manager.get("/seller-applications")).status, 200);
  const buyer = await as(...ACCOUNTS.sipho);
  assert.equal((await buyer.get("/seller-applications")).status, 403);
  assert.equal((await buyer.get("/admin/payments")).status, 403);
  assert.equal((await client().get("/admin/users")).status, 401);
});

test("super admin sensitive actions need password confirmation and are audited", async () => {
  const admin = await as(...ACCOUNTS.admin);
  const target = dbm.one("SELECT id FROM users WHERE email='manager@bekies.test'").id;
  const denied = await admin.patch(`/admin/users/${target}`, { permissions: ["seller.review", "payments.view"], confirmPassword: "wrong" });
  assert.equal(denied.status, 403);
  const ok = await admin.patch(`/admin/users/${target}`, { permissions: ["seller.review", "payments.view"], confirmPassword: "Admin123!" });
  assert.equal(ok.status, 200);
  const manager = await as(...ACCOUNTS.manager);
  assert.equal((await manager.get("/admin/payments")).status, 200, "new permission takes effect");
  const logs = (await admin.get("/admin/audit-logs?q=user.updated")).body.items;
  assert.ok(logs.length && logs[0].meta.before && logs[0].meta.after, "audit has before/after metadata");
  assert.throws(() => dbm.run("UPDATE audit_logs SET action='x'"), /append-only/);
  assert.throws(() => dbm.run("DELETE FROM audit_logs"), /append-only/);
});

test("guest cart merges into the account cart on login", async () => {
  const c = client();
  await c.post("/cart/items", { productId: productId("smoky-braai-sauce"), qty: 2 });
  assert.equal((await c.get("/cart")).body.count, 2);
  await c.login(...ACCOUNTS.sipho);
  const cart = (await c.get("/cart")).body;
  assert.equal(cart.count, 2);
});
