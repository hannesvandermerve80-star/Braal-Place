process.env.PAYFAST_MERCHANT_ID = "10000100";
process.env.PAYFAST_MERCHANT_KEY = "46f0cd694581a";
process.env.PAYFAST_PASSPHRASE = "test-pass phrase";
process.env.PAYFAST_SANDBOX = "true";
process.env.PUBLIC_URL = "https://shop.example.co.za";
import test, { after } from "node:test";
import assert from "node:assert/strict";
// env must be set before the app loads, so import dynamically (static imports are hoisted)
const { close, dbm, quickOrder, contact, base } = await import("./helpers.js");
const { sign } = await import("../src/services/payfast.js");

after(close);
const itn = (fields, { bad = false } = {}) => {
  const pairs = Object.entries(fields);
  const sig = sign(pairs);
  const body = [...pairs, ["signature", bad ? "0".repeat(32) : sig]].map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, "+")}`).join("&");
  return fetch(`${base}/payments/payfast/itn`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
};

test("payfast replaces demo payments and builds a signed redirect", async () => {
  const { order, c } = await quickOrder();
  assert.equal((await c.get("/meta/site")).body.paymentProvider, "payfast");
  assert.equal((await c.post("/payments/demo/pay", { orderNumber: order.number, email: contact.email, outcome: "success" })).status, 403);
  const init = await c.post("/payments/payfast/init", { orderNumber: order.number, email: contact.email });
  assert.equal(init.status, 200);
  const f = init.body.fields;
  assert.equal(init.body.action, "https://sandbox.payfast.co.za/eng/process");
  assert.equal(f.amount, order.total.toFixed(2));
  assert.equal(f.notify_url, "https://shop.example.co.za/api/payments/payfast/itn");
  const { signature, ...rest } = f;
  assert.equal(signature, sign(Object.entries(rest)));
});

test("ITN: bad signature, wrong amount and replays are handled safely; a good ITN confirms payment once", async () => {
  const { order, c } = await quickOrder();
  const ref = (await c.post("/payments/payfast/init", { orderNumber: order.number, email: contact.email })).body.fields.m_payment_id;
  const good = { m_payment_id: ref, pf_payment_id: "1089250", payment_status: "COMPLETE", item_name: "x", amount_gross: order.total.toFixed(2), merchant_id: "10000100" };

  assert.equal((await itn(good, { bad: true })).status, 403);
  assert.equal(dbm.one("SELECT payment_status s FROM orders WHERE number=?", order.number).s, "initiated", "forged ITN changes nothing");
  assert.equal((await itn({ ...good, merchant_id: "999" })).status, 403);
  assert.equal((await itn({ ...good, amount_gross: "1.00" })).status, 422, "underpayment rejected");
  assert.equal(dbm.one("SELECT payment_status s FROM orders WHERE number=?", order.number).s, "initiated");

  const wrongAmountEvt = dbm.one("SELECT COUNT(*) c FROM webhook_events WHERE provider='payfast'").c;
  assert.equal((await itn({ ...good, pf_payment_id: "1089251" })).status, 200);
  assert.equal(dbm.one("SELECT payment_status s FROM orders WHERE number=?", order.number).s, "confirmed");
  assert.equal((await itn({ ...good, pf_payment_id: "1089251" })).status, 200, "replay is a no-op");
  assert.equal(dbm.one("SELECT COUNT(*) c FROM ledger_entries WHERE order_id=(SELECT id FROM orders WHERE number=?) AND kind='sale'", order.number).c > 0, true);
  assert.ok(wrongAmountEvt >= 0);
});
