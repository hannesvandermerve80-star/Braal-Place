import test, { after } from "node:test";
import assert from "node:assert/strict";
import { as, ACCOUNTS, client, close, dbm, quickOrder, processOutbox, contact } from "./helpers.js";
import { processEmails } from "../src/services/mailer.js";

after(close);
const lastEmail = (to, subjectLike) => dbm.one("SELECT * FROM emails WHERE to_addr=? AND subject LIKE ? ORDER BY id DESC LIMIT 1", to, `%${subjectLike}%`);
const tokenFrom = (mail) => decodeURIComponent(mail.text_body.match(/[?&](?:reset|verify)=([^\s&]+)/)[1]);

test("forgot password never reveals whether an account exists", async () => {
  const c = client();
  const known = await c.post("/auth/forgot-password", { email: "lerato@bekies.test" });
  const unknown = await c.post("/auth/forgot-password", { email: "nobody@example.com" });
  assert.equal(known.status, 200);
  assert.deepEqual(known.body, unknown.body);
  assert.equal(dbm.one("SELECT COUNT(*) c FROM emails WHERE to_addr='nobody@example.com'").c, 0);
  assert.ok(lastEmail("lerato@bekies.test", "Reset your"));
});

test("reset link works once, sets the new password, revokes old sessions", async () => {
  const old = await as(...ACCOUNTS.sipho);
  assert.equal((await old.get("/auth/me")).body.user.email, "sipho@bekies.test");
  await new Promise((r) => setTimeout(r, 1100)); // iat has 1s granularity
  const c = client();
  await c.post("/auth/forgot-password", { email: "sipho@bekies.test" });
  const token = tokenFrom(lastEmail("sipho@bekies.test", "Reset your"));
  assert.equal((await c.post("/auth/reset-password", { token, newPassword: "short" })).status, 400, "weak password rejected");
  assert.equal((await c.post("/auth/reset-password", { token, newPassword: "BrandNew123!" })).status, 200);
  assert.equal((await c.post("/auth/reset-password", { token, newPassword: "Another123!" })).status, 400, "token is single use");
  assert.equal((await old.get("/auth/me")).body.user, null, "previous session revoked");
  assert.equal((await client().post("/auth/login", { email: "sipho@bekies.test", password: "BrandNew123!" })).status, 200);
  assert.equal((await client().post("/auth/login", { email: "sipho@bekies.test", password: "Buyer123!" })).status, 401);
  assert.equal((await c.post("/auth/reset-password", { token: "x".repeat(43), newPassword: "Another123!" })).status, 400);
});

test("registration queues a verification email and the link verifies the account", async () => {
  const c = client();
  const r = await c.post("/auth/register/customer", { firstName: "Vera", lastName: "Verify", email: "vera@example.co.za", password: "Verify123!", mobile: "+27 82 111 2222", consent: true });
  assert.equal(r.status, 201);
  const token = tokenFrom(lastEmail("vera@example.co.za", "Confirm your email"));
  assert.equal((await c.post("/auth/verify-email", { token })).status, 200);
  assert.equal(dbm.one("SELECT email_verified v FROM users WHERE email='vera@example.co.za'").v, 1);
  assert.equal((await c.post("/auth/verify-email", { token })).status, 400);
});

test("a paid order queues exactly one receipt email, delivered by the worker", async () => {
  const { order, c } = await quickOrder();
  assert.equal((await c.post("/payments/demo/pay", { orderNumber: order.number, email: contact.email, outcome: "success" })).status, 200);
  processOutbox(); processOutbox();
  const rows = dbm.all("SELECT * FROM emails WHERE subject LIKE ?", `%${order.number}%confirmed%`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].to_addr, contact.email);
  await processEmails(500);
  assert.equal(dbm.one("SELECT status FROM emails WHERE id=?", rows[0].id).status, "sent");
});

test("seller product photo upload accepts real images only", async () => {
  const s = await as(...ACCOUNTS.seller);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const form = (buf, name) => { const f = new FormData(); f.append("file", new Blob([buf]), name); return f; };
  const ok = await s.post("/seller/uploads/image", form(png, "a.png"));
  assert.equal(ok.status, 201);
  assert.match(ok.body.url, /^\/uploads\/products\/[0-9a-f]{28}\.png$/);
  assert.equal((await s.post("/seller/uploads/image", form(Buffer.from("<script>alert(1)</script>"), "x.png"))).status, 400);
  assert.equal((await client().post("/seller/uploads/image", form(png, "a.png"))).status, 401);
});
