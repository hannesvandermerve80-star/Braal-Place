import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, money } from "../api";
import { useCart } from "../context/Cart";
import { useTitle } from "../hooks";
import Icon from "../components/Icon";
import SmartImage from "../components/SmartImage";

export default function Cart() {
  useTitle("Shopping cart");
  const nav = useNavigate();
  const { cart, setQty, remove, applyPromo, clearPromo, busy } = useCart();
  const [code, setCode] = useState("");
  const [promoError, setPromoError] = useState("");
  const t = cart.totals;
  const blocked = cart.items.some((i) => !i.purchasable || i.product.stock < i.qty);

  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    try { await applyPromo(code.trim()); setPromoError(""); setCode(""); }
    catch (err) { setPromoError(err instanceof ApiError ? err.message : "Couldn't apply that code"); }
  };

  return (
    <main className="commerce-main narrow-page">
      <div className="page-intro"><span>Your basket</span><h1>Shopping cart</h1><p>{cart.items.length} product{cart.items.length === 1 ? "" : "s"} from trusted Bekies sellers</p></div>
      <div className="cart-layout">
        <section aria-label="Cart items" className="cart-list">
          {cart.warnings.map((w) => <div className="cart-warning" key={w.productId + w.message} role="alert">{w.message}</div>)}
          {cart.items.map((line) => (
            <article className="cart-row" key={line.id}>
              <SmartImage alt={line.product.name} src={line.product.image ?? undefined} />
              <div><span>{line.product.seller.name}</span><Link className="cart-name" to={`/product/${line.product.slug}`}>{line.product.name}</Link><small>Chilled item · {line.product.inStock ? `${money(line.product.price)} each` : "Out of stock"}</small></div>
              <label>Qty<select disabled={busy} onChange={(e) => setQty(line.id, Number(e.target.value))} value={line.qty}>{Array.from({ length: Math.max(line.qty, Math.min(10, line.product.stock)) }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}</select></label>
              <strong>{money(line.lineTotal)}</strong>
              <button aria-label={`Remove ${line.product.name}`} className="remove-item" disabled={busy} onClick={() => remove(line.id)} type="button">Remove</button>
            </article>
          ))}
          {!cart.items.length && <div className="commerce-empty"><strong>Your cart is empty</strong><p>Fresh cuts are waiting for you.</p><button onClick={() => nav("/shop")} type="button">Start shopping</button></div>}
        </section>
        <aside className="order-summary">
          <h2>Order summary</h2>
          <div><span>Subtotal</span><strong>{money(t.subtotal)}</strong></div>
          <div><span>Chilled delivery</span><strong>{t.delivery ? money(t.delivery) : "Free"}</strong></div>
          {t.discount > 0 && <div><span>Discount ({t.promo?.code})</span><strong className="discount">−{money(t.discount)}</strong></div>}
          <div><span>VAT (included)</span><strong>{money(t.vat)}</strong></div>
          {cart.items.length > 0 && t.amountToFreeDelivery > 0 && <p className="free-ship">Add {money(t.amountToFreeDelivery)} more for free delivery</p>}
          {t.promo?.valid ? (
            <div className="promo-applied"><span>✓ {t.promo.code} applied</span><button onClick={clearPromo} type="button">Remove</button></div>
          ) : (
            <form onSubmit={apply}><label><input aria-label="Promo code" onChange={(e) => setCode(e.target.value)} placeholder="Promo code" value={code} /><button disabled={busy} type="submit">Apply</button></label>{promoError && <em className="field-error" role="alert">{promoError}</em>}</form>
          )}
          <div className="summary-total"><span>Total</span><strong>{money(t.total)}</strong></div>
          <button disabled={!cart.items.length || blocked || busy} onClick={() => nav("/checkout")} type="button">Secure checkout <Icon name="arrow" /></button>
          {blocked && <p className="field-error">Fix the highlighted items to continue.</p>}
          <p><Icon name="shield" size={14} /> Secure checkout · prices confirmed on our servers</p>
        </aside>
      </div>
    </main>
  );
}
