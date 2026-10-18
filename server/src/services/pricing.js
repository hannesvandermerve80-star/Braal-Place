import { config } from "../config.js";
import { one } from "../db/index.js";
import { toRand, vatPortion } from "../lib/money.js";

export function evaluatePromo(code, subtotalCents) {
  if (!code) return { code: null, valid: false, message: null, discountCents: 0, freeDelivery: false };
  const promo = one("SELECT * FROM promo_codes WHERE code = ? AND active = 1", String(code).trim().toUpperCase());
  if (!promo) return { code: String(code).toUpperCase(), valid: false, message: "That promo code is not valid.", discountCents: 0, freeDelivery: false };
  if (subtotalCents < promo.min_subtotal_cents) {
    return { code: promo.code, valid: false, message: `Spend at least R${promo.min_subtotal_cents / 100} to use ${promo.code}.`, discountCents: 0, freeDelivery: false };
  }
  let discountCents = 0;
  if (promo.kind === "percent") discountCents = Math.floor((subtotalCents * promo.value) / 100);
  if (promo.kind === "fixed") discountCents = Math.min(promo.value, subtotalCents);
  return { code: promo.code, valid: true, message: promo.description, discountCents, freeDelivery: promo.kind === "free_delivery" };
}

/** Single source of truth for totals — always recomputed on the server. */
export function computeTotals(subtotalCents, promoCode) {
  const promo = evaluatePromo(promoCode, subtotalCents);
  const freeShip = subtotalCents >= config.commerce.freeDeliveryThresholdCents || promo.freeDelivery;
  const deliveryCents = subtotalCents === 0 || freeShip ? 0 : config.commerce.deliveryFeeCents;
  const totalCents = Math.max(0, subtotalCents - promo.discountCents + deliveryCents);
  return {
    subtotalCents, deliveryCents, discountCents: promo.discountCents, totalCents,
    vatCents: vatPortion(totalCents, config.commerce.vatRate),
    promo,
    freeDeliveryThreshold: toRand(config.commerce.freeDeliveryThresholdCents),
    amountToFreeDelivery: freeShip ? 0 : toRand(config.commerce.freeDeliveryThresholdCents - subtotalCents),
  };
}

export const serializeTotals = (t) => ({
  subtotal: toRand(t.subtotalCents),
  delivery: toRand(t.deliveryCents),
  discount: toRand(t.discountCents),
  total: toRand(t.totalCents),
  vat: toRand(t.vatCents),
  promo: t.promo.code ? { code: t.promo.code, valid: t.promo.valid, message: t.promo.message } : null,
  freeDeliveryThreshold: t.freeDeliveryThreshold,
  amountToFreeDelivery: t.amountToFreeDelivery,
});
