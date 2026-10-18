import { useState } from "react";
import { api, niceStatus, when, type Application } from "../api";
import { useFetch } from "../hooks";
import { Empty, ErrorState, Loading, Modal, Panel, StatusBadge, useAction } from "./ui";

const DOC_LABEL: Record<string, string> = { identity: "Identity document", business: "Business document", food_safety: "Food safety certificate" };

function Review({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useFetch<{ application: Application }>(`/seller-applications/${id}`);
  const { run, busy } = useAction();
  const [note, setNote] = useState("");
  const decide = async (decision: string, ok: string) => {
    if (["reject", "suspend"].includes(decision) && !note.trim()) { alert("Please add a reason first."); return; }
    if (await run(() => api.post(`/seller-applications/${id}/decision`, { decision, note: note || undefined }), ok)) { setNote(""); await reload(); onChanged(); }
  };
  return (
    <Modal onClose={onClose} title="Seller application" wide>
      {error ? <ErrorState error={error} retry={reload} /> : !data ? <Loading /> : (() => {
        const a = data.application;
        const d = a.data;
        return (
          <div className="order-detail">
            <div className="od-head"><strong>{a.businessName}</strong><StatusBadge>{a.displayStatus}</StatusBadge><span>{a.completeness}% complete</span><span>Risk: <StatusBadge>{a.risk}</StatusBadge></span></div>
            <div className="od-cols">
              <div>
                <h3>Representative</h3>
                <p>{a.representative?.firstName} {a.representative?.lastName}<br />{a.representative?.email}<br />{a.representative?.mobile}</p>
                <h3>Business</h3>
                <dl className="review-list"><dt>Registered name</dt><dd>{d.businessName || "—"}</dd><dt>Reg. number</dt><dd>{d.registrationNumber || "—"}</dd><dt>Tax number</dt><dd>{d.taxNumber || "—"}</dd><dt>Address</dt><dd>{d.businessAddress || "—"}</dd></dl>
                <h3>Store</h3>
                <dl className="review-list"><dt>Name</dt><dd>{d.storeName || "—"}</dd><dt>Category</dt><dd>{d.primaryCategory || "—"}</dd><dt>City</dt><dd>{d.fulfilmentCity || "—"}</dd><dt>Support</dt><dd>{d.supportEmail || "—"}</dd></dl>
              </div>
              <div>
                <h3>Documents (private)</h3>
                {["identity", "business", "food_safety"].map((k) => { const doc = a.documents.find((x) => x.kind === k); return <p className="doc-row" key={k}><span>{DOC_LABEL[k]}</span>{doc ? <a href={`/api/seller-applications/${a.id}/documents/${doc.id}`} rel="noopener noreferrer" target="_blank">Download</a> : <em>Not provided</em>}</p>; })}
                <h3>Decision history</h3>
                <ol className="od-timeline">{a.history?.map((h, i) => <li key={i}><strong>{niceStatus(h.to)}{h.from === h.to ? " (note)" : ""}</strong><span>{when(h.at)} · {h.actor}{h.note ? ` — ${h.note}` : ""}</span></li>)}</ol>
              </div>
            </div>
            <div className="od-actions">
              <label className="pf-inline">Decision note<input maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Required to reject, suspend or request documents" value={note} /></label>
              <div className="decision-buttons">
                {["submitted"].includes(a.status) && <button className="portal-filter" disabled={busy} onClick={() => decide("start_review", "Review started")} type="button">Start review</button>}
                {["submitted", "under_review"].includes(a.status) && <>
                  <button className="portal-primary" disabled={busy} onClick={() => decide("approve", "Seller approved — store created")} type="button">Approve</button>
                  <button className="portal-filter" disabled={busy} onClick={() => decide("request_documents", "Documents requested")} type="button">Request documents</button>
                  <button className="portal-filter" disabled={busy || a.escalated} onClick={() => decide("escalate", "Escalated to Super Admin")} type="button">Escalate</button>
                  <button className="portal-filter danger" disabled={busy} onClick={() => decide("reject", "Application rejected")} type="button">Reject</button>
                </>}
                {a.status === "approved" && <button className="portal-filter danger" disabled={busy} onClick={() => decide("suspend", "Store suspended")} type="button">Suspend seller</button>}
                {a.status === "suspended" && <button className="portal-primary" disabled={busy} onClick={() => decide("reinstate", "Seller reinstated")} type="button">Reinstate</button>}
              </div>
            </div>
          </div>
        );
      })()}
    </Modal>
  );
}

export default function ApplicationsPage() {
  const [status, setStatus] = useState("");
  const { data, error, loading, reload } = useFetch<{ items: Application[] }>(`/seller-applications${status ? `?status=${status}` : ""}`);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Panel action={<select aria-label="Filter by status" className="portal-filter" onChange={(e) => setStatus(e.target.value)} value={status}><option value="">All statuses</option>{["submitted", "under_review", "approved", "rejected", "suspended"].map((s) => <option key={s} value={s}>{niceStatus(s)}</option>)}</select>} kicker="Verification workflow" title="Seller applications">
      {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <Loading /> : data && data.items.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Business</th><th>Owner</th><th>Submitted</th><th>Complete</th><th>Risk</th><th>Status</th><th /></tr></thead>
          <tbody>{data.items.map((a) => (
            <tr key={a.id}><td><strong>{a.businessName}</strong></td><td>{a.owner}</td><td>{a.submittedAt ? when(a.submittedAt) : "—"}</td><td>{a.completeness}%</td><td><StatusBadge>{a.risk}</StatusBadge></td><td><StatusBadge>{a.displayStatus}</StatusBadge></td><td><button className="table-action" onClick={() => setOpen(a.id)} type="button">Review</button></td></tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title="No applications">New seller applications will appear here.</Empty>}
      {open && <Review id={open} onChanged={reload} onClose={() => setOpen(null)} />}
    </Panel>
  );
}
