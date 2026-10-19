import { useParams, useSearchParams } from "react-router-dom";
import { money, dateOnly, type Order } from "../api";
import { useAuth } from "../context/Auth";
import { useFetch, useTitle } from "../hooks";
import { siteConfig } from "../siteConfig";

/** Printable tax invoice / receipt (prices include 15% VAT). */
export default function Invoice() {
  const { number } = useParams();
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const { user } = useAuth();
  const { data, error, loading } = useFetch<{ order: Order }>(`/orders/${number}${email ? `?email=${encodeURIComponent(email)}` : ""}`, [user?.id]);
  useTitle(`Invoice ${number}`);
  if (loading) return <main className="commerce-main"><div className="skeleton-card tall" /></main>;
  if (error || !data) return <main className="commerce-main"><div className="commerce-empty"><strong>Invoice not available</strong><p>Sign in, or open it from your order page.</p></div></main>;
  const o = data.order;
  const paid = o.paymentStatus === "confirmed" || o.paymentStatus === "partially_refunded" || o.paymentStatus === "refunded";
  const exVat = o.total - o.vat;
  return (
    <main className="commerce-main invoice-page">
      <div className="invoice-actions no-print"><button onClick={() => window.print()} type="button">Print / save as PDF</button></div>
      <article className="invoice">
        <header>
          <div><h1>{paid ? "Tax invoice" : "Pro-forma invoice"}</h1><p>{siteConfig.brand}<br />{siteConfig.supportEmail} · {siteConfig.supportPhone}</p></div>
          <dl><dt>Invoice no.</dt><dd>{o.number}</dd><dt>Date</dt><dd>{dateOnly(o.createdAt)}</dd><dt>Status</dt><dd>{paid ? "Paid" : "Unpaid"}</dd></dl>
        </header>
        <section className="invoice-to">
          <div><h3>Billed to</h3><p>{o.contact.firstName} {o.contact.lastName}{o.contact.email && <><br />{o.contact.email}</>}</p></div>
          <div><h3>Delivered to</h3><p>{o.address.street}<br />{o.address.suburb}, {o.address.city} {o.address.postalCode}</p></div>
        </section>
        <table>
          <thead><tr><th>Item</th><th>Seller</th><th className="num">Qty</th><th className="num">Unit (incl. VAT)</th><th className="num">Total</th></tr></thead>
          <tbody>
            {o.items.map((i) => <tr key={i.id}><td>{i.name}<small>{i.sku}</small></td><td>{o.sellers.find((s) => s.storeId === i.storeId)?.name ?? ""}</td><td className="num">{i.qty}</td><td className="num">{money(i.unitPrice)}</td><td className="num">{money(i.lineTotal)}</td></tr>)}
          </tbody>
        </table>
        <dl className="invoice-totals">
          <dt>Subtotal</dt><dd>{money(o.subtotal)}</dd>
          <dt>Delivery</dt><dd>{o.delivery ? money(o.delivery) : "Free"}</dd>
          {o.discount > 0 && <><dt>Discount{o.promoCode ? ` (${o.promoCode})` : ""}</dt><dd>−{money(o.discount)}</dd></>}
          <dt>Total excl. VAT</dt><dd>{money(exVat)}</dd>
          <dt>VAT (15%)</dt><dd>{money(o.vat)}</dd>
          <dt className="grand">Total {paid ? "paid" : "due"}</dt><dd className="grand">{money(o.total)}</dd>
        </dl>
        <div className="invoice-note"><p>Sold by independent verified sellers through {siteConfig.brand}. Prices include VAT where applicable. Thank you for shopping local.</p></div>
      </article>
    </main>
  );
}
