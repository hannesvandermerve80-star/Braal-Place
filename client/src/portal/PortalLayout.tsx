import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, type Role } from "../api";
import { useAuth } from "../context/Auth";
import { useToast } from "../context/Toast";
import { useTitle } from "../hooks";
import Icon from "../components/Icon";
import SiteFooter from "../components/SiteFooter";
import "../styles/portal.css";

interface NavItem { to: string; label: string; perm?: string; badge?: boolean }
const ROLE_LABEL: Record<Role, string> = { admin: "Super Admin", manager: "Operations Manager", seller: "Verified Seller", buyer: "Customer" };
const NAV: Record<Role, NavItem[]> = {
  admin: [{ to: "", label: "Overview" }, { to: "applications", label: "Seller applications", badge: true }, { to: "moderation", label: "Product moderation" }, { to: "orders", label: "Orders" }, { to: "payments", label: "Payments" }, { to: "users", label: "Users & roles" }, { to: "support", label: "Support" }, { to: "audit", label: "Audit log" }],
  manager: [{ to: "", label: "Overview" }, { to: "applications", label: "Seller applications", perm: "seller.review", badge: true }, { to: "moderation", label: "Product moderation", perm: "product.moderate" }, { to: "orders", label: "Orders", perm: "orders.manage" }, { to: "support", label: "Support", perm: "support.manage" }, { to: "payments", label: "Payments", perm: "payments.view" }],
  seller: [{ to: "", label: "Overview" }, { to: "products", label: "Products" }, { to: "orders", label: "Orders" }, { to: "inventory", label: "Inventory" }, { to: "payouts", label: "Payouts" }, { to: "store", label: "Store settings" }],
  buyer: [{ to: "", label: "Overview" }, { to: "orders", label: "My orders" }, { to: "wishlist", label: "Wishlist" }, { to: "addresses", label: "Addresses" }, { to: "support", label: "Support" }],
};

interface Note { id: number; title: string; body: string | null; link: string | null; read: boolean; createdAt: string }

export default function PortalLayout() {
  const { user, loading, logout, can } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<{ items: Note[]; unread: number } | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [q, setQ] = useState("");
  useTitle("Dashboard");

  useEffect(() => { setOpen(false); setShowNotes(false); window.scrollTo({ top: 0 }); }, [loc.pathname]);
  useEffect(() => {
    if (!user) return;
    const load = () => api.get<{ items: Note[]; unread: number }>("/me/notifications").then(setNotes).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [user?.id]);

  if (loading) return <div className="app-loading">Loading your workspace…</div>;
  if (!user) return <Navigate replace state={{ from: loc.pathname }} to="/account" />;

  const items = NAV[user.role].filter((i) => !i.perm || can(i.perm) || i.label === "Payments");
  const current = items.find((i) => (i.to === "" ? loc.pathname.replace(/\/$/, "") === "/portal" : loc.pathname.startsWith(`/portal/${i.to}`)));
  const person = user.role === "seller" && user.store ? user.store.name : `${user.firstName} ${user.lastName}`;
  const initials = person.split(" ").map((w) => w[0]).slice(0, 2).join("");
  const today = new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="portal-shell">
      <aside className={open ? "portal-sidebar open" : "portal-sidebar"}>
        <div className="portal-logo"><span>B</span><strong>Bekies<small>braai place</small></strong><button aria-label="Close menu" onClick={() => setOpen(false)} type="button"><Icon name="close" size={19} /></button></div>
        <div className="workspace-label">Workspace</div>
        <nav aria-label={`${ROLE_LABEL[user.role]} navigation`}>
          {items.map((item) => {
            const to = `/portal${item.to ? `/${item.to}` : ""}`;
            const active = item.to === "" ? loc.pathname.replace(/\/$/, "") === "/portal" : loc.pathname.startsWith(to);
            return (
              <button className={active ? "active" : ""} key={item.label} onClick={() => nav(to)} type="button">
                <Icon name="grid" size={19} /><span>{item.label}</span>{item.perm === "payments.view" && !can("payments.view") && <small>Restricted</small>}
              </button>
            );
          })}
          <button className={loc.pathname.startsWith("/portal/account") ? "active" : ""} onClick={() => nav("/portal/account")} type="button"><Icon name="user" size={19} /><span>Account</span></button>
        </nav>
        <div className="sidebar-support"><strong>Need help?</strong><p>Read the help centre or contact platform support.</p><button onClick={() => nav("/help")} type="button">Open help centre</button></div>
        <button className="exit-portal" onClick={() => nav("/")} type="button">Return to marketplace</button>
      </aside>

      <main className="portal-main">
        <header className="portal-header">
          <button aria-label="Open navigation" className="portal-menu" onClick={() => setOpen(true)} type="button"><Icon name="menu" size={19} /></button>
          <label><Icon name="search" size={19} /><input aria-label="Search orders" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && nav(`/portal/orders${q ? `?q=${encodeURIComponent(q)}` : ""}`)} placeholder="Search orders by number or name" value={q} /></label>
          <div className="notif-wrap">
            <button aria-label={`Notifications${notes?.unread ? `, ${notes.unread} unread` : ""}`} className="portal-bell" onClick={() => setShowNotes((s) => !s)} type="button"><Icon name="bell" size={19} />{!!notes?.unread && <span>{notes.unread}</span>}</button>
            {showNotes && (
              <div className="notif-pop" role="menu">
                <header><strong>Notifications</strong><button onClick={async () => { await api.post("/me/notifications/read"); setNotes((n) => n && { items: n.items.map((x) => ({ ...x, read: true })), unread: 0 }); }} type="button">Mark all read</button></header>
                {notes?.items.length ? notes.items.slice(0, 8).map((n) => (
                  <button className={n.read ? "" : "unread"} key={n.id} onClick={() => { setShowNotes(false); if (n.link) nav(n.link.startsWith("/portal") || n.link.startsWith("/track") || n.link === "/sell" ? n.link : "/portal"); }} type="button"><strong>{n.title}</strong>{n.body && <span>{n.body}</span>}</button>
                )) : <p>You're all caught up.</p>}
              </div>
            )}
          </div>
          <div className="portal-profile"><span>{initials}</span><p><strong>{person}</strong><small>{ROLE_LABEL[user.role]}</small></p></div>
          <button className="portal-filter" onClick={async () => { await logout(); toast("Signed out"); nav("/"); }} type="button">Sign out</button>
        </header>
        <div className="portal-content">
          <div className="portal-title"><div><span>{ROLE_LABEL[user.role]} workspace</span><h1>{current?.label === "Overview" || !current ? ({ admin: "Platform command centre", manager: "Operations overview", seller: "Store performance", buyer: "Your Bekies account" })[user.role] : current.label}</h1><p>{today} · Johannesburg</p></div></div>
          <Outlet />
        </div>
        <SiteFooter compact />
      </main>
    </div>
  );
}
