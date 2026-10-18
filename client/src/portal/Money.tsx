import { useState } from "react";
import { api, money, niceStatus, when } from "../api";
import { useAuth } from "../context/Auth";
import { useFetch } from "../hooks";
import { ConfirmPassword, Empty, ErrorState, Loading, Panel, StatusBadge, useAction } from "./ui";

interface Payout { id: number; store: string; amount: number; status: string; reference: string; createdAt: string }

export function Payouts() {
  const { data, error, loading, reload } = useFetch<{ balance: { available: number; pending: number; paid: number; gross: number; commission: number }; payouts: Payout[]; ledger: { kind: string; amount: number; at: string; order: string }[] }>("/seller/payouts");
  if (error) return <ErrorState error={error} retry={reload} />;
  if (loading || !data) return <Loading rows={5} />;
  const b = data.balance;
  return (
    <>
      <section className="portal-stats">
        <article className="portal-stat green"><span>Available for payout</span><strong>{money(b.available)}</strong><small>Delivered, settled, no disputes</small></article>
        <article className="portal-stat orange"><span>Pending</span><strong>{money(b.pending)}</strong><small>In progress or under review</small></article>
        <article className="portal-stat blue"><span>Paid out</span><strong>{money(b.paid)}</strong><small>Lifetime</small></article>
        <article className="portal-stat neutral"><span>Commission paid</span><strong>{money(b.commission)}</strong><small>On {money(b.gross)} gross sales</small></article>
      </section>
      <Panel kicker="Settlements" title="Payout history">
        {data.payouts.length ? <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>{data.payouts.map((p) => <tr key={p.id}><td><strong>{p.reference}</strong></td><td>{money(p.amount)}</td><td><StatusBadge>{niceStatus(p.status)}</StatusBadge></td><td>{when(p.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="No payouts yet">Payouts are created once delivered orders have settled.</Empty>}
      </Panel>
      <Panel kicker="Ledger" title="Recent activity">
        {data.ledger.length ? <div className="table-wrap"><table><thead><tr><th>Order</th><th>Type</th><th>Amount</th><th>Date</th></tr></thead><tbody>{data.ledger.map((l, i) => <tr key={i}><td><strong>{l.order}</strong></td><td>{niceStatus(l.kind)}</td><td className={l.amount < 0 ? "neg" : ""}>{money(l.amount)}</td><td>{when(l.at)}</td></tr>)}</tbody></table></div> : <Empty title="No ledger entries yet" />}
      </Panel>
    </>
  );
}

interface PaymentsData {
  payments: { id: number; order: string; provider: string; reference: string; amount: number; refunded: number; status: string; createdAt: string }[];
  refunds: { id: number; order: string; amount: number; reason: string | null; status: string; createdAt: string }[];
  totals: { captured: number; refunded: number; commission: number; failed: number };
  payouts: Payout[];
}

export function Payments() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useFetch<PaymentsData>("/admin/payments");
  const [dialog, setDialog] = useState<null | { kind: "refund"; id: number; approve: boolean } | { kind: "payout" }>(null);
  const { run, busy } = useAction();
  if (error) return <ErrorState error={error} retry={reload} />;
  if (loading || !data) return <Loading rows={5} />;
  const t = data.totals;
  return (
    <>
      <section className="portal-stats">
        <article className="portal-stat green"><span>Captured payments</span><strong>{money(t.captured)}</strong><small>Verified by provider webhook</small></article>
        <article className="portal-stat orange"><span>Commission earned</span><strong>{money(t.commission)}</strong><small>Net of refund clawbacks</small></article>
        <article className="portal-stat blue"><span>Refunded</span><strong>{money(t.refunded)}</strong><small>Across all orders</small></article>
        <article className="portal-stat red"><span>Failed attempts</span><strong>{t.failed}</strong><small>Declined or abandoned</small></article>
      </section>

      <Panel kicker="Approval required" title="Refund requests">
        {data.refunds.length ? <div className="table-wrap"><table><thead><tr><th>Order</th><th>Amount</th><th>Reason</th><th>Status</th><th /></tr></thead><tbody>{data.refunds.map((r) => (
          <tr key={r.id}><td><strong>{r.order}</strong></td><td>{money(r.amount)}</td><td>{r.reason ?? "—"}</td><td><StatusBadge>{niceStatus(r.status)}</StatusBadge></td>
            <td className="row-actions">{r.status === "requested" && (can("refund.approve") ? <><button className="table-action" onClick={() => setDialog({ kind: "refund", id: r.id, approve: true })} type="button">Approve</button><button className="table-action danger" onClick={() => setDialog({ kind: "refund", id: r.id, approve: false })} type="button">Reject</button></> : <small className="muted">Needs refund.approve</small>)}</td></tr>
        ))}</tbody></table></div> : <Empty title="No refund requests" />}
      </Panel>

      <Panel action={<button className="portal-primary" disabled={busy} onClick={() => setDialog({ kind: "payout" })} type="button">Run payouts</button>} kicker="Settlement" title="Seller payouts">
        {data.payouts.length ? <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Seller</th><th>Amount</th><th>Date</th></tr></thead><tbody>{data.payouts.slice(0, 15).map((p) => <tr key={p.id}><td><strong>{p.reference}</strong></td><td>{p.store}</td><td>{money(p.amount)}</td><td>{when(p.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="No payouts yet" />}
      </Panel>

      <Panel kicker="Provider records" title="Payments &amp; reconciliation">
        {data.payments.length ? <div className="table-wrap"><table><thead><tr><th>Order</th><th>Provider ref</th><th>Amount</th><th>Refunded</th><th>Status</th><th>Date</th></tr></thead><tbody>{data.payments.slice(0, 25).map((p) => <tr key={p.id}><td><strong>{p.order}</strong></td><td>{p.reference}</td><td>{money(p.amount)}</td><td>{p.refunded ? money(p.refunded) : "—"}</td><td><StatusBadge>{niceStatus(p.status)}</StatusBadge></td><td>{when(p.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="No payments yet" />}
      </Panel>

      {dialog?.kind === "refund" && <ConfirmPassword confirmLabel={dialog.approve ? "Approve refund" : "Reject refund"} description={dialog.approve ? "Approving a refund returns money to the customer and adjusts the seller ledger. This action is audited." : "Rejecting closes the request without refunding."} onClose={() => setDialog(null)} onConfirm={async (pw) => { await api.post(`/admin/refunds/${dialog.id}/decision`, { approve: dialog.approve, confirmPassword: pw }); await run(async () => {}, dialog.approve ? "Refund approved" : "Refund rejected"); reload(); }} title="Confirm refund decision" />}
      {dialog?.kind === "payout" && <ConfirmPassword confirmLabel="Run payouts" description="Creates one payout per seller for settled, undisputed funds (delivered orders without open refunds)." onClose={() => setDialog(null)} onConfirm={async (pw) => { const r = await api.post<{ created: unknown[] }>("/admin/payouts/run", { confirmPassword: pw }); await run(async () => {}, `${r.created.length} payout${r.created.length === 1 ? "" : "s"} created`); reload(); }} title="Run seller payouts" />}
    </>
  );
}
