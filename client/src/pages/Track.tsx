import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, dateOnly, money, niceStatus, when, type Order } from "../api";
import { useAuth } from "../context/Auth";
import { useToast } from "../context/Toast";
import { useFetch, useTitle } from "../hooks";
import Field from "../components/Field";
import Icon from "../components/Icon";
import SmartImage from "../components/SmartImage";

const RANK = ["pending_payment", "confirmed", "accepted", "packing", "ready", "dispatched", "delivered"];
const STEPS: [string, string][] = [["confirmed", "Order confirmed"], ["packing", "Seller is packing your order"], ["ready", "Ready for chilled collection"], ["dispatched", "Out for delivery"], ["delivered", "Delivered"]];

export function TrackLookup() {
  useTitle("Track your order");
  const nav = useNavigate();
  const { user } = useAuth();
  const [number, setNumber] = useState("");
  const [email, setEmail] = useState("");
  const orders = useFetch<{ items: Order[] }>(user ? "/orders?limit=10" : null, [user?.id]);
  return (
    <main className="commerce-main narrow-page">
      <div className="page-intro"><span>Order tracking</span><h1>Where's my order?</h1><p>Enter your order number and the email you used at checkout.</p></div>
      <form className="lookup-card" onSubmit={(e) => { e.preventDefault(); nav(`/track/${number.trim().toUpperCase()}?email=${encodeURIComponent(email.trim())}`); }}>
        <div className="form-grid">
          <Field label="Order number" onChange={setNumber} placeholder="BK-10483" required value={number} />
          <Field label="Email" onChange={setEmail} placeholder="you@example.co.za" required type="email" value={email} />
        </div>
        <button className="auth-submit" type="submit">Track order <Icon name="arrow" /></button>
      </form>
      {user && orders.data && orders.data.items.length > 0 && (
        <section className="lookup-card"><h2>Your recent orders</h2>
          {orders.data.items.map((o) => <Link className="recent-order" key={o.number} to={`/track/${o.number}`}><strong>{o.number}</strong><span>{when(o.createdAt)}</span><span>{money(o.total)}</span><em className={`pill ${o.status}`}>{niceStatus(o.status)}</em></Link>)}
        </section>
      )}
    </main>
  );
}

export default function Track() {
  const { number } = useParams();
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<{ order: Order }>(`/orders/${number}${email ? `?email=${encodeURIComponent(email)}` : ""}`, [user?.id]);
  const [busy, setBusy] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [showRefund, setShowRefund] = useState(false);
  useTitle(`Order ${number}`);

  if (loading && !data) return <main className="commerce-main tracking-page"><div className="skeleton-card tall" /></main>;
  if (error || !data) {
    return (
      <main className="commerce-main tracking-page">
        <div className="commerce-empty"><strong>We couldn't find that order</strong><p>Check the order number{!user && " and the email you used at checkout"}, or sign in to your account.</p><button onClick={() => nav("/track")} type="button">Try again</button></div>
      </main>
    );
  }
  const o = data.order;
  const rank = RANK.indexOf(o.status);
  const cancelled = o.status === "cancelled" || o.status === "refunded";
  const eta = o.estimatedDelivery ? dateOnly(o.estimatedDelivery) : "soon";
  const heading = cancelled ? niceStatus(o.status) : o.status === "pending_payment" ? "Awaiting payment" : o.status === "delivered" ? "Delivered" : o.status === "dispatched" ? "Out for delivery" : `Arriving ${eta.split(",")[0]}`;
  const canCancel = !!user && o.status !== "cancelled" && ["pending_payment", "confirmed"].includes(o.status);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast(ok); await reload(); } catch (e) { toast(e instanceof ApiError ? e.message : "Something went wrong"); } finally { setBusy(false); }
  };

  return (
    <main className="commerce-main tracking-page">
      <button className="back-link" onClick={() => nav(user ? "/portal/orders" : "/track")} type="button"><Icon name="back" /> {user ? "My orders" : "Track another order"}</button>
      <div className="tracking-head"><span>ORDER {o.number}</span><h1>{heading}</h1><p>Placed {when(o.createdAt)} · {o.sellers.length} seller{o.sellers.length > 1 ? "s" : ""} · {money(o.total)}</p></div>
      <div className="tracking-layout">
        <section className="tracking-card">
          {o.status === "pending_payment" && (
            <div className="track-banner warn"><strong>Payment not completed</strong><span>Your items are reserved for 30 minutes.</span>
              <button disabled={busy} onClick={() => act(() => api.post("/payments/demo/pay", { orderNumber: o.number, email, outcome: "success" }), "Payment confirmed")} type="button">Pay {money(o.total)} now (demo)</button></div>
          )}
          {cancelled && <div className="track-banner bad"><strong>This order is {o.status}.</strong><span>{o.status === "cancelled" && o.paymentStatus !== "initiated" ? "Any payment taken will be refunded to you." : "No payment was taken."}</span></div>}
          {!cancelled && (
            <div className="tracking-timeline">
              {STEPS.map(([key, title]) => {
                const done = rank >= RANK.indexOf(key);
                const ev = o.timeline.filter((t) => t.status === key || (key === "packing" && t.status === "accepted")).slice(-1)[0];
                return <div className={done ? "done" : ""} key={key}><i>{done ? "✓" : ""}</i><p><strong>{title}</strong><span>{done && ev ? when(ev.at) : `Expected ${eta.split(",")[0]}`}</span></p></div>;
              })}
            </div>
          )}
          {o.sellers.length > 1 && (
            <div className="seller-split"><strong>Sellers fulfilling this order</strong>{o.sellers.map((s) => <p key={s.storeId}><span>{s.name}</span><em className={`pill ${s.status}`}>{niceStatus(s.status)}</em></p>)}</div>
          )}
        </section>
        <aside className="tracking-order">
          <h2>Order details</h2>
          {o.items.map((i) => <div key={i.id}><SmartImage alt="" src={i.image ?? undefined} /><p><strong>{i.name}</strong><span>Qty {i.qty} · {money(i.lineTotal)}</span></p></div>)}
          <hr />
          <p className="totals-line"><span>Subtotal</span><strong>{money(o.subtotal)}</strong></p>
          <p className="totals-line"><span>Delivery</span><strong>{o.delivery ? money(o.delivery) : "Free"}</strong></p>
          {o.discount > 0 && <p className="totals-line"><span>Discount</span><strong>−{money(o.discount)}</strong></p>}
          <p className="totals-line total"><span>Total</span><strong>{money(o.total)}</strong></p>
          <p><span>Delivery address</span><strong>{o.address.street}<br />{o.address.suburb}, {o.address.city} {o.address.postalCode}</strong></p>
          <p><span>Payment</span><strong>{niceStatus(o.paymentStatus)}</strong></p>
          {canCancel && <button className="danger" disabled={busy} onClick={() => confirm("Cancel this order?") && act(() => api.post(`/orders/${o.number}/transitions`, { to: "cancelled" }), "Order cancelled")} type="button">Cancel order</button>}
          {user && o.status === "delivered" && !showRefund && <button onClick={() => setShowRefund(true)} type="button">Request a refund</button>}
          {showRefund && (
            <form className="refund-form" onSubmit={(e) => { e.preventDefault(); act(() => api.post(`/orders/${o.number}/refunds`, { reason: refundReason }), "Refund requested — we'll be in touch"); setShowRefund(false); }}>
              <textarea minLength={3} onChange={(e) => setRefundReason(e.target.value)} placeholder="What went wrong?" required rows={3} value={refundReason} />
              <button disabled={busy} type="submit">Submit request</button>
            </form>
          )}
          <Link className="support-link" to={`/contact?order=${o.number}`}>Contact support</Link>
        </aside>
      </div>
    </main>
  );
}
