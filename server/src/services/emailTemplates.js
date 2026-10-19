import { config } from "../config.js";
import { layout, p, queueEmail } from "./mailer.js";

const rand = (cents) => `R${(cents / 100).toFixed(2)}`;
const url = (path) => `${config.publicUrl}${path}`;
const first = (name) => (name ? String(name).split(" ")[0] : "there");

export function sendPasswordReset(user, token) {
  const link = url(`/account?reset=${encodeURIComponent(token)}`);
  queueEmail({
    to: user.email,
    subject: "Reset your Bekies Braai Place password",
    text: `Hi ${first(user.first_name)},\n\nUse this link to choose a new password (valid for 60 minutes):\n${link}\n\nIf you didn't ask for this, you can ignore this email — your password won't change.`,
    html: layout("Reset your password", p(`Hi ${first(user.first_name)}, use the button below to choose a new password. The link works once and expires in 60 minutes.`) + p("If you didn't ask for this, you can safely ignore this email."), { label: "Choose a new password", url: link }),
  });
}

export function sendVerifyEmail(user, token) {
  const link = url(`/account?verify=${encodeURIComponent(token)}`);
  queueEmail({
    to: user.email,
    subject: "Confirm your email — Bekies Braai Place",
    text: `Welcome to Bekies Braai Place, ${first(user.first_name)}!\n\nConfirm your email address:\n${link}`,
    html: layout(`Welcome, ${first(user.first_name)}!`, p("Please confirm your email address so we can send you order updates and receipts."), { label: "Confirm my email", url: link }),
  });
}

export function sendOrderPaid(order, items, contact, address) {
  const lines = items.map((i) => `${i.qty} × ${i.name} — ${rand(i.line_total_cents)}`);
  const link = url(`/track/${order.number}`);
  queueEmail({
    key: `order-paid:${order.id}`,
    to: contact.email,
    subject: `Order ${order.number} confirmed — thank you!`,
    text: `Hi ${first(contact.firstName)},\n\nWe've received your payment for order ${order.number}.\n\n${lines.join("\n")}\n\nDelivery: ${rand(order.delivery_cents)}\nDiscount: -${rand(order.discount_cents)}\nTotal paid: ${rand(order.total_cents)} (incl. VAT ${rand(order.vat_cents)})\n\nDelivering to: ${[address.line1, address.suburb, address.city].filter(Boolean).join(", ")}\nTrack your order: ${link}`,
    html: layout("Thank you — order confirmed", p(`Hi ${first(contact.firstName)}, we've received your payment for order ${order.number}.`) +
      `<table width="100%" cellpadding="6" style="font-size:14px;border-collapse:collapse">${items.map((i) => `<tr style="border-bottom:1px solid #eee"><td>${i.qty} × ${i.name.replace(/</g, "&lt;")}</td><td align="right">${rand(i.line_total_cents)}</td></tr>`).join("")}
      <tr><td>Delivery</td><td align="right">${rand(order.delivery_cents)}</td></tr>
      ${order.discount_cents ? `<tr><td>Discount</td><td align="right">-${rand(order.discount_cents)}</td></tr>` : ""}
      <tr><td><b>Total paid</b> (incl. VAT ${rand(order.vat_cents)})</td><td align="right"><b>${rand(order.total_cents)}</b></td></tr></table>`, { label: "Track my order", url: link }),
  });
}

const STATUS_COPY = {
  dispatched: ["Your order is on its way", "Your order has been dispatched and is heading to you, chilled."],
  delivered: ["Your order was delivered", "Your order has been delivered. Enjoy your braai!"],
  cancelled: ["Your order was cancelled", "Your order has been cancelled. If you paid, a refund will follow."],
};
export function sendOrderStatus(order, status, contact) {
  const copy = STATUS_COPY[status];
  if (!copy || !contact?.email) return;
  const link = url(`/track/${order.number}`);
  queueEmail({
    key: `order-status:${order.id}:${status}`,
    to: contact.email,
    subject: `Order ${order.number}: ${copy[0].toLowerCase()}`,
    text: `Hi ${first(contact.firstName)},\n\n${copy[1]}\n\nTrack: ${link}`,
    html: layout(copy[0], p(copy[1]), { label: "View order", url: link }),
  });
}

export function sendRefund(order, amountCents, contact) {
  if (!contact?.email) return;
  queueEmail({
    key: `refund:${order.id}:${amountCents}:${order.updated_at}`,
    to: contact.email,
    subject: `Refund processed for order ${order.number}`,
    text: `Hi ${first(contact.firstName)},\n\nWe've refunded ${rand(amountCents)} for order ${order.number}. It should reach you within 3–5 working days.`,
    html: layout("Your refund is on its way", p(`We've refunded ${rand(amountCents)} for order ${order.number}. It should reach you within 3–5 working days.`)),
  });
}

export function sendSellerDecision(user, approved, note) {
  queueEmail({
    to: user.email,
    subject: approved ? "Your Bekies seller application was approved 🎉" : "Update on your Bekies seller application",
    text: approved ? `Hi ${first(user.first_name)}, your store is approved and live. Sign in to add products: ${url("/portal/products")}` : `Hi ${first(user.first_name)},\n\n${note || "Your application was not approved."}\n\nYou can review it here: ${url("/sell")}`,
    html: layout(approved ? "You're approved!" : "Application update", p(approved ? "Your store is approved. Sign in to add your first products — they're published after a quick review." : note || "Your application was not approved at this time."), { label: approved ? "Open seller portal" : "View application", url: url(approved ? "/portal/products" : "/sell") }),
  });
}
