import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../api";
import { useToast } from "../context/Toast";
import Icon from "../components/Icon";

export function StatusBadge({ children }: { children: ReactNode }) {
  const t = String(children).toLowerCase();
  const tone =
    /deliver|publish|approved|active|paid|confirmed|completed|^low$|replied|in stock|done/.test(t) ? "success"
    : /payment|out of|escalat|reject|cancel|suspend|failed|high|refunded|critical|changes|declined/.test(t) ? "danger"
    : /ready|dispatch|info|requested|submitted/.test(t) ? "info"
    : "warning";
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

export function Panel({ kicker, title, action, children, wide = true }: { kicker?: string; title: string; action?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? "portal-panel wide" : "portal-panel"}>
      <div className="panel-heading"><div>{kicker && <span>{kicker}</span>}<h2>{title}</h2></div>{action}</div>
      {children}
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-module"><strong>{title}</strong>{children && <p>{children}</p>}{action}</div>;
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return <div aria-busy="true" className="loading-rows">{Array.from({ length: rows }, (_, i) => <div key={i} />)}</div>;
}

export function ErrorState({ error, retry }: { error: ApiError | Error; retry?: () => void }) {
  const denied = error instanceof ApiError && error.status === 403;
  return denied ? (
    <div className="permission-state"><span>403</span><h2>Permission required</h2><p>{error.message}. Ask a Super Admin to review your permissions.</p></div>
  ) : (
    <div className="empty-module" role="alert"><strong>Something went wrong</strong><p>{error.message}</p>{retry && <button className="portal-primary" onClick={retry} type="button">Try again</button>}</div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div aria-label={title} aria-modal="true" className={wide ? "modal wide" : "modal"} ref={ref} role="dialog" tabIndex={-1}>
        <header><h2>{title}</h2><button aria-label="Close" onClick={onClose} type="button"><Icon name="close" size={18} /></button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Password re-entry prompt for sensitive actions (recent authentication). */
export function ConfirmPassword({ title, description, confirmLabel, onClose, onConfirm }: { title: string; description: string; confirmLabel: string; onClose: () => void; onConfirm: (password: string) => Promise<void> }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} title={title}>
      <form className="pf" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { await onConfirm(pw); onClose(); } catch (x) { setErr(x instanceof ApiError ? x.message : "Something went wrong"); } finally { setBusy(false); } }}>
        <p>{description}</p>
        <label>Confirm your password<input autoFocus onChange={(e) => setPw(e.target.value)} required type="password" value={pw} /></label>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="modal-actions"><button className="portal-filter" onClick={onClose} type="button">Cancel</button><button className="portal-primary" disabled={busy || !pw} type="submit">{busy ? "Working…" : confirmLabel}</button></div>
      </form>
    </Modal>
  );
}

export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); return true; }
    catch (e) { toast(e instanceof ApiError ? e.message : "Something went wrong"); return false; }
    finally { setBusy(false); }
  };
  return { run, busy };
}

export function TrendChart({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <div aria-label={label} className="trend-chart" role="img">
      {values.map((v, i) => <span key={i} style={{ height: `${Math.max(6, Math.round((v / max) * 122))}px` }} title={`Week ${i + 1}: ${v.toLocaleString("en-ZA")}`}><i /></span>)}
    </div>
  );
}
