import { unprocessable } from "./httpError.js";

/**
 * Status transitions are validated by backend state machines rather than arbitrary string updates.
 */
export const ORDER_STATUSES = ["pending_payment", "confirmed", "accepted", "packing", "ready", "dispatched", "delivered", "cancelled", "refunded"];

// Fulfilment path per seller sub-order
export const ORDER_TRANSITIONS = {
  pending_payment: ["confirmed", "cancelled"],
  confirmed: ["accepted", "cancelled"],
  accepted: ["packing", "cancelled"],
  packing: ["ready", "cancelled"],
  ready: ["dispatched", "cancelled"],
  dispatched: ["delivered"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export const APPLICATION_TRANSITIONS = {
  draft: ["submitted"],
  submitted: ["under_review", "rejected", "approved"],
  under_review: ["approved", "rejected", "submitted"],
  approved: ["suspended"],
  rejected: ["draft", "submitted"],
  suspended: ["approved"],
};

export const PRODUCT_TRANSITIONS = {
  draft: ["submitted", "archived"],
  submitted: ["approved", "changes_requested"],
  changes_requested: ["submitted", "archived"],
  approved: ["published", "archived"],
  published: ["archived", "submitted"],
  archived: ["draft"],
};

export const PAYMENT_TRANSITIONS = {
  initiated: ["pending", "confirmed", "failed"],
  pending: ["confirmed", "failed"],
  confirmed: ["partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  failed: [],
  refunded: [],
};

export function assertTransition(machine, from, to, label = "status") {
  const allowed = machine[from];
  if (!allowed) throw unprocessable(`Unknown ${label} "${from}"`);
  if (!allowed.includes(to)) {
    throw unprocessable(`Invalid ${label} transition: ${from} → ${to}`, { from, to, allowed });
  }
}

/** Order-level status rolled up from seller sub-orders (least advanced active sub-order wins). */
export function rollupOrderStatus(subStatuses, paymentConfirmed = true) {
  if (!subStatuses.length) return "pending_payment";
  if (subStatuses.every((s) => s === "cancelled")) return "cancelled";
  if (subStatuses.every((s) => s === "refunded" || s === "cancelled") && subStatuses.some((s) => s === "refunded")) return "refunded";
  const active = subStatuses.filter((s) => s !== "cancelled");
  const rank = ORDER_STATUSES;
  return active.reduce((min, s) => (rank.indexOf(s) < rank.indexOf(min) ? s : min), active[0]);
}
