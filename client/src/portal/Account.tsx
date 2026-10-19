import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, money, niceStatus, when, type Product } from "../api";
import { useAuth } from "../context/Auth";
import { useToast } from "../context/Toast";
import { useFetch } from "../hooks";
import ProductCard from "../components/ProductCard";
import { Empty, ErrorState, Loading, Panel, StatusBadge, useAction } from "./ui";

interface Ticket { id: number; name?: string; email?: string; subject: string; message: string; status: string; reply: string | null; orderNumber: string | null; createdAt: string }

export function Support() {
  const { user, can } = useAuth();
  const staff = user!.role === "admin" || can("support.manage");
  const { data, error, loading, reload } = useFetch<{ items: Ticket[] }>(staff ? "/admin/support" : "/me/tickets");
  const [reply, setReply] = useState<Record<number, string>>({});
  const { run, busy } = useAction();
  return (
    <Panel action={!staff ? <Link className="portal-primary" to="/contact">New request</Link> : undefined} kicker={staff ? "Customer care" : "We're here to help"} title={staff ? "Support requests" : "My support requests"}>
      {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <Loading /> : data && data.items.length ? (
        <div className="ticket-list">{data.items.map((t) => (
          <article className="ticket" key={t.id}>
            <header><strong>{t.subject}</strong><StatusBadge>{niceStatus(t.status)}</StatusBadge></header>
            <small>{staff ? `${t.name} · ${t.email} · ` : ""}{when(t.createdAt)}{t.orderNumber ? ` · ${t.orderNumber}` : ""}</small>
            <p>{t.message}</p>
            {t.reply && <p className="reply"><b>Reply:</b> {t.reply}</p>}
            {staff && t.status !== "closed" && (
              <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.post(`/admin/support/${t.id}/reply`, { reply: reply[t.id], close: true }), "Reply sent")) { setReply((r) => ({ ...r, [t.id]: "" })); reload(); } }}>
                <input onChange={(e) => setReply((r) => ({ ...r, [t.id]: e.target.value }))} placeholder="Write a reply…" required value={reply[t.id] ?? ""} /><button className="portal-primary" disabled={busy} type="submit">Reply &amp; close</button>
              </form>
            )}
          </article>
        ))}</div>
      ) : <Empty title="No support requests">{staff ? "You're all caught up." : <Link to="/contact">Contact support</Link>}</Empty>}
    </Panel>
  );
}

export function Wishlist() {
  const { data, error, loading, reload } = useFetch<{ items: Product[] }>("/me/wishlist");
  return (
    <Panel kicker="Saved for later" title="Wishlist">
      {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <Loading /> : data && data.items.length ? <div className="catalog-grid portal-grid-products">{data.items.map((p) => <ProductCard key={p.id} product={p} />)}</div> : <Empty title="Nothing saved yet">Tap the heart on any product to save it here. <Link to="/shop">Browse the shop</Link></Empty>}
    </Panel>
  );
}

interface Addr { id: number; label: string; street: string; suburb: string; city: string; postalCode: string; isDefault: boolean }
export function Addresses() {
  const { data, error, loading, reload } = useFetch<{ items: Addr[] }>("/me/addresses");
  const [f, setF] = useState({ label: "Home", street: "", suburb: "", city: "", postalCode: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErrors({});
    try { await api.post("/me/addresses", f); setF({ label: "Home", street: "", suburb: "", city: "", postalCode: "" }); reload(); }
    catch (err) { if (err instanceof ApiError) setErrors(err.fields); }
  };
  const inp = (label: string, k: keyof typeof f) => <label className={errors[k] ? "has-error" : ""}>{label}<input onChange={(e) => setF({ ...f, [k]: e.target.value })} required value={f[k]} />{errors[k] && <em className="field-error">{errors[k]}</em>}</label>;
  return (
    <>
      <Panel kicker="Delivery" title="Saved addresses">
        {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <Loading rows={2} /> : data && data.items.length ? (
          <div className="address-list">{data.items.map((a) => (
            <article key={a.id}><strong>{a.label} {a.isDefault && <StatusBadge>Default</StatusBadge>}</strong><p>{a.street}<br />{a.suburb}, {a.city} {a.postalCode}</p>
              <div>{!a.isDefault && <button className="table-action" disabled={busy} onClick={async () => { await run(() => api.post(`/me/addresses/${a.id}/default`)); reload(); }} type="button">Make default</button>}<button className="table-action danger" disabled={busy} onClick={async () => { if (await run(() => api.del(`/me/addresses/${a.id}`), "Address removed")) reload(); }} type="button">Remove</button></div></article>
          ))}</div>
        ) : <Empty title="No saved addresses" />}
      </Panel>
      <Panel kicker="New" title="Add an address">
        <form className="pf" onSubmit={add}><div className="pf-grid">{inp("Label", "label")}{inp("Street address", "street")}{inp("Suburb", "suburb")}{inp("City", "city")}{inp("Postal code", "postalCode")}</div><div className="modal-actions"><button className="portal-primary" type="submit">Save address</button></div></form>
      </Panel>
    </>
  );
}

export function StoreSettings() {
  const { data, error, loading, reload } = useFetch<{ store: { name: string; description: string | null; city: string | null; supportEmail: string | null; slug: string; verified: boolean; rating: number } }>("/seller/store");
  const [f, setF] = useState<{ name: string; description: string; city: string; supportEmail: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  if (error) return <ErrorState error={error} retry={reload} />;
  if (loading || !data) return <Loading />;
  const form = f ?? { name: data.store.name, description: data.store.description ?? "", city: data.store.city ?? "", supportEmail: data.store.supportEmail ?? "" };
  const set = (k: keyof typeof form) => (v: string) => setF({ ...form, [k]: v });
  return (
    <Panel action={<Link className="portal-filter" to={`/store/${data.store.slug}`}>View public store</Link>} kicker="Storefront" title="Store settings">
      <form className="pf" onSubmit={async (e) => { e.preventDefault(); setErrors({}); try { await run(async () => { await api.patch("/seller/store", form); }, "Store updated"); reload(); } catch (err) { if (err instanceof ApiError) setErrors(err.fields); } }}>
        <div className="pf-grid">
          <label>Store name<input onChange={(e) => set("name")(e.target.value)} required value={form.name} /></label>
          <label>City<input onChange={(e) => set("city")(e.target.value)} value={form.city} /></label>
          <label className={errors.supportEmail ? "has-error" : ""}>Support email<input onChange={(e) => set("supportEmail")(e.target.value)} type="email" value={form.supportEmail} />{errors.supportEmail && <em className="field-error">{errors.supportEmail}</em>}</label>
        </div>
        <label>About your store<textarea maxLength={500} onChange={(e) => set("description")(e.target.value)} rows={3} value={form.description} /></label>
        <p className="muted">Verified seller · {data.store.rating} rating</p>
        <div className="modal-actions"><button className="portal-primary" disabled={busy} type="submit">Save changes</button></div>
      </form>
    </Panel>
  );
}

export function AccountSettings() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [p, setP] = useState({ firstName: user!.firstName, lastName: user!.lastName, mobile: user!.mobile ?? "" });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [pe, setPe] = useState<Record<string, string>>({});
  const [we, setWe] = useState<Record<string, string>>({});
  return (
    <>
      <Panel kicker="Profile" title="Your details">
        <form className="pf" onSubmit={async (e) => { e.preventDefault(); setPe({}); try { await api.patch("/auth/me", p); await refresh(); toast("Profile updated"); } catch (err) { if (err instanceof ApiError) setPe(err.fields); } }}>
          <div className="pf-grid">
            <label>First name<input onChange={(e) => setP({ ...p, firstName: e.target.value })} required value={p.firstName} /></label>
            <label>Last name<input onChange={(e) => setP({ ...p, lastName: e.target.value })} required value={p.lastName} /></label>
            <label className={pe.mobile ? "has-error" : ""}>Mobile<input onChange={(e) => setP({ ...p, mobile: e.target.value })} value={p.mobile} />{pe.mobile && <em className="field-error">{pe.mobile}</em>}</label>
            <label>Email<input disabled value={user!.email} />{user!.emailVerified === false && <em className="field-error">Not confirmed yet — <button className="link-btn" onClick={async (e) => { e.preventDefault(); try { await api.post("/auth/resend-verification", {}); toast("Confirmation email sent"); } catch { toast("Could not send right now"); } }} type="button">resend link</button></em>}</label>
          </div>
          <div className="modal-actions"><button className="portal-primary" type="submit">Save profile</button></div>
        </form>
      </Panel>
      <Panel kicker="Security" title="Change password">
        <form className="pf" onSubmit={async (e) => { e.preventDefault(); setWe({}); try { await api.post("/auth/change-password", pw); setPw({ currentPassword: "", newPassword: "" }); toast("Password changed"); } catch (err) { if (err instanceof ApiError) setWe(err.fields); } }}>
          <div className="pf-grid">
            <label className={we.currentPassword ? "has-error" : ""}>Current password<input autoComplete="current-password" onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required type="password" value={pw.currentPassword} />{we.currentPassword && <em className="field-error">{we.currentPassword}</em>}</label>
            <label className={we.newPassword ? "has-error" : ""}>New password<input autoComplete="new-password" onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required type="password" value={pw.newPassword} />{we.newPassword && <em className="field-error">{we.newPassword}</em>}</label>
          </div>
          <div className="modal-actions"><button className="portal-primary" type="submit">Update password</button></div>
        </form>
      </Panel>
      <p className="muted pad">Rewards balance: {user!.rewardsPoints.toLocaleString("en-ZA")} points ({money(user!.rewardsPoints / 20)}).</p>
    </>
  );
}
