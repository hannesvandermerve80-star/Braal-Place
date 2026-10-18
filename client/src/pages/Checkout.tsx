import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, money, type Order } from "../api";
import { useAuth } from "../context/Auth";
import { useCart } from "../context/Cart";
import { useTitle } from "../hooks";
import Field from "../components/Field";
import Icon from "../components/Icon";
import SmartImage from "../components/SmartImage";

interface Addr { id: number; label: string; street: string; suburb: string; city: string; postalCode: string; isDefault: boolean }
const blank = { firstName: "", lastName: "", email: "", mobile: "", street: "", suburb: "", city: "", postalCode: "" };

export default function Checkout() {
  useTitle("Checkout");
  const nav = useNavigate();
  const { user } = useAuth();
  const { cart, reload } = useCart();
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [method, setMethod] = useState<"success" | "decline">("success");
  const [saveAddress, setSaveAddress] = useState(true);
  const [addresses, setAddresses] = useState<Addr[]>([]);
  const [placing, setPlacing] = useState(false);
  const [done, setDone] = useState<Order | null>(null);
  const [pendingOrder, setPendingOrder] = useState<Order | null>(null);
  const idem = useRef(crypto.randomUUID());
  const set = (k: keyof typeof blank) => (v: string) => { setF((c) => ({ ...c, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  useEffect(() => {
    if (!user) return;
    setF((c) => ({ ...c, firstName: c.firstName || user.firstName, lastName: c.lastName || user.lastName, email: c.email || user.email, mobile: c.mobile || (user.mobile ?? "") }));
    api.get<{ items: Addr[] }>("/me/addresses").then((r) => {
      setAddresses(r.items);
      const d = r.items.find((a) => a.isDefault) ?? r.items[0];
      if (d) setF((c) => (c.street ? c : { ...c, street: d.street, suburb: d.suburb, city: d.city, postalCode: d.postalCode }));
    }).catch(() => {});
  }, [user]);

  const pay = async (order: Order) => {
    const r = await api.post<{ order: Order }>("/payments/demo/pay", { orderNumber: order.number, email: f.email, outcome: method });
    if (r.order.paymentStatus === "confirmed") { setDone(r.order); setPendingOrder(null); await reload(); window.scrollTo({ top: 0 }); }
    else { setPendingOrder(r.order); setFormError("Your payment was declined. No money was taken — try again or use a different payment method."); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(""); setErrors({});
    setPlacing(true);
    try {
      let order = pendingOrder;
      if (!order) {
        const r = await api.post<{ order: Order }>("/checkout/orders", {
          contact: { firstName: f.firstName, lastName: f.lastName, email: f.email, mobile: f.mobile },
          address: { street: f.street, suburb: f.suburb, city: f.city, postalCode: f.postalCode },
          saveAddress: user ? saveAddress : undefined,
          idempotencyKey: idem.current,
        });
        order = r.order;
        setPendingOrder(order);
      }
      await pay(order);
    } catch (err) {
      if (err instanceof ApiError) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) flat[k.split(".").pop()!] = v;
        setErrors(flat);
        setFormError(Object.keys(flat).length ? "Please fix the highlighted fields." : err.message);
        if (err.status === 409) reload();
      } else setFormError("Something went wrong. Please try again.");
    } finally { setPlacing(false); }
  };

  if (done) {
    return (
      <main className="commerce-main checkout-page">
        <div className="order-success">
          <span><Icon name="check" size={34} /></span><small>ORDER CONFIRMED</small>
          <h1>Thank you, {done.contact.firstName}.</h1>
          <p>Your order <strong>{done.number}</strong> is confirmed and your sellers have been notified. A receipt will be sent to {f.email}.</p>
          <div><b>Estimated delivery</b><strong>{done.estimatedDelivery ? new Date(done.estimatedDelivery).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" }) : "Within 2 working days"}</strong></div>
          <button onClick={() => nav(`/track/${done.number}${user ? "" : `?email=${encodeURIComponent(f.email)}`}`)} type="button">Track order</button>
          <button className="secondary" onClick={() => nav("/shop")} type="button">Continue shopping</button>
        </div>
      </main>
    );
  }

  if (!cart.items.length && !pendingOrder) {
    return <main className="commerce-main checkout-page"><div className="commerce-empty"><strong>Your cart is empty</strong><p>Add something delicious before checking out.</p><button onClick={() => nav("/shop")} type="button">Start shopping</button></div></main>;
  }
  const totals = pendingOrder ? { subtotal: pendingOrder.subtotal, delivery: pendingOrder.delivery, discount: pendingOrder.discount, total: pendingOrder.total } : cart.totals;
  const lines = pendingOrder ? pendingOrder.items.map((i) => ({ id: i.id, name: i.name, image: i.image, qty: i.qty, total: i.lineTotal })) : cart.items.map((i) => ({ id: i.id, name: i.product.name, image: i.product.image, qty: i.qty, total: i.lineTotal }));

  return (
    <main className="commerce-main checkout-page">
      <div className="checkout-head"><button onClick={() => nav("/cart")} type="button"><Icon name="back" /> Cart</button><div><span>Secure checkout</span><h1>Delivery &amp; payment</h1></div></div>
      <div className="prototype-notice"><strong>Test payments</strong><span>No payment provider is connected yet — payments run through a demo provider and no real money is ever taken. Never enter real card details.</span></div>
      {!user && <p className="guest-note">Checking out as a guest. <Link to="/account?next=/checkout">Sign in</Link> to save addresses and track orders in your account.</p>}
      <form className="checkout-layout" noValidate onSubmit={submit}>
        <section className="checkout-forms">
          <article>
            <div className="form-section-head"><span>1</span><div><h2>Contact details</h2><p>For delivery updates and your receipt</p></div></div>
            <div className="form-grid">
              <Field autoComplete="given-name" error={errors.firstName} label="First name" onChange={set("firstName")} placeholder="Lerato" required value={f.firstName} />
              <Field autoComplete="family-name" error={errors.lastName} label="Last name" onChange={set("lastName")} placeholder="Khumalo" required value={f.lastName} />
              <Field autoComplete="email" error={errors.email} label="Email" onChange={set("email")} placeholder="lerato@example.co.za" required type="email" value={f.email} />
              <Field autoComplete="tel" error={errors.mobile} label="Mobile number" onChange={set("mobile")} placeholder="+27 82 000 0000" required type="tel" value={f.mobile} />
            </div>
          </article>
          <article>
            <div className="form-section-head"><span>2</span><div><h2>Delivery address</h2><p>Where should we deliver your chilled order?</p></div></div>
            {addresses.length > 1 && (
              <label className="saved-address">Saved addresses
                <select onChange={(e) => { const a = addresses.find((x) => x.id === Number(e.target.value)); if (a) setF((c) => ({ ...c, street: a.street, suburb: a.suburb, city: a.city, postalCode: a.postalCode })); }}>
                  {addresses.map((a) => <option key={a.id} value={a.id}>{a.label} — {a.street}, {a.suburb}</option>)}
                </select>
              </label>
            )}
            <div className="form-grid">
              <Field autoComplete="street-address" error={errors.street} label="Street address" onChange={set("street")} placeholder="12 Vilakazi Street" required value={f.street} />
              <Field error={errors.suburb} label="Suburb" onChange={set("suburb")} placeholder="Orlando West" required value={f.suburb} />
              <Field error={errors.city} label="City" onChange={set("city")} placeholder="Johannesburg" required value={f.city} />
              <Field autoComplete="postal-code" error={errors.postalCode} inputMode="numeric" label="Postal code" maxLength={4} onChange={set("postalCode")} placeholder="1804" required value={f.postalCode} />
            </div>
            {user && <label className="consent"><input checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} type="checkbox" /> Save this address to my account</label>}
          </article>
          <article>
            <div className="form-section-head"><span>3</span><div><h2>Payment method</h2><p>Test mode — nothing is charged</p></div></div>
            <label className="payment-option"><input checked={method === "success"} name="payment" onChange={() => setMethod("success")} type="radio" /><span><strong>Demo card payment</strong><small>Always succeeds · no funds processed</small></span><b>DEMO</b></label>
            <label className="payment-option"><input checked={method === "decline"} name="payment" onChange={() => setMethod("decline")} type="radio" /><span><strong>Demo card — simulate a decline</strong><small>Lets you test the failed-payment flow</small></span><b>TEST</b></label>
            <label className="payment-option"><input disabled name="payment" type="radio" /><span><strong>Instant EFT</strong><small>Provider not connected</small></span></label>
          </article>
        </section>
        <aside className="order-summary checkout-summary">
          <h2>Your order</h2>
          {lines.map((l) => <div className="summary-product" key={l.id}><SmartImage alt="" src={l.image ?? undefined} /><p><strong>{l.name}</strong><span>Qty {l.qty}</span></p><b>{money(l.total)}</b></div>)}
          <div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
          <div><span>Delivery</span><strong>{totals.delivery ? money(totals.delivery) : "Free"}</strong></div>
          {totals.discount > 0 && <div><span>Discount</span><strong className="discount">−{money(totals.discount)}</strong></div>}
          <div className="summary-total"><span>Total</span><strong>{money(totals.total)}</strong></div>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <button disabled={placing} type="submit">{placing ? "Processing…" : pendingOrder ? `Retry payment · ${money(totals.total)}` : `Place order · ${money(totals.total)}`}</button>
          <p>By continuing you accept our <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.</p>
        </aside>
      </form>
    </main>
  );
}
