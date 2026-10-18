import test, { after } from "node:test";
import assert from "node:assert/strict";
import { as, ACCOUNTS, client, close, dbm, placeOrder, productId, processOutbox, webhook, contact, address } from "./helpers.js";

after(close);
const stockOf = (slug) => dbm.one("SELECT stock, reserved FROM inventory WHERE product_id=?", productId(slug));
const pay = (order, type = "payment.succeeded", id) => ({ id: id ?? `evt_${order.number}_${type}`, type, paymentRef: order.payment.reference, amountCents: Math.round(order.total * 100) });

test("checkout recalculates price, delivery, discount and VAT on the server", async () => {
  const c = client();
  await c.post("/cart/items", { productId: productId("smoky-braai-sauce"), qty: 2 }); // 2 x R69 = R138
  let cart = (await c.get("/cart")).body;
  assert.equal(cart.totals.subtotal, 138);
  assert.equal(cart.totals.delivery, 85, "under R750 pays delivery");
  assert.equal(cart.totals.total, 223);
  assert.equal((await c.post("/cart/promo", { code: "nope" })).status, 400);
  assert.equal((await c.post("/cart/promo", { code: "BRAAI10" })).status, 400, "BRAAI10 needs R300 minimum");

  await c.post("/cart/items", { productId: productId("family-braai-box"), qty: 1 }); // +649 => 787 >= 750
  assert.equal((await c.post("/cart/promo", { code: "braai10" })).status, 200);
  cart = (await c.get("/cart")).body;
  assert.equal(cart.totals.subtotal, 787);
  assert.equal(cart.totals.delivery, 0, "free over R750");
  assert.equal(cart.totals.discount, 78.7);
  assert.equal(cart.totals.total, 708.3);
  assert.equal(cart.totals.vat, +(708.3 - 708.3 / 1.15).toFixed(2));

  const r = await c.post("/checkout/orders", { contact, address, idempotencyKey: "idem-key-0001" });
  assert.equal(r.status, 201);
  assert.equal(r.body.order.total, 708.3);
  assert.equal(r.body.order.status, "pending_payment");
  assert.equal((await c.get("/cart")).body.count, 0, "cart cleared");
  // The client cannot tamper with prices: there is no price field accepted at all
  // Retrying the same request (double-click / network retry) returns the same order instead of creating another
  const replay = await c.post("/checkout/orders", { contact, address, idempotencyKey: "idem-key-0001" });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.order.number, r.body.order.number);
  assert.equal((await c.post("/checkout/orders", { contact, address })).status, 400, "empty cart cannot check out");
});

test("checkout rejects invalid contact and address details with field errors", async () => {
  const c = client();
  await c.post("/cart/items", { productId: productId("smoky-braai-sauce"), qty: 1 });
  const r = await c.post("/checkout/orders", { contact: { ...contact, email: "bad", mobile: "12" }, address: { ...address, postalCode: "AB" } });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.details.fields["contact.email"] && r.body.error.details.fields["contact.mobile"] && r.body.error.details.fields["address.postalCode"]);
});

test("the last unit cannot be oversold; cancelling releases stock", async () => {
  const id = productId("pap-and-chakalaka-combo");
  dbm.run("UPDATE inventory SET stock=1, reserved=0 WHERE product_id=?", id);
  const a = client(), b = client();
  const first = await placeOrder(a, [[id, 1]]);
  assert.equal(first.status, 201);
  assert.deepEqual({ ...stockOf("pap-and-chakalaka-combo") }, { stock: 1, reserved: 1 });
  const second = await placeOrder(b, [[id, 1]]);
  assert.equal(second.status, 409, "second shopper cannot add the reserved last unit");
  // even bypassing the cart check, createOrder's atomic reservation holds
  const { createOrder } = await import("../src/services/orders.js");
  assert.throws(() => createOrder({ contact, address, items: [{ productId: id, qty: 1 }] }), /out of stock|left in stock/);
  assert.deepEqual({ ...stockOf("pap-and-chakalaka-combo") }, { stock: 1, reserved: 1 }, "failed attempt leaves no partial reservation");

  const owner = await a.post(`/orders/${first.body.order.number}/transitions?email=${contact.email}`, { to: "cancelled" });
  assert.equal(owner.status, 401, "guests cannot cancel without signing in");
  const cancelUser = await as(...ACCOUNTS.sipho);
  const mine = await placeOrder(cancelUser, [[productId("pap-and-chakalaka-combo"), 1]]);
  assert.equal(mine.status, 409, "still reserved by the first order");
  dbm.run("UPDATE inventory SET stock=5 WHERE product_id=?", id);
  const o = await placeOrder(cancelUser, [[id, 2]]);
  assert.equal(o.status, 201);
  assert.equal(stockOf("pap-and-chakalaka-combo").reserved, 3);
  const cancelled = await cancelUser.post(`/orders/${o.body.order.number}/transitions`, { to: "cancelled" });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.order.status, "cancelled");
  assert.equal(stockOf("pap-and-chakalaka-combo").reserved, 1, "reservation released in the same transaction");
});

test("a frontend 'success' alone never marks a payment confirmed; only a signed webhook does", async () => {
  const c = client();
  const { body } = await placeOrder(c, [[productId("traditional-boerewors-1kg"), 1]]);
  const order = body.order;
  assert.equal(order.paymentStatus, "initiated");
  // unsigned / wrongly-signed webhooks are rejected
  assert.equal((await webhook(c, pay(order), { sign: false })).status, 403);
  assert.equal((await webhook(c, pay(order), { signature: "deadbeef" })).status, 403);
  assert.equal((await c.get(`/orders/${order.number}?email=${contact.email}`)).body.order.paymentStatus, "initiated");
  // amount mismatch refused
  assert.equal((await webhook(c, { ...pay(order), amountCents: 1 })).status, 422);

  const before = stockOf("traditional-boerewors-1kg");
  const ok = await webhook(c, pay(order));
  assert.equal(ok.status, 200);
  const fresh = (await c.get(`/orders/${order.number}?email=${contact.email}`)).body.order;
  assert.equal(fresh.paymentStatus, "confirmed");
  assert.equal(fresh.status, "confirmed");
  const after = stockOf("traditional-boerewors-1kg");
  assert.equal(after.stock, before.stock - 1);
  assert.equal(after.reserved, before.reserved - 1);
});

test("duplicate webhooks produce no duplicate ledger, order change, or notification", async () => {
  const buyer = await as(...ACCOUNTS.sipho);
  const { body } = await placeOrder(buyer, [[productId("droewors-500g"), 1]]);
  const evt = pay(body.order);
  const counts = () => ({
    ledger: dbm.one("SELECT COUNT(*) c FROM ledger_entries WHERE order_id=?", body.order.id).c,
    events: dbm.one("SELECT COUNT(*) c FROM order_events WHERE order_id=?", body.order.id).c,
    stock: stockOf("droewors-500g").stock,
  });
  assert.equal((await webhook(buyer, evt)).status, 200);
  processOutbox();
  const once = counts();
  assert.equal(once.ledger, 2, "one sale + one commission entry");
  for (let i = 0; i < 3; i++) { const dup = await webhook(buyer, evt); assert.equal(dup.body.duplicate, true); }
  // a *different* event id for the same already-confirmed payment is also a no-op
  const again = await webhook(buyer, pay(body.order, "payment.succeeded", "evt_other_id"));
  assert.equal(again.body.duplicate, true);
  processOutbox();
  assert.deepEqual(counts(), once);
  const notes = dbm.all("SELECT * FROM notifications WHERE type='payment.confirmed' AND title LIKE ?", `%${body.order.number}%`);
  assert.equal(notes.length, 1);
});

test("failed payments can be retried through the demo provider", async () => {
  const c = await as(...ACCOUNTS.sipho);
  const { body } = await placeOrder(c, [[productId("garlic-and-herb-marinade"), 1]]);
  const num = body.order.number;
  const declined = await c.post("/payments/demo/pay", { orderNumber: num, outcome: "decline" });
  assert.equal(declined.status, 200);
  assert.equal(declined.body.order.paymentStatus, "failed");
  assert.equal(declined.body.order.status, "pending_payment");
  const retry = await c.post("/payments/demo/pay", { orderNumber: num, outcome: "success" });
  assert.equal(retry.body.order.paymentStatus, "confirmed");
  assert.equal((await c.post("/payments/demo/pay", { orderNumber: num, outcome: "success" })).status, 409, "already paid");
});

test("invalid or out-of-order status transitions are rejected and valid ones flow to every view", async () => {
  const buyer = await as(...ACCOUNTS.lerato);
  const seller = await as(...ACCOUNTS.seller);
  const admin = await as(...ACCOUNTS.admin);
  const { body } = await placeOrder(buyer, [[productId("family-braai-box"), 1]]);
  const num = body.order.number;
  const sellerPay = async () => (await buyer.post("/payments/demo/pay", { orderNumber: num, outcome: "success" })).status;
  // seller cannot touch an unpaid order's fulfilment
  assert.equal((await seller.post(`/orders/${num}/transitions`, { to: "accepted" })).status, 422);
  assert.equal(await sellerPay(), 200);
  assert.equal((await seller.post(`/orders/${num}/transitions`, { to: "delivered" })).status, 422, "cannot skip packing/dispatch");
  assert.equal((await seller.post(`/orders/${num}/transitions`, { to: "refunded" })).status, 403, "sellers cannot set refunded");
  assert.equal((await buyer.post(`/orders/${num}/transitions`, { to: "packing" })).status, 403, "buyers can only cancel");
  for (const to of ["accepted", "packing", "ready", "dispatched"]) assert.equal((await seller.post(`/orders/${num}/transitions`, { to })).status, 200, to);
  assert.equal((await buyer.post(`/orders/${num}/transitions`, { to: "cancelled" })).status, 409, "too late for customer cancellation");
  assert.equal((await buyer.get(`/orders/${num}`)).body.order.status, "dispatched");
  assert.equal((await admin.get(`/orders/${num}`)).body.order.status, "dispatched");
  assert.equal((await seller.get(`/orders/${num}`)).body.order.status, "dispatched");
  assert.equal((await seller.post(`/orders/${num}/transitions`, { to: "delivered" })).status, 200);
  const tl = (await buyer.get(`/orders/${num}`)).body.order.timeline.map((t) => t.status);
  assert.deepEqual(tl, ["pending_payment", "confirmed", "accepted", "packing", "ready", "dispatched", "delivered"]);
});

test("multi-seller orders roll up status and expose items only to the applicable seller", async () => {
  const buyer = await as(...ACCOUNTS.lerato);
  const { body } = await placeOrder(buyer, [[productId("family-braai-box"), 1], [productId("premium-lamb-chops"), 1]]); // Mzanzi + Karoo
  const num = body.order.number;
  assert.equal(body.order.sellers.length, 2);
  await buyer.post("/payments/demo/pay", { orderNumber: num, outcome: "success" });
  const seller = await as(...ACCOUNTS.seller);
  const mine = (await seller.get(`/orders/${num}`)).body.order;
  assert.deepEqual(mine.items.map((i) => i.name), ["Family Braai Box"]);
  assert.equal(mine.contact.email, undefined, "sellers do not get buyer contact details");
  await seller.post(`/orders/${num}/transitions`, { to: "accepted" });
  const rolled = (await buyer.get(`/orders/${num}`)).body.order;
  assert.equal(rolled.status, "confirmed", "overall status = least advanced seller");
  assert.deepEqual(rolled.sellers.map((s) => s.status).sort(), ["accepted", "confirmed"]);
});

test("refunds: cannot exceed captured funds, need permission + password, ledger stays consistent", async () => {
  const buyer = await as(...ACCOUNTS.lerato);
  const admin = await as(...ACCOUNTS.admin);
  const manager = await as(...ACCOUNTS.manager);
  const { body } = await placeOrder(buyer, [[productId("family-braai-box"), 1]]);
  const num = body.order.number;
  await buyer.post("/payments/demo/pay", { orderNumber: num, outcome: "success" });
  const total = body.order.total;
  const tooMuch = await admin.post(`/orders/${num}/refunds`, { amount: total + 1, reason: "Too much" });
  assert.equal(tooMuch.status, 422);
  const ok = await admin.post(`/orders/${num}/refunds`, { amount: 100, reason: "Goodwill refund" });
  assert.equal(ok.status, 201);
  const id = ok.body.refund.id;
  assert.equal((await manager.post(`/admin/refunds/${id}/decision`, { approve: true, confirmPassword: "Manager123!" })).status, 403, "manager lacks refund.approve");
  assert.equal((await admin.post(`/admin/refunds/${id}/decision`, { approve: true, confirmPassword: "nope" })).status, 403);
  assert.equal((await admin.post(`/admin/refunds/${id}/decision`, { approve: true, confirmPassword: "Admin123!" })).status, 200);
  assert.equal((await admin.post(`/admin/refunds/${id}/decision`, { approve: true, confirmPassword: "Admin123!" })).status, 409, "decided once");
  const p = dbm.one("SELECT * FROM payments WHERE order_id=? ORDER BY id DESC", body.order.id);
  assert.equal(p.status, "partially_refunded");
  assert.equal(p.refunded_cents, 10000);
  const led = dbm.all("SELECT kind, amount_cents FROM ledger_entries WHERE order_id=?", body.order.id);
  assert.equal(led.find((l) => l.kind === "refund").amount_cents, -10000);
  assert.equal(led.find((l) => l.kind === "refund_commission").amount_cents, 1000, "10% commission clawed back pro-rata");
  // a second refund beyond what's left is refused
  assert.equal((await admin.post(`/orders/${num}/refunds`, { amount: total, reason: "again" })).status, 422);
});

test("payouts exclude disputed, refunded, pending and unsettled funds", async () => {
  const admin = await as(...ACCOUNTS.admin);
  const seller = await as(...ACCOUNTS.seller);
  const buyer = await as(...ACCOUNTS.sipho);
  await admin.post("/admin/payouts/run", { confirmPassword: "Admin123!" }); // clear everything currently settled
  const { body } = await placeOrder(buyer, [[productId("ribeye-steak-pack"), 1]]); // Mzanzi R289 (stock 4)
  const num = body.order.number;
  await buyer.post("/payments/demo/pay", { orderNumber: num, outcome: "success" });
  let bal = (await seller.get("/seller/payouts")).body.balance;
  const pendingBefore = bal.pending;
  assert.ok(pendingBefore >= 260.1 - 0.01, "paid but undelivered funds are pending, not available");
  for (const to of ["accepted", "packing", "ready", "dispatched", "delivered"]) await seller.post(`/orders/${num}/transitions`, { to });
  bal = (await seller.get("/seller/payouts")).body.balance;
  assert.equal(bal.available, 260.1, "R289 less 10% commission once delivered");

  // a refund request on the delivered order marks funds as disputed -> excluded from payout
  const req = await buyer.post(`/orders/${num}/refunds`, { amount: 50, reason: "Damaged packaging" });
  assert.equal(req.status, 201);
  assert.equal((await seller.get("/seller/payouts")).body.balance.available, 0);
  const run1 = await admin.post("/admin/payouts/run", { confirmPassword: "Admin123!" });
  assert.equal(run1.body.created.length, 0, "disputed funds are not paid out");

  // approve the refund -> settled net funds become payable (260.10 - 45.00)
  await admin.post(`/admin/refunds/${req.body.refund.id}/decision`, { approve: true, confirmPassword: "Admin123!" });
  assert.equal((await seller.get("/seller/payouts")).body.balance.available, 215.1);
  const run2 = await admin.post("/admin/payouts/run", { confirmPassword: "Admin123!" });
  assert.equal(run2.body.created.length, 1);
  assert.equal(run2.body.created[0].amount, 215.1);
  assert.equal((await seller.get("/seller/payouts")).body.balance.available, 0);
});

test("cancelling a paid order restocks inventory and opens a refund request", async () => {
  const buyer = await as(...ACCOUNTS.lerato);
  const slug = "peri-peri-basting-sauce";
  const before = stockOf(slug);
  const { body } = await placeOrder(buyer, [[productId(slug), 2]]);
  await buyer.post("/payments/demo/pay", { orderNumber: body.order.number, outcome: "success" });
  assert.equal(stockOf(slug).stock, before.stock - 2);
  const c = await buyer.post(`/orders/${body.order.number}/transitions`, { to: "cancelled" });
  assert.equal(c.status, 200);
  assert.equal(stockOf(slug).stock, before.stock, "stock returned");
  const refund = dbm.one("SELECT * FROM refunds WHERE order_id=?", body.order.id);
  assert.equal(refund.status, "requested");
  assert.equal(refund.amount_cents, 11800);
});

test("order list is role scoped", async () => {
  const lerato = (await (await as(...ACCOUNTS.lerato)).get("/orders?limit=100")).body;
  const leratoId = dbm.one("SELECT id FROM users WHERE email='lerato@bekies.test'").id;
  assert.ok(lerato.items.length > 0 && lerato.items.every((o) => dbm.one("SELECT user_id FROM orders WHERE number=?", o.number).user_id === leratoId));
  const admin = (await (await as(...ACCOUNTS.admin)).get("/orders?limit=5")).body;
  assert.ok(admin.total > lerato.total);
});
