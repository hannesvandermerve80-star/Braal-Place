import { Router } from "express";
import { all, one } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { hasPermission } from "../lib/permissions.js";
import { toRand } from "../lib/money.js";
import { storeBalance } from "../services/ledger.js";
import { wrap } from "../lib/httpError.js";

const router = Router();
router.use(requireAuth);

const rand = (c) => `R${Math.round(c / 100).toLocaleString("en-ZA")}`;
const compact = (c) => {
  const r = c / 100;
  return r >= 1_000_000 ? `R${(r / 1_000_000).toFixed(2)}m` : r >= 100_000 ? `R${Math.round(r / 1000)}k` : `R${Math.round(r).toLocaleString("en-ZA")}`;
};

/** 12 weekly buckets (oldest → newest) of a money query. `sql` must select (wk, v) where wk = weeks ago (0 = this week). */
function weekly(sql, ...params) {
  const buckets = Array(12).fill(0);
  for (const r of all(sql, ...params)) if (r.wk >= 0 && r.wk < 12) buckets[11 - r.wk] = r.v;
  return buckets;
}
const WEEKS = "CAST((julianday('now') - julianday(o.created_at)) / 7 AS INTEGER)";

router.get("/overview", wrap((req, res) => {
  const u = req.user;
  let stats = [], trend = [], trendTotal = 0, trendLabel = "Performance trend", tasks = [];

  if (u.role === "admin" || (u.role === "manager" && hasPermission(u, "payments.view"))) {
    const gmv = one("SELECT COALESCE(SUM(amount_cents - refunded_cents),0) s FROM payments WHERE status IN ('confirmed','partially_refunded','refunded')").s;
    const rev = -one("SELECT COALESCE(SUM(amount_cents),0) s FROM ledger_entries WHERE kind IN ('commission','refund_commission')").s;
    const orders = one("SELECT COUNT(*) c FROM orders").c;
    const fulfil = one("SELECT COUNT(*) c FROM orders WHERE status IN ('confirmed','accepted','packing','ready')").c;
    const pend = one("SELECT COUNT(*) c FROM seller_applications WHERE status IN ('submitted','under_review')").c;
    const attn = one("SELECT COUNT(*) c FROM seller_applications WHERE status IN ('submitted','under_review') AND (escalated=1 OR needs_documents=1 OR risk!='Low')").c;
    stats = [
      { label: "Gross merchandise value", value: compact(gmv), note: "Confirmed payments, net of refunds", tone: "green" },
      { label: "Marketplace revenue", value: compact(rev), note: `${gmv ? ((rev / gmv) * 100).toFixed(0) : 0}% blended commission`, tone: "orange" },
      { label: "Orders", value: orders.toLocaleString("en-ZA"), note: `${fulfil} awaiting fulfilment`, tone: "blue" },
      { label: "Pending sellers", value: String(pend), note: `${attn} require attention`, tone: "red" },
    ];
    trend = weekly(`SELECT ${WEEKS} AS wk, SUM(o.total_cents)/100 AS v FROM orders o WHERE o.payment_status IN ('confirmed','partially_refunded','refunded') GROUP BY wk`);
    trendTotal = gmv;
  } else if (u.role === "manager") {
    const queue = one("SELECT COUNT(*) c FROM seller_applications WHERE status IN ('submitted','under_review')").c;
    const due = one("SELECT COUNT(*) c FROM seller_applications WHERE status IN ('submitted','under_review') AND submitted_at <= datetime('now','-1 day')").c;
    const reviewed = one("SELECT COUNT(*) c FROM application_history WHERE actor_id=? AND to_status IN ('approved','rejected') AND created_at >= datetime('now','-7 days')", u.id).c;
    const docs = one("SELECT COUNT(*) c FROM seller_applications WHERE needs_documents=1").c;
    const esc = one("SELECT COUNT(*) c FROM seller_applications WHERE escalated=1").c;
    stats = [
      { label: "Applications in queue", value: String(queue), note: `${due} waiting over 24h`, tone: "orange" },
      { label: "Reviewed this week", value: String(reviewed), note: "Approvals and rejections by you", tone: "green" },
      { label: "Awaiting documents", value: String(docs), note: "Seller follow-up needed", tone: "blue" },
      { label: "Escalations", value: String(esc), note: esc ? "Needs a decision" : "All clear", tone: "red" },
    ];
    trend = weekly(`SELECT ${WEEKS} AS wk, COUNT(*) AS v FROM orders o GROUP BY wk`);
    trendTotal = null; trendLabel = "Marketplace orders per week";
  } else if (u.role === "seller") {
    const m = one("SELECT store_id FROM store_members WHERE user_id=?", u.id);
    if (m) {
      const sid = m.store_id;
      const sales = one("SELECT COALESCE(SUM(subtotal_cents),0) s FROM seller_orders WHERE store_id=? AND status NOT IN ('pending_payment','cancelled') AND updated_at >= datetime('now','-30 days')", sid).s;
      const pending = one("SELECT COUNT(*) c FROM seller_orders WHERE store_id=? AND status IN ('confirmed','accepted','packing','ready')", sid).c;
      const toDispatch = one("SELECT COUNT(*) c FROM seller_orders WHERE store_id=? AND status IN ('ready','packing')", sid).c;
      const net = one("SELECT COALESCE(SUM(amount_cents),0) s FROM ledger_entries WHERE store_id=?", sid).s;
      const low = all(`SELECT i.stock - i.reserved AS avail, i.low_stock_threshold t FROM inventory i JOIN products p ON p.id=i.product_id WHERE p.store_id=? AND p.status='published' AND i.stock - i.reserved <= i.low_stock_threshold`, sid);
      stats = [
        { label: "Sales (30 days)", value: rand(sales), note: "Gross, before platform fees", tone: "green" },
        { label: "Pending orders", value: String(pending), note: `${toDispatch} to pack or dispatch`, tone: "orange" },
        { label: "Net earnings", value: rand(net), note: "After platform commission", tone: "blue" },
        { label: "Low stock", value: String(low.length), note: `${low.filter((l) => l.avail <= Math.floor(l.t / 2)).length} critical products`, tone: "red" },
      ];
      trend = weekly(`SELECT ${WEEKS} AS wk, SUM(so.subtotal_cents)/100 AS v FROM seller_orders so JOIN orders o ON o.id=so.order_id WHERE so.store_id=? AND so.status NOT IN ('pending_payment','cancelled') GROUP BY wk`, sid);
      trendTotal = one("SELECT COALESCE(SUM(subtotal_cents),0) s FROM seller_orders WHERE store_id=? AND status NOT IN ('pending_payment','cancelled')", sid).s;
      trendLabel = "Sales trend";
      const b = storeBalance(sid);
      if (pending) tasks.push({ title: `Fulfil ${pending} open order${pending > 1 ? "s" : ""}`, link: "/portal/orders" });
      if (low.length) tasks.push({ title: `Restock ${low.length} low-stock product${low.length > 1 ? "s" : ""}`, link: "/portal/inventory" });
      if (b.available > 0) tasks.push({ title: `R${b.available.toLocaleString("en-ZA")} available for the next payout`, link: "/portal/payouts" });
    } else {
      const app = one("SELECT status FROM seller_applications WHERE user_id=? ORDER BY id DESC", u.id);
      stats = [{ label: "Application", value: app ? app.status.replace("_", " ") : "none", note: "Store unlocks once approved", tone: "orange" }];
      tasks.push({ title: "Complete your seller application", link: "/sell" });
    }
  } else {
    const active = one("SELECT COUNT(*) c FROM orders WHERE user_id=? AND status NOT IN ('delivered','cancelled','refunded')", u.id).c;
    const out = one("SELECT COUNT(*) c FROM orders WHERE user_id=? AND status='dispatched'", u.id).c;
    const wish = one("SELECT COUNT(*) c FROM wishlist WHERE user_id=?", u.id).c;
    const onSale = one("SELECT COUNT(*) c FROM wishlist w JOIN products p ON p.id=w.product_id WHERE w.user_id=? AND p.old_price_cents > p.price_cents", u.id).c;
    const tickets = one("SELECT COUNT(*) c FROM support_tickets WHERE user_id=? AND status!='closed'", u.id).c;
    const replied = one("SELECT COUNT(*) c FROM support_tickets WHERE user_id=? AND status='replied'", u.id).c;
    const pts = one("SELECT rewards_points p FROM users WHERE id=?", u.id).p;
    stats = [
      { label: "Active orders", value: String(active), note: `${out} out for delivery`, tone: "green" },
      { label: "Bekies rewards", value: pts.toLocaleString("en-ZA"), note: `R${(pts / 20).toFixed(0)} available`, tone: "orange" },
      { label: "Wishlist", value: String(wish), note: `${onSale} on special`, tone: "blue" },
      { label: "Support requests", value: String(tickets), note: replied ? "Reply received" : "No new replies", tone: "neutral" },
    ];
    trend = weekly(`SELECT ${WEEKS} AS wk, SUM(o.total_cents)/100 AS v FROM orders o WHERE o.user_id=? AND o.payment_status IN ('confirmed','partially_refunded','refunded') GROUP BY wk`, u.id);
    trendTotal = one("SELECT COALESCE(SUM(total_cents),0) s FROM orders WHERE user_id=? AND payment_status IN ('confirmed','partially_refunded')", u.id).s;
    trendLabel = "Order activity";
    for (const o of all("SELECT number, status FROM orders WHERE user_id=? AND status NOT IN ('delivered','cancelled','refunded') ORDER BY id DESC LIMIT 3", u.id)) tasks.push({ title: `Order ${o.number} is ${o.status.replace(/_/g, " ")}`, link: `/track/${o.number}` });
  }

  if (u.role === "admin" || u.role === "manager") {
    if (hasPermission(u, "seller.review")) {
      for (const a of all("SELECT id, business_name FROM seller_applications WHERE status IN ('submitted','under_review') ORDER BY escalated DESC, submitted_at LIMIT 2")) tasks.push({ title: `Review ${a.business_name || "application"}`, link: "/portal/applications" });
    }
    if (hasPermission(u, "refund.approve")) {
      const r = one("SELECT COUNT(*) c FROM refunds WHERE status='requested'").c;
      if (r) tasks.push({ title: `${r} refund request${r > 1 ? "s" : ""} awaiting approval`, link: "/portal/payments" });
    }
    if (hasPermission(u, "product.moderate")) {
      const p = one("SELECT COUNT(*) c FROM products WHERE status='submitted'").c;
      if (p) tasks.push({ title: `${p} product${p > 1 ? "s" : ""} awaiting moderation`, link: "/portal/moderation" });
    }
    if (hasPermission(u, "support.manage")) {
      const t = one("SELECT COUNT(*) c FROM support_tickets WHERE status='open'").c;
      if (t) tasks.push({ title: `${t} open support request${t > 1 ? "s" : ""}`, link: "/portal/support" });
    }
  }

  res.json({ stats, trend, trendTotal: trendTotal == null ? null : toRand(trendTotal), trendLabel, tasks: tasks.slice(0, 4) });
}));

export default router;
