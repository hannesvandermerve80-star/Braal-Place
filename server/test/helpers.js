process.env.NODE_ENV = "test";
process.env.DATABASE_FILE = ":memory:";
process.env.UPLOAD_DIR = "uploads-test";
process.env.DEMO_MODE = "true";
process.env.PAYMENT_WEBHOOK_SECRET = "test-webhook-secret";

const { createApp } = await import("../src/app.js");
const { seedIfEmpty } = await import("../src/db/seed.js");
const { signPayload } = await import("../src/services/payments.js");
const { processOutbox } = await import("../src/services/outbox.js");
export const dbm = await import("../src/db/index.js");
export { signPayload, processOutbox };

seedIfEmpty();
const server = createApp().listen(0);
export const base = `http://127.0.0.1:${server.address().port}/api`;
export const close = () => server.close();

/** Minimal cookie-jar client: one instance == one browser session. */
export function client() {
  const jar = new Map();
  const call = async (method, url, body, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers["content-type"] = "application/json"; payload = opts.raw ?? JSON.stringify(body); }
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(base + url, { method, headers, body: payload });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (!v || /Expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(k); else jar.set(k, v);
    }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  };
  return {
    get: (u) => call("GET", u), post: (u, b = {}, o) => call("POST", u, b, o), put: (u, b = {}) => call("PUT", u, b),
    patch: (u, b = {}) => call("PATCH", u, b), del: (u) => call("DELETE", u),
    login: async (email, password) => { const r = await call("POST", "/auth/login", { email, password }); if (r.status !== 200) throw new Error(`login failed ${r.status}`); return r.body.user; },
  };
}
export const as = async (email, password) => { const c = client(); await c.login(email, password); return c; };
export const ACCOUNTS = {
  admin: ["admin@bekies.test", "Admin123!"], manager: ["manager@bekies.test", "Manager123!"],
  seller: ["seller@bekies.test", "Seller123!"], lerato: ["lerato@bekies.test", "Buyer123!"], sipho: ["sipho@bekies.test", "Buyer123!"],
};
export const contact = { firstName: "Test", lastName: "Buyer", email: "guest@example.co.za", mobile: "+27 82 000 0000" };
export const address = { street: "1 Test Street", suburb: "Sandton", city: "Johannesburg", postalCode: "2196" };

export async function placeOrder(c, items, extra = {}) {
  for (const [productId, qty] of items) { const r = await c.post("/cart/items", { productId, qty }); if (r.status >= 400) return r; }
  return c.post("/checkout/orders", { contact, address, ...extra });
}
export const webhook = async (c, event, { sign = true, signature } = {}) => {
  const raw = JSON.stringify(event);
  return c.post("/payments/webhooks/demo", event, { raw, headers: { "x-signature": signature ?? (sign ? signPayload(raw) : "") } });
};
export const productId = (slug) => dbm.one("SELECT id FROM products WHERE slug=?", slug).id;
