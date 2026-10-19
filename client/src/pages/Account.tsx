import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../context/Auth";
import { useToast } from "../context/Toast";
import { useTitle } from "../hooks";
import Field from "../components/Field";
import Icon from "../components/Icon";

const blank = { firstName: "", lastName: "", email: "", password: "", mobile: "" };

export default function Account() {
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const { user, login, register, logout, meta } = useAuth();
  const toast = useToast();
  const resetToken = params.get("reset") ?? "";
  const verifyToken = params.get("verify") ?? "";
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">(resetToken ? "reset" : params.get("mode") === "register" ? "register" : "login");
  const [notice, setNotice] = useState("");
  const [newPw, setNewPw] = useState("");
  const [f, setF] = useState(blank);
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  useTitle(mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Reset password");

  useEffect(() => {
    if (!verifyToken) return;
    api.post("/auth/verify-email", { token: verifyToken })
      .then(() => { setNotice("Email confirmed — thank you!"); toast("Email confirmed"); })
      .catch((e) => setNotice(e instanceof ApiError ? e.message : "That confirmation link could not be used."));
  }, [verifyToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const forgot = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setFormError(""); setErrors({});
    try { const r = await api.post<{ message: string }>("/auth/forgot-password", { email: f.email }); setNotice(r.message); }
    catch (err) { if (err instanceof ApiError) { setErrors(err.fields); if (!Object.keys(err.fields).length) setFormError(err.message); } else setFormError("Something went wrong. Please try again."); }
    finally { setBusy(false); }
  };
  const reset = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setFormError(""); setErrors({});
    try { await api.post("/auth/reset-password", { token: resetToken, newPassword: newPw }); setNewPw(""); setMode("login"); setNotice("Password updated — please sign in with your new password."); nav("/account", { replace: true }); }
    catch (err) { if (err instanceof ApiError) { setErrors(err.fields); if (!Object.keys(err.fields).length) setFormError(err.message); } else setFormError("Something went wrong. Please try again."); }
    finally { setBusy(false); }
  };
  const next = params.get("next") || (loc.state as { from?: string } | null)?.from || "/portal";
  const set = (k: keyof typeof blank) => (v: string) => { setF((c) => ({ ...c, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  const submit = async (e?: React.FormEvent, creds?: { email: string; password: string }) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setFormError("");
    try {
      if (mode === "login" || creds) await login(creds?.email ?? f.email, creds?.password ?? f.password);
      else await register("customer", { ...f, consent: consent ? true : undefined, marketing });
      toast(mode === "register" ? "Welcome to Bekies!" : "Signed in");
      nav(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) { setErrors(err.fields); setFormError(Object.keys(err.fields).length ? "" : err.message); }
      else setFormError("Something went wrong. Please try again.");
    } finally { setBusy(false); }
  };

  if (user) {
    return (
      <main className="commerce-main auth-page single">
        <section className="auth-card">
          {notice && <p className="form-notice" role="status">{notice}</p>}
          <span>Signed in</span><h2>Hi {user.firstName}</h2><p>You're signed in as {user.email}.</p>
          <button className="auth-submit" onClick={() => nav("/portal")} type="button">Go to my dashboard <Icon name="arrow" /></button>
          <div className="auth-switch"><span>Not you?</span><button onClick={async () => { await logout(); toast("Signed out"); }} type="button">Sign out</button></div>
        </section>
      </main>
    );
  }

  return (
    <main className="commerce-main auth-page">
      <section className="auth-visual"><span>PREMIUM MEAT · TRUSTED BUTCHERS</span><h1>Your braai, <em>your way.</em></h1><p>Sign in to order premium cuts, save braai favourites, message sellers and track chilled deliveries.</p><div><Icon name="shield" /><span><strong>Protected by design</strong><small>Encrypted sessions, rate-limited sign-in and POPIA-aware data handling</small></span></div></section>
      <section className="auth-card">
        <button className="back-link" onClick={() => nav("/shop")} type="button"><Icon name="back" /> Back to marketplace</button>
        <span>{mode === "login" ? "Welcome back" : mode === "register" ? "Join Bekies" : "Account recovery"}</span>
        <h2>{mode === "login" ? "Sign in to your account" : mode === "register" ? "Create a customer account" : mode === "forgot" ? "Forgot your password?" : "Choose a new password"}</h2>
        <p>{mode === "login" ? "Customers, sellers and staff all sign in here." : mode === "register" ? "It takes less than a minute." : mode === "forgot" ? "Enter your email and we'll send you a reset link." : "Pick a password with 8+ characters, a letter and a number."}</p>
        {notice && <p className="form-notice" role="status">{notice}</p>}
        {mode === "forgot" && (
          <form noValidate onSubmit={forgot}>
            <div className="form-grid"><Field autoComplete="email" error={errors.email} label="Email address" onChange={set("email")} placeholder="you@example.co.za" required type="email" value={f.email} /></div>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <button className="auth-submit" disabled={busy} type="submit">{busy ? "Sending…" : "Send reset link"} <Icon name="arrow" /></button>
            <div className="auth-switch"><button onClick={() => { setMode("login"); setNotice(""); }} type="button">Back to sign in</button></div>
          </form>
        )}
        {mode === "reset" && (
          <form noValidate onSubmit={reset}>
            <div className="form-grid"><Field autoComplete="new-password" error={errors.newPassword} label="New password" onChange={(v) => { setNewPw(v); setErrors({}); }} placeholder="At least 8 characters" required type="password" value={newPw} /></div>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <button className="auth-submit" disabled={busy} type="submit">{busy ? "Saving…" : "Update password"} <Icon name="arrow" /></button>
            <div className="auth-switch"><button onClick={() => { setMode("forgot"); setFormError(""); nav("/account", { replace: true }); }} type="button">Request a new link</button></div>
          </form>
        )}
        {(mode === "login" || mode === "register") && <form noValidate onSubmit={submit}>
          <div className="form-grid">
            {mode === "register" && <><Field autoComplete="given-name" error={errors.firstName} label="First name" onChange={set("firstName")} placeholder="Your first name" required value={f.firstName} /><Field autoComplete="family-name" error={errors.lastName} label="Last name" onChange={set("lastName")} placeholder="Your last name" required value={f.lastName} /></>}
            <Field autoComplete="email" error={errors.email} label="Email address" onChange={set("email")} placeholder="you@example.co.za" required type="email" value={f.email} />
            <Field autoComplete={mode === "login" ? "current-password" : "new-password"} error={errors.password} hint={mode === "register" ? "8+ characters with a letter and a number" : undefined} label="Password" onChange={set("password")} placeholder="At least 8 characters" required type="password" value={f.password} />
            {mode === "register" && <Field autoComplete="tel" error={errors.mobile} label="Mobile number" onChange={set("mobile")} placeholder="+27" required type="tel" value={f.mobile} />}
          </div>
          {mode === "register" && (
            <>
              <label className="consent"><input checked={consent} onChange={(e) => { setConsent(e.target.checked); setErrors((x) => ({ ...x, consent: "" })); }} type="checkbox" /> I agree to the <a href="/terms" target="_blank">Terms</a>, <a href="/privacy" target="_blank">Privacy Policy</a> and POPIA consent notice.</label>
              {errors.consent && <em className="field-error" role="alert">{errors.consent}</em>}
              <label className="consent"><input checked={marketing} onChange={(e) => setMarketing(e.target.checked)} type="checkbox" /> Send me deals and new arrivals (optional).</label>
            </>
          )}
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <button className="auth-submit" disabled={busy} type="submit">{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"} <Icon name="arrow" /></button>
          {mode === "login" && <button className="forgot-link" onClick={() => { setMode("forgot"); setFormError(""); setNotice(""); }} type="button">Forgot your password?</button>}
        </form>}
        {(mode === "login" || mode === "register") && <div className="auth-switch"><span>{mode === "login" ? "New to Bekies?" : "Already registered?"}</span><button onClick={() => { setMode(mode === "login" ? "register" : "login"); setErrors({}); setFormError(""); }} type="button">{mode === "login" ? "Create an account" : "Sign in"}</button></div>}
        <button className="seller-auth-link" onClick={() => nav("/sell")} type="button">Want to sell? Apply as a seller</button>
        {meta?.demoMode && mode === "login" && (
          <div className="demo-accounts">
            <strong>Demo accounts</strong><small>One click sign-in to explore each role</small>
            <div>{meta.demoAccounts.map((a) => <button disabled={busy} key={a.email} onClick={() => submit(undefined, { email: a.email, password: a.password })} type="button"><b>{a.label}</b><span>{a.email}</span></button>)}</div>
          </div>
        )}
      </section>
    </main>
  );
}
