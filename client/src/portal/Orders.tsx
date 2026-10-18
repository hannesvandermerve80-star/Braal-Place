import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, money, niceStatus, when, type Order } from "../api";
import { useAuth } from "../context/Auth";
import { useFetch } from "../hooks";
import SmartImage from "../components/SmartImage";
import { Empty, ErrorState, Loading, Modal, Panel, StatusBadge, useAction } from "./ui";

export function OrdersTable({ orders, onOpen }: { orders: Order[]; onOpen?: (o: Order) => void }) {
  const { user } = useAuth();
  const buyer = user!.role === "buyer";
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Order</th>{!buyer && <th>Customer</th>}<th>Seller</th><th>Total</th><th>Status</th><th>Updated</th><th /></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.number}>
              <td><strong>{o.number}</strong></td>
              {!buyer && <td>{o.customer}</td>}
              <td>{o.sellers.map((s) => s.name).join(", ")}</td>
              <td>{money(o.total)}</td>
              <td><StatusBadge>{o.status === "pending_payment" ? "Payment pending" : niceStatus(o.status)}</StatusBadge></td>
              <td>{when(o.updatedAt)}</td>
              <td>{onOpen ? <button className="table-action" onClick={() => onOpen(o)} type="button">View</button> : <Link className="table-action" to={buyer ? `/track/${o.number}` : `/portal/orders?q=${o.number}`}>View</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const NEXT: Record<string, [string, string]> = {
  confirmed: ["accepted", "Accept order"], accepted: ["packing", "Start packing"], packing: ["ready", "Mark ready"],
  ready: ["dispatched", "Dispatch"], dispatched: ["delivered", "Mark delivered"],
};
const CANCELLABLE = ["pending_payment", "confirmed", "accepted", "packing", "ready"];

function OrderDetail({ number, onClose, onChanged }: { number: string; onClose: () => void; onChanged: () => void }) {
  const { user, can } = useAuth();
  const { data, error, reload } = useFetch<{ order: Order }>(`/orders/${number}`);
  const { run, busy } = useAction();
  const [note, setNote] = useState("");
  const staff = user!.role === "admin" || can("orders.manage");
  const seller = user!.role === "seller";

  const move = async (to: string, storeId?: number) => {
    const ok = await run(() => api.post(`/orders/${number}/transitions`, { to, storeId, note: note || undefined }), `Order updated: ${niceStatus(to)}`);
    if (ok) { setNote(""); await reload(); onChanged(); }
  };

  return (
    <Modal onClose={onClose} title={`Order ${number}`} wide>
      {error ? <ErrorState error={error} retry={reload} /> : !data ? <Loading rows={4} /> : (() => {
        const o = data.order;
        return (
          <div className="order-detail">
            <div className="od-head"><StatusBadge>{niceStatus(o.status)}</StatusBadge><span>Placed {when(o.createdAt)}</span><span>Payment: {niceStatus(o.paymentStatus)}</span></div>
            <div className="od-cols">
              <div>
                <h3>Items</h3>
                {o.items.map((i) => <div className="od-item" key={i.id}><SmartImage alt="" src={i.image ?? undefined} /><p><strong>{i.name}</strong><span>{i.sku} · Qty {i.qty}</span></p><b>{money(i.lineTotal)}</b></div>)}
                <div className="od-total"><span>{seller ? "Your subtotal" : "Order total"}</span><strong>{money(o.total)}</strong></div>
                {!seller && o.sellers.some((s) => s.commission) && <p className="muted">Commission {money(o.sellers.reduce((n, s) => n + s.commission, 0))} · Seller net {money(o.sellers.reduce((n, s) => n + s.net, 0))}</p>}
              </div>
              <div>
                <h3>Delivery</h3>
                <p>{o.customer}<br />{o.address.street}<br />{o.address.suburb}, {o.address.city} {o.address.postalCode}</p>
                {o.contact.email && <p className="muted">{o.contact.email} · {o.contact.mobile}</p>}
                <h3>Timeline</h3>
                <ol className="od-timeline">{o.timeline.map((t, i) => <li key={i}><strong>{t.title}</strong><span>{when(t.at)}</span></li>)}</ol>
              </div>
            </div>
            {(seller || staff) && (
              <div className="od-actions">
                <h3>{seller ? "Fulfilment" : "Seller fulfilment"}</h3>
                {o.sellers.map((s) => (
                  <div className="od-seller" key={s.storeId}>
                    <span>{s.name}</span><StatusBadge>{niceStatus(s.status)}</StatusBadge>
                    <div>
                      {NEXT[s.status] && <button className="portal-primary" disabled={busy} onClick={() => move(NEXT[s.status][0], s.storeId)} type="button">{NEXT[s.status][1]}</button>}
                      {CANCELLABLE.includes(s.status) && <button className="portal-filter danger" disabled={busy} onClick={() => confirm(`Cancel ${s.name}'s part of this order?`) && move("cancelled", s.storeId)} type="button">Cancel</button>}
                    </div>
                  </div>
                ))}
                <label className="pf-inline">Note (optional)<input maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Shown in the order timeline" value={note} /></label>
              </div>
            )}
          </div>
        );
      })()}
    </Modal>
  );
}

const STATUSES = ["pending_payment", "confirmed", "accepted", "packing", "ready", "dispatched", "delivered", "cancelled", "refunded"];

export default function OrdersPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? 1);
  const { data, error, loading, reload } = useFetch<{ items: Order[]; total: number; pages: number }>(`/orders?limit=15&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${status}` : ""}`);
  const [open, setOpen] = useState<string | null>(null);
  const buyer = user!.role === "buyer";
  const set = (patch: Record<string, string>) => { const n = new URLSearchParams(params); for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k); if (!("page" in patch)) n.delete("page"); setParams(n, { replace: true }); };

  return (
    <Panel action={<select aria-label="Filter by status" className="portal-filter" onChange={(e) => set({ status: e.target.value })} value={status}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{niceStatus(s)}</option>)}</select>} kicker="Shared fulfilment record" title={buyer ? "My orders" : "Orders"}>
      {q && <p className="filter-chip">Searching “{q}” <button onClick={() => set({ q: "" })} type="button">Clear</button></p>}
      {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <Loading /> : data && data.items.length ? (
        <>
          <OrdersTable onOpen={buyer ? undefined : (o) => setOpen(o.number)} orders={data.items} />
          {data.pages > 1 && <div className="pager"><button disabled={page <= 1} onClick={() => set({ page: String(page - 1) })} type="button">← Previous</button><span>Page {page} of {data.pages}</span><button disabled={page >= data.pages} onClick={() => set({ page: String(page + 1) })} type="button">Next →</button></div>}
        </>
      ) : <Empty title="No orders found">{q || status ? "Try a different search or filter." : buyer ? <Link to="/shop">Browse the shop</Link> : "New orders will appear here."}</Empty>}
      {open && <OrderDetail number={open} onChanged={reload} onClose={() => setOpen(null)} />}
    </Panel>
  );
}
