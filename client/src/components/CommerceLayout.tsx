import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/Auth";
import { useCart } from "../context/Cart";
import Icon from "./Icon";
import SiteFooter from "./SiteFooter";
import "../styles/commerce.css";

export function CommerceHeader() {
  const { user } = useAuth();
  const { cart } = useCart();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const loc = useLocation();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => { if (loc.pathname === "/shop") setQ(params.get("q") ?? ""); }, [loc.pathname, params]);

  const submit = (e: React.FormEvent) => { e.preventDefault(); nav(`/shop${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`); };
  const cat = params.get("category");
  return (
    <header className="commerce-header">
      <Link aria-label="Bekies braai place home" className="commerce-brand" to="/"><span><Icon name="bag" /></span><strong>Bekies<small>braai place</small></strong></Link>
      <nav aria-label="Main navigation">
        <button className={loc.pathname === "/shop" && !cat ? "active" : ""} onClick={() => nav("/shop")} type="button">Shop</button>
        <button className={cat === "braai-meat" ? "active" : ""} onClick={() => nav("/shop?category=braai-meat")} type="button">Braai meat</button>
        <button className={cat === "groceries" ? "active" : ""} onClick={() => nav("/shop?category=groceries")} type="button">Groceries</button>
        <button className={loc.pathname === "/sell" ? "active" : ""} onClick={() => nav("/sell")} type="button">Sell on Bekies</button>
      </nav>
      <form className="commerce-search" onSubmit={submit} role="search">
        <Icon name="search" size={17} />
        <input aria-label="Search products and sellers" onChange={(e) => setQ(e.target.value)} placeholder="Search products and sellers" value={q} />
      </form>
      <div className="commerce-actions">
        <button aria-label={user ? "Open my dashboard" : "Sign in"} onClick={() => nav(user ? "/portal" : "/account")} type="button"><Icon name="user" /></button>
        <button aria-label={`Shopping cart with ${cart.count} items`} onClick={() => nav("/cart")} type="button"><Icon name="cart" />{cart.count > 0 && <span>{cart.count}</span>}</button>
      </div>
    </header>
  );
}

export default function CommerceLayout() {
  const loc = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [loc.pathname]);
  return (
    <div className="commerce-shell">
      <CommerceHeader />
      <Outlet />
      <SiteFooter />
    </div>
  );
}
