process.env.RESEND_API_KEY = "re_test_key";
process.env.MAIL_FROM = "Bekies <orders@bekies.example>";
import test, { after } from "node:test";
import assert from "node:assert/strict";
const { close, dbm, client } = await import("./helpers.js");
const { processEmails, emailProvider } = await import("../src/services/mailer.js");
after(close);

test("emails are delivered through the Resend API with auth + idempotency, and failures retry", async () => {
  assert.equal(emailProvider(), "resend");
  const realFetch = globalThis.fetch;
  const calls = [];
  let fail = true;
  globalThis.fetch = async (url, opts) => {
    if (!String(url).startsWith("https://api.resend.com")) return realFetch(url, opts);
    calls.push({ url, opts });
    return fail ? new Response('{"message":"rate limited"}', { status: 429 }) : new Response('{"id":"em_1"}', { status: 200 });
  };
  try {
    await client().post("/auth/forgot-password", { email: "lerato@bekies.test" });
    const row = dbm.one("SELECT * FROM emails WHERE to_addr='lerato@bekies.test' ORDER BY id DESC LIMIT 1");
    await processEmails(500);
    let after1 = dbm.one("SELECT status, attempts, last_error FROM emails WHERE id=?", row.id);
    assert.equal(after1.status, "pending", "failed send stays queued");
    assert.equal(after1.attempts, 1);
    assert.match(after1.last_error, /429/);

    fail = false;
    dbm.run("UPDATE emails SET next_attempt_at=datetime('now','-1 minute') WHERE id=?", row.id);
    await processEmails(500);
    assert.equal(dbm.one("SELECT status FROM emails WHERE id=?", row.id).status, "sent");

    const last = calls.at(-1);
    assert.equal(last.opts.headers.Authorization, "Bearer re_test_key");
    assert.equal(last.opts.headers["Idempotency-Key"], `bekies-email-${row.id}`);
    const body = JSON.parse(last.opts.body);
    assert.equal(body.from, "Bekies <orders@bekies.example>");
    assert.deepEqual(body.to, ["lerato@bekies.test"]);
    assert.match(body.subject, /Reset your/);
    assert.ok(body.html.includes("account?reset="));
  } finally { globalThis.fetch = realFetch; }
});
