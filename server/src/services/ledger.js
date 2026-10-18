import crypto from "node:crypto";
import { all, one, run, tx } from "../db/index.js";
import { toRand } from "../lib/money.js";
import { audit } from "./audit.js";

/**
 * Seller balances derive from the single ledger.
 * - available: delivered sub-orders, no open refund request (disputed), not yet paid out.
 * - pending:   confirmed but not yet delivered (or disputed/held) — not payable.
 */
const SETTLED = `so.status = 'delivered' AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = le.order_id AND r.status IN ('requested','approved'))`;

export function storeBalance(storeId) {
  const sum = (cond) => one(`SELECT COALESCE(SUM(le.amount_cents),0) s FROM ledger_entries le JOIN seller_orders so ON so.id=le.seller_order_id WHERE le.store_id=? AND le.payout_id IS NULL AND ${cond}`, storeId).s;
  const available = sum(SETTLED);
  const pending = sum(`so.status IN ('confirmed','accepted','packing','ready','dispatched','delivered') AND NOT (${SETTLED})`);
  const paid = one("SELECT COALESCE(SUM(amount_cents),0) s FROM payouts WHERE store_id=?", storeId).s;
  const gross = one("SELECT COALESCE(SUM(amount_cents),0) s FROM ledger_entries WHERE store_id=? AND kind='sale'", storeId).s;
  const commission = -one("SELECT COALESCE(SUM(amount_cents),0) s FROM ledger_entries WHERE store_id=? AND kind IN ('commission','refund_commission')", storeId).s;
  return { available: toRand(available), pending: toRand(pending), paid: toRand(paid), gross: toRand(gross), commission: toRand(commission) };
}

export const listPayouts = (storeId) =>
  all(`SELECT p.*, s.name AS store_name FROM payouts p JOIN stores s ON s.id=p.store_id ${storeId ? "WHERE p.store_id=?" : ""} ORDER BY p.id DESC LIMIT 100`, ...(storeId ? [storeId] : []))
    .map((p) => ({ id: p.id, storeId: p.store_id, store: p.store_name, amount: toRand(p.amount_cents), status: p.status, reference: p.reference, createdAt: p.created_at }));

/** Create one payout per store for everything settled. Excludes disputed, refunded, pending and unsettled funds. */
export function runPayouts(req) {
  return tx(() => {
    const created = [];
    for (const { store_id } of all("SELECT DISTINCT store_id FROM ledger_entries WHERE payout_id IS NULL")) {
      const entries = all(`SELECT le.id, le.amount_cents FROM ledger_entries le JOIN seller_orders so ON so.id=le.seller_order_id WHERE le.store_id=? AND le.payout_id IS NULL AND ${SETTLED}`, store_id);
      const amount = entries.reduce((n, e) => n + e.amount_cents, 0);
      if (!entries.length || amount <= 0) continue;
      const ref = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      const r = run("INSERT INTO payouts (store_id, amount_cents, reference, created_by) VALUES (?,?,?,?)", store_id, amount, ref, req.user.id);
      const pid = Number(r.lastInsertRowid);
      for (const e of entries) run("UPDATE ledger_entries SET payout_id=? WHERE id=?", pid, e.id);
      created.push({ id: pid, storeId: store_id, amount: toRand(amount), reference: ref });
    }
    audit(req, "payout.run", "payout", null, { count: created.length });
    return created;
  });
}
