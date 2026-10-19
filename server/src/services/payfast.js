import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * PayFast (South African hosted payment gateway) adapter.
 *  - init: build the signed redirect form for the hosted payment page
 *  - ITN: verify the signed server-to-server notification (signature, merchant, amount, optional PayFast postback)
 * A browser redirect back to our site NEVER confirms payment — only a verified ITN does.
 */
const phpEncode = (v) => encodeURIComponent(String(v)).replace(/%20/g, "+").replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const phpDecode = (v) => decodeURIComponent(String(v).replace(/\+/g, " "));

export const payfastHost = () => (config.payfast?.sandbox ? "sandbox.payfast.co.za" : "www.payfast.co.za");
export const payfastActionUrl = () => `https://${payfastHost()}/eng/process`;

export function sign(pairs, passphrase = config.payfast?.passphrase) {
  let str = pairs.filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k}=${phpEncode(v)}`).join("&");
  if (passphrase) str += `&passphrase=${phpEncode(passphrase)}`;
  return crypto.createHash("md5").update(str).digest("hex");
}

export function buildCheckout({ order, payment, contact }) {
  const pf = config.payfast;
  const pairs = [
    ["merchant_id", pf.merchantId],
    ["merchant_key", pf.merchantKey],
    ["return_url", `${config.publicUrl}/checkout/return/${order.number}`],
    ["cancel_url", `${config.publicUrl}/checkout/return/${order.number}?cancelled=1`],
    ["notify_url", `${config.publicUrl}/api/payments/payfast/itn`],
    ["name_first", contact.firstName],
    ["name_last", contact.lastName],
    ["email_address", contact.email],
    ["m_payment_id", payment.provider_ref],
    ["amount", (payment.amount_cents / 100).toFixed(2)],
    ["item_name", `Bekies Braai Place order ${order.number}`.slice(0, 100)],
  ].filter(([, v]) => v !== "" && v != null);
  return { action: payfastActionUrl(), fields: Object.fromEntries([...pairs, ["signature", sign(pairs)]]) };
}

/** Parse the raw ITN body keeping PayFast's field order. */
export function parseItn(raw) {
  return String(raw ?? "").split("&").filter(Boolean).map((kv) => { const i = kv.indexOf("="); return [phpDecode(kv.slice(0, i)), phpDecode(kv.slice(i + 1))]; });
}

export function verifyItnSignature(pairs) {
  const given = pairs.find(([k]) => k === "signature")?.[1];
  if (!given) return false;
  const expected = Buffer.from(sign(pairs.filter(([k]) => k !== "signature")));
  const got = Buffer.from(String(given));
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

/** Ask PayFast to confirm it sent this notification (skipped in tests). */
export async function postbackValid(pairs) {
  const body = pairs.filter(([k]) => k !== "signature").map(([k, v]) => `${k}=${phpEncode(v)}`).join("&");
  const res = await fetch(`https://${payfastHost()}/eng/query/validate`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(8000) });
  return (await res.text()).trim() === "VALID";
}
