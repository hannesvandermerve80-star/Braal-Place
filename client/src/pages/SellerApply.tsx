import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, niceStatus, type Application } from "../api";
import { useAuth } from "../context/Auth";
import { useToast } from "../context/Toast";
import { useTitle } from "../hooks";
import Field from "../components/Field";
import Icon from "../components/Icon";

const STEPS = ["Representative", "Business details", "Store profile", "Verification", "Review"];
const TITLES = ["Authorised representative", "Business details", "Create your store", "Verification documents", "Review application"];
const DOCS: [string, string, string][] = [["identity", "Identity document", "PDF, JPG or PNG · max 5 MB · required"], ["business", "Business document", "Registration or trading proof · required"], ["food_safety", "Food safety certificate", "Where applicable"]];
const EDITABLE = ["draft", "rejected"];

export default function SellerApply() {
  useTitle("Sell on Bekies");
  const nav = useNavigate();
  const { user, register, refresh } = useAuth();
  const toast = useToast();
  const [app, setApp] = useState<Application | null>(null);
  const [step, setStep] = useState(1);
  const [d, setD] = useState<Record<string, string>>({});
  const [acct, setAcct] = useState({ firstName: "", lastName: "", email: "", mobile: "", password: "" });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef("identity");

  const canApply = !user || user.role === "buyer" || user.role === "seller";
  useEffect(() => {
    if (!user || !canApply) { setApp(null); return; }
    api.get<{ application: Application }>("/seller-applications/me").then((r) => { setApp(r.application); setD(r.application.data); setStep(Math.min(5, Math.max(1, r.application.step))); }).catch(() => {});
  }, [user?.id, canApply]);

  const locked = !!app && !EDITABLE.includes(app.status) && !app.needsDocuments;
  const setAcctF = (k: keyof typeof acct) => (v: string) => { setAcct((c) => ({ ...c, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };
  const setData = (k: string) => (v: string) => { setD((c) => ({ ...c, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setFormError(""); setErrors({}); setMissing([]);
    try { await fn(); }
    catch (err) {
      if (err instanceof ApiError) { setErrors(err.fields); setMissing(err.details?.missing ?? []); setFormError(Object.keys(err.fields).length ? "" : err.message); }
      else setFormError("Something went wrong. Please try again.");
    } finally { setBusy(false); }
  };

  const saveDraft = async (nextStep: number) => {
    const r = await api.put<{ application: Application }>("/seller-applications/me", { step: nextStep, data: d });
    setApp(r.application);
  };

  const next = () => guard(async () => {
    if (step === 1 && !user) {
      if (!consent) { setErrors({ consent: "Please accept the terms to continue" }); return; }
      await register("seller", { ...acct, consent: true });
      setStep(2);
      return;
    }
    if (!locked && app && step < 5) await saveDraft(step + 1);
    if (step < 5) { setStep(step + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });

  const upload = (file: File) => guard(async () => {
    const fd = new FormData();
    fd.append("kind", kindRef.current);
    fd.append("file", file);
    const r = await api.post<{ application: Application }>("/seller-applications/me/documents", fd);
    setApp(r.application);
    toast("Document uploaded securely");
  });

  const submit = () => guard(async () => {
    await saveDraft(5);
    const r = await api.post<{ application: Application }>("/seller-applications/me/submit");
    setApp(r.application);
    await refresh();
    toast("Application submitted — we'll review it shortly");
  });

  if (user && !canApply) {
    return <main className="commerce-main seller-apply"><div className="commerce-empty"><strong>Staff accounts can't apply to sell</strong><p>Sign in with a customer or seller account to start an application.</p><button onClick={() => nav("/portal")} type="button">Back to dashboard</button></div></main>;
  }

  const submitted = app && !EDITABLE.includes(app.status);
  const docOf = (k: string) => app?.documents.find((x) => x.kind === k);

  return (
    <main className="commerce-main seller-apply">
      <button className="back-link" onClick={() => nav("/shop")} type="button"><Icon name="back" /> Marketplace</button>
      <div className="seller-intro"><span>SELL ON BEKIES</span><h1>Grow your food business with us.</h1><p>Join a trusted marketplace built for South African butchers, growers and food entrepreneurs.</p><div><b>No listing fees</b><b>Secure payouts</b><b>Seller support</b></div></div>

      {submitted && !app?.needsDocuments && (
        <div className="application-status-card">
          <span className={`pill ${app!.status}`}>{app!.displayStatus}</span>
          <h2>{app!.status === "approved" ? "You're approved — welcome aboard!" : app!.status === "suspended" ? "Your store is suspended" : "Application received"}</h2>
          <p>{app!.status === "approved" ? "Your store is live. Add your first products from your seller dashboard." : app!.status === "suspended" ? app!.decisionNote ?? "Please contact support." : "Our team reviews applications within 2 working days. We'll notify you in your dashboard as soon as there is an update."}</p>
          {app!.history && <ol className="history">{app!.history.map((h, i) => <li key={i}><strong>{niceStatus(h.to)}</strong><span>{new Date(h.at.replace(" ", "T") + "Z").toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} · {h.actor}{h.note ? ` — ${h.note}` : ""}</span></li>)}</ol>}
          <button className="auth-submit" onClick={() => nav("/portal")} type="button">Open my dashboard <Icon name="arrow" /></button>
        </div>
      )}

      {(!submitted || app?.needsDocuments) && (
        <div className="application-shell">
          <aside>
            <span>Application progress</span>
            {STEPS.map((item, i) => (
              <button className={step === i + 1 ? "active" : step > i + 1 ? "done" : ""} disabled={!user && i > 0} key={item} onClick={() => setStep(i + 1)} type="button">
                <i>{step > i + 1 ? "✓" : i + 1}</i><span><strong>{item}</strong><small>{i === 3 ? "Documents required" : "Application information"}</small></span>
              </button>
            ))}
          </aside>
          <section>
            <div className="application-status"><span>{app?.displayStatus ?? "Draft application"}</span><strong>{app ? `${app.completeness}% complete` : "Not started"}</strong></div>
            <small>STEP {step} OF 5</small>
            <h2>{TITLES[step - 1]}</h2>
            {app?.status === "rejected" && app.decisionNote && <p className="form-error">Your last application wasn't approved: {app.decisionNote}. You can update it and resubmit.</p>}
            {app?.needsDocuments && <p className="form-error">We need more documents from you{app.decisionNote ? `: ${app.decisionNote}` : "."} Upload them in step 4 and resubmit.</p>}
            <p>{step === 4 ? "Documents are stored privately and only visible to you and our verification team." : user ? "Your progress is saved automatically when you continue." : "Create your seller account to start your application."}</p>

            {step === 1 && (user ? (
              <div className="form-grid">
                <Field disabled label="First name" onChange={() => {}} value={user.firstName} />
                <Field disabled label="Last name" onChange={() => {}} value={user.lastName} />
                <Field disabled label="Work email" onChange={() => {}} value={user.email} />
                <Field disabled label="Mobile number" onChange={() => {}} value={user.mobile ?? ""} />
              </div>
            ) : (
              <>
                <div className="form-grid">
                  <Field autoComplete="given-name" error={errors.firstName} label="First name" onChange={setAcctF("firstName")} placeholder="First name" required value={acct.firstName} />
                  <Field autoComplete="family-name" error={errors.lastName} label="Last name" onChange={setAcctF("lastName")} placeholder="Last name" required value={acct.lastName} />
                  <Field autoComplete="email" error={errors.email} label="Work email" onChange={setAcctF("email")} placeholder="name@business.co.za" required type="email" value={acct.email} />
                  <Field autoComplete="tel" error={errors.mobile} label="Mobile number" onChange={setAcctF("mobile")} placeholder="+27" required type="tel" value={acct.mobile} />
                  <Field autoComplete="new-password" error={errors.password} hint="8+ characters with a letter and a number" label="Create a password" onChange={setAcctF("password")} required type="password" value={acct.password} />
                </div>
                <label className="consent"><input checked={consent} onChange={(e) => { setConsent(e.target.checked); setErrors((x) => ({ ...x, consent: "" })); }} type="checkbox" /> I agree to the <a href="/terms" target="_blank">Terms</a>, <a href="/privacy" target="_blank">Privacy Policy</a> and POPIA consent notice.</label>
                {errors.consent && <em className="field-error" role="alert">{errors.consent}</em>}
                <p className="muted">Already have an account? <Link to="/account?next=/sell">Sign in</Link></p>
              </>
            ))}
            {step === 2 && <div className="form-grid"><Field disabled={locked} label="Registered business name" onChange={setData("businessName")} placeholder="Business or trading name" required value={d.businessName ?? ""} /><Field disabled={locked} label="Registration number" onChange={setData("registrationNumber")} placeholder="If applicable" value={d.registrationNumber ?? ""} /><Field disabled={locked} label="Tax number" onChange={setData("taxNumber")} placeholder="Optional at this stage" value={d.taxNumber ?? ""} /><Field disabled={locked} label="Business address" onChange={setData("businessAddress")} placeholder="Street and suburb" required value={d.businessAddress ?? ""} /></div>}
            {step === 3 && <div className="form-grid"><Field disabled={locked} label="Store name" onChange={setData("storeName")} placeholder="Shown to customers" required value={d.storeName ?? ""} /><Field disabled={locked} label="Primary category" onChange={setData("primaryCategory")} placeholder="Butchery, groceries, produce..." required value={d.primaryCategory ?? ""} /><Field disabled={locked} label="Fulfilment city" onChange={setData("fulfilmentCity")} placeholder="Johannesburg" required value={d.fulfilmentCity ?? ""} /><Field disabled={locked} error={errors.supportEmail} label="Support email" onChange={setData("supportEmail")} placeholder="support@store.co.za" required type="email" value={d.supportEmail ?? ""} /></div>}
            {step === 4 && (
              <>
                <input accept="application/pdf,image/png,image/jpeg" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} ref={fileRef} type="file" />
                <div className="upload-grid">
                  {DOCS.map(([kind, label, hint]) => {
                    const doc = docOf(kind);
                    return (
                      <button className={doc ? "uploaded" : ""} disabled={busy || !user} key={kind} onClick={() => { kindRef.current = kind; fileRef.current?.click(); }} type="button">
                        <span>{doc ? "✓" : "+"}</span><strong>{label}</strong><small>{doc ? `${doc.name} · replace` : hint}</small>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {step === 5 && (
              <div className="review-box">
                <span><Icon name="shield" /></span>
                <div>
                  <strong>Review and submit</strong>
                  <dl className="review-list">
                    <dt>Business</dt><dd>{d.businessName || "—"}</dd>
                    <dt>Store</dt><dd>{d.storeName || "—"} · {d.fulfilmentCity || "—"}</dd>
                    <dt>Category</dt><dd>{d.primaryCategory || "—"}</dd>
                    <dt>Support</dt><dd>{d.supportEmail || "—"}</dd>
                    <dt>Documents</dt><dd>{app?.documents.map((x) => niceStatus(x.kind)).join(", ") || "None uploaded"}</dd>
                  </dl>
                  <p>After you submit, our team verifies your details and documents. You can track progress in your dashboard.</p>
                </div>
              </div>
            )}

            {missing.length > 0 && <div className="form-error" role="alert"><strong>Still needed:</strong> {missing.join(", ")}</div>}
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <div className="application-actions">
              <button disabled={step === 1 || busy} onClick={() => setStep(step - 1)} type="button">Back</button>
              <span>{app ? "Draft · saved" : "Draft"}</span>
              {step < 5
                ? <button disabled={busy || (step > 1 && !user)} onClick={next} type="button">{busy ? "Saving…" : step === 1 && !user ? "Create account & continue" : "Continue"} <Icon name="arrow" /></button>
                : <button disabled={busy || !user} onClick={submit} type="button">{busy ? "Submitting…" : "Submit application"} <Icon name="arrow" /></button>}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
