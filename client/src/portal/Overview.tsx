import { Link } from "react-router-dom";
import { money, type Order } from "../api";
import { useAuth } from "../context/Auth";
import { useFetch } from "../hooks";
import { Empty, ErrorState, Loading, Panel, TrendChart } from "./ui";
import { OrdersTable } from "./Orders";

interface Overview { stats: { label: string; value: string; note: string; tone: string }[]; trend: number[]; trendTotal: number | null; trendLabel: string; tasks: { title: string; link: string }[] }

export default function OverviewPage() {
  const { user, can } = useAuth();
  const ov = useFetch<Overview>("/portal/overview");
  const canOrders = user!.role !== "manager" || can("orders.manage");
  const orders = useFetch<{ items: Order[] }>(canOrders ? "/orders?limit=5" : null);
  if (ov.error) return <ErrorState error={ov.error} retry={ov.reload} />;
  if (!ov.data) return <Loading rows={5} />;
  const d = ov.data;
  const role = user!.role;
  return (
    <>
      <section aria-label="Key figures" className="portal-stats">
        {d.stats.map((s) => <article className={`portal-stat ${s.tone}`} key={s.label}><span>{s.label}</span><strong>{s.value}</strong><small>{s.note}</small></article>)}
      </section>
      <section className="portal-grid">
        <article className="portal-panel chart-panel">
          <div className="panel-heading"><div><span>Last 12 weeks</span><h2>{d.trendLabel}</h2></div></div>
          {d.trendTotal != null && <div className="chart-total"><strong>{money(d.trendTotal)}</strong><span>Total</span></div>}
          <TrendChart label={`${d.trendLabel} over the last 12 weeks`} values={d.trend} />
          <div className="chart-labels"><span>12 wks ago</span><span>6 wks ago</span><span>This week</span></div>
        </article>
        <article className="portal-panel task-panel">
          <div className="panel-heading"><div><span>Priority</span><h2>{role === "buyer" ? "Order updates" : "Tasks requiring attention"}</h2></div></div>
          {d.tasks.length === 0 && <p className="muted pad">Nothing needs your attention right now. 🎉</p>}
          {d.tasks.map((t, i) => <Link key={t.title} to={t.link}><button tabIndex={-1} type="button"><span>{i + 1}</span><strong>{t.title}</strong></button></Link>)}
        </article>
      </section>
      <Panel action={<Link className="portal-filter" to="/portal/orders">View all</Link>} kicker="Shared fulfilment record" title={role === "buyer" ? "Your recent orders" : role === "seller" ? "Orders to fulfil" : "Recent marketplace orders"}>
        {orders.loading ? <Loading rows={3} /> : orders.data && orders.data.items.length ? <OrdersTable orders={orders.data.items} /> : <Empty title="No orders yet">{role === "buyer" ? <Link to="/shop">Start shopping</Link> : "Orders will appear here as they come in."}</Empty>}
      </Panel>
    </>
  );
}
