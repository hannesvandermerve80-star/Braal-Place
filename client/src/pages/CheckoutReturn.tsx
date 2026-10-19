import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type Order } from "../api";
import { useAuth } from "../context/Auth";
import { useCart } from "../context/Cart";
import { useTitle } from "../hooks";
import Icon from "../components/Icon";

/**
 * Where the payment gateway sends the shopper back to. This page never marks anything paid:
 * it only *reads* the order, which the gateway's verified server notification updates.
 */
export default function CheckoutReturn() {
  useTitle("Payment status");
  const { number } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { reload } = useCart();
  const email = (() => { try { return sessionStorage.getItem("bekies_guest_email") ?? ""; } catch { return ""; } })();
  const [order, setOrder] = useState<Order | null>(null);
  const [waited, setWaited] = useState(0);
  const cancelled = params.get("cancelled") === "1";
  const tries = useRef(0);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await api.get<{ order: Order }>(`/orders/${number}${!user && email ? `?email=${encodeURIComponent(email)}` : ""}`);
        if (stop) return;
        setOrder(r.order);
        if (r.order.paymentStatus === "confirmed") { reload(); return; }
      } catch { /* order not visible (e.g. guest without email) */ }
      tries.current += 1; setWaited(tries.current);
      if (!stop && !cancelled && tries.current < 20) setTimeout(poll, 2000);
    };
    poll();
    return () => { stop = true; };
  }, [number, user, email, cancelled, reload]);

  const paid = order?.paymentStatus === "confirmed";
  const track = `/track/${number}${!user && email ? `?email=${encodeURIComponent(email)}` : ""}`;

  return (
    <main className="commerce-main checkout-page">
      <div className="order-success">
        {paid ? (
          <>
            <span><Icon name="check" size={34} /></span><small>PAYMENT RECEIVED</small>
            <h1>Thank you{order ? `, ${order.contact.firstName}` : ""}.</h1>
            <p>Your order <strong>{number}</strong> is confirmed and the sellers have been notified. A receipt is on its way to your email.</p>
            <button onClick={() => nav(track)} type="button">Track order</button>
            <button className="secondary" onClick={() => nav("/shop")} type="button">Continue shopping</button>
          </>
        ) : cancelled ? (
          <>
            <small>PAYMENT CANCELLED</small>
            <h1>No payment was taken.</h1>
            <p>You cancelled before paying. Your order <strong>{number}</strong> is saved for a short while — you can pay for it from your order page, or start again.</p>
            <button onClick={() => nav(track)} type="button">View order</button>
            <button className="secondary" onClick={() => nav("/cart")} type="button">Back to cart</button>
          </>
        ) : waited < 20 ? (
          <>
            <small>CONFIRMING PAYMENT</small>
            <h1>Just a moment…</h1>
            <p>We're waiting for confirmation from your bank. This usually takes a few seconds — please don't close this page.</p>
          </>
        ) : (
          <>
            <small>STILL PROCESSING</small>
            <h1>We haven't had confirmation yet.</h1>
            <p>Some payments (like Instant EFT) take a few minutes. You'll get an email as soon as it's confirmed — you can also check the order page.</p>
            <button onClick={() => nav(track)} type="button">View order</button>
          </>
        )}
      </div>
    </main>
  );
}
