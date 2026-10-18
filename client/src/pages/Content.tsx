import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../context/Auth";
import { useTitle } from "../hooks";
import { siteConfig } from "../siteConfig";
import Field from "../components/Field";
import Icon from "../components/Icon";

interface Page { title: string; kicker: string; intro: string; sections: { h: string; p: string[] }[] }

const PAGES: Record<string, Page> = {
  about: {
    title: "Our story", kicker: "About Bekies",
    intro: "Great braai meat tastes better when it is shared around the fire. Bekies Braai Place connects South African families with trusted local butchers, growers and food makers.",
    sections: [
      { h: "Why we started", p: ["Good butchers know their craft, but reaching customers beyond their street has always been hard. We built a marketplace where verified sellers list premium cuts and braai boxes, and customers get them delivered cold, fast and fairly priced."] },
      { h: "How it works", p: ["Every seller is verified before they can list a single product. Orders are packed fresh, kept in the cold chain and delivered chilled across Johannesburg and Pretoria.", "Because each order can include products from several sellers, you check out once and we coordinate the rest."] },
      { h: "Our promise", p: ["Fresh, safe and fairly handled. If something isn't right, our support team makes it right — see our Returns & Refunds policy."] },
    ],
  },
  privacy: {
    title: "Privacy Policy & POPIA", kicker: "Legal",
    intro: "How Bekies Braai Place collects, uses and protects your personal information in line with the Protection of Personal Information Act (POPIA).",
    sections: [
      { h: "What we collect", p: ["Account details (name, email, mobile number), delivery addresses, order history and the messages you send to support. Sellers also provide business and identity verification documents, which are stored privately."] },
      { h: "How we use it", p: ["To process and deliver orders, provide support, prevent fraud, meet legal obligations and — only if you opted in — send marketing. We never sell your personal information."] },
      { h: "Your rights", p: ["You may ask to access, correct or delete your personal information, withdraw marketing consent at any time, and lodge a complaint with the Information Regulator. Contact " + siteConfig.supportEmail + "."] },
      { h: "Security & retention", p: ["Passwords are hashed, sessions use secure cookies, and sensitive documents are kept in private storage with authorised access only. We retain records only as long as needed for the purposes above or as required by law."] },
    ],
  },
  terms: {
    title: "Terms & Conditions", kicker: "Legal",
    intro: "The terms that apply when you shop or sell on Bekies Braai Place.",
    sections: [
      { h: "Using the marketplace", p: ["Bekies provides a platform where independent, verified sellers list products. A contract of sale is formed between you and the seller; Bekies handles payments, delivery coordination and support."] },
      { h: "Prices & availability", p: ["Prices include VAT and are confirmed at checkout. Stock is reserved for 30 minutes while you complete payment."] },
      { h: "Accounts", p: ["Keep your login details safe. We may suspend accounts that breach these terms or show fraudulent activity."] },
      { h: "Sellers", p: ["Sellers must supply accurate product information, comply with food-safety regulations and fulfil orders on time. A blended 10% commission applies to completed sales."] },
    ],
  },
  returns: {
    title: "Returns & Refunds", kicker: "Support",
    intro: "Because our products are perishable, returns work differently to other goods.",
    sections: [
      { h: "If something is wrong", p: ["Report damaged, spoiled or incorrect items within 24 hours of delivery from your order page using “Request a refund”. Include a description and, where possible, photos."] },
      { h: "How refunds work", p: ["Approved refunds go back to your original payment method within 3–5 working days. Cancelled orders that were already paid are refunded in full."] },
      { h: "Cancelling an order", p: ["You can cancel from your order page until a seller begins preparing it. After that, please contact support."] },
    ],
  },
  shipping: {
    title: "Shipping Policy", kicker: "Support",
    intro: "Cold-chain delivery to Johannesburg and Pretoria.",
    sections: [
      { h: "Delivery fees", p: ["Delivery is R85 per order, and free for orders of R750 or more."] },
      { h: "Delivery times", p: ["Orders are delivered within 2 working days, chilled. Multi-seller orders are coordinated so everything arrives together where possible. No Sunday deliveries."] },
      { h: "Service area", p: [siteConfig.serviceArea + ". We are expanding — join the newsletter to hear first."] },
    ],
  },
  cookies: {
    title: "Cookie Policy", kicker: "Legal",
    intro: "We use only the cookies we need.",
    sections: [
      { h: "Essential cookies", p: ["A secure session cookie keeps you signed in, and a basket cookie remembers your cart before you sign in. Neither is used for advertising."] },
      { h: "Analytics & marketing", p: ["We do not currently set analytics or advertising cookies."] },
    ],
  },
  "seller-guidelines": {
    title: "Seller guidelines", kicker: "For sellers",
    intro: "What we expect from every seller on Bekies.",
    sections: [
      { h: "Verification", p: ["Submit identity and business documents; add a food-safety certificate where applicable. Applications are reviewed within 2 working days."] },
      { h: "Listings", p: ["Use clear photos, accurate weights and honest descriptions. New and edited listings are moderated before going live."] },
      { h: "Fulfilment", p: ["Accept orders promptly, pack to cold-chain standards and update the order status as you go so customers can track delivery."] },
    ],
  },
  "seller-fees": {
    title: "Fees & commission", kicker: "For sellers",
    intro: "Simple, transparent pricing.",
    sections: [
      { h: "No listing fees", p: ["Listing products is free."] },
      { h: "Commission", p: ["A blended 10% commission is deducted from each completed sale. Your dashboard shows gross sales, commission and net earnings."] },
      { h: "Payouts", p: ["Funds become payable once an order is delivered and not under dispute or refund."] },
    ],
  },
};

export function ContentPage() {
  const { pathname } = useLocation();
  const page = PAGES[pathname.replace(/^\//, "")];
  useTitle(page?.title ?? "Not found");
  const nav = useNavigate();
  if (!page) return null;
  return (
    <main className="commerce-main content-page">
      <button className="back-link" onClick={() => nav(-1)} type="button"><Icon name="back" /> Back</button>
      <header><span>{page.kicker}</span><h1>{page.title}</h1><p>{page.intro}</p></header>
      <article>{page.sections.map((s) => <section key={s.h}><h2>{s.h}</h2>{s.p.map((t, i) => <p key={i}>{t}</p>)}</section>)}</article>
      <aside className="content-cta"><strong>Questions?</strong><p>Our team is happy to help.</p><Link to="/contact">Contact support</Link></aside>
    </main>
  );
}

const FAQ: [string, string][] = [
  ["How is my meat kept cold?", "Sellers pack with ice packs and insulated liners, and orders travel in our cold chain until they reach your door."],
  ["When will my order arrive?", "Within 2 working days. Track it any time from the Track Order page."],
  ["Can I change or cancel my order?", "Yes — from your order page until a seller starts preparing it."],
  ["How do I become a seller?", "Apply on the Sell on Bekies page. You'll need to upload identity and business documents."],
  ["Which areas do you deliver to?", siteConfig.serviceArea + "."],
];

export function Help() {
  useTitle("Help centre");
  return (
    <main className="commerce-main content-page">
      <header><span>Support</span><h1>Help centre</h1><p>Answers to the questions we hear most.</p></header>
      <div className="faq">{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
      <aside className="content-cta"><strong>Still stuck?</strong><p>Send us a message and we'll respond within 24 hours.</p><Link to="/contact">Contact support</Link></aside>
    </main>
  );
}

export function Contact() {
  useTitle("Contact us");
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [f, setF] = useState({ name: user ? `${user.firstName} ${user.lastName}` : "", email: user?.email ?? "", subject: "", message: "", orderNumber: params.get("order") ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => { setF((c) => ({ ...c, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({});
    try { const r = await api.post<{ message: string }>("/support/tickets", f); setSent(r.message); }
    catch (err) { setErrors(err instanceof ApiError ? { ...err.fields, _: Object.keys(err.fields).length ? "" : err.message } : { _: "Something went wrong" }); }
    finally { setBusy(false); }
  };

  return (
    <main className="commerce-main content-page">
      <header><span>Support</span><h1>Contact us</h1><p>{siteConfig.supportPhone} · {siteConfig.supportEmail} · Mon–Fri, 8:00am–6:00pm</p></header>
      {sent ? (
        <div className="order-success"><span><Icon name="check" size={34} /></span><small>MESSAGE SENT</small><h1>Thank you.</h1><p>{sent}</p></div>
      ) : (
        <form className="lookup-card" noValidate onSubmit={submit}>
          <div className="form-grid">
            <Field error={errors.name} label="Your name" onChange={set("name")} required value={f.name} />
            <Field error={errors.email} label="Email" onChange={set("email")} required type="email" value={f.email} />
            <Field error={errors.subject} label="Subject" onChange={set("subject")} required value={f.subject} />
            <Field label="Order number (optional)" onChange={set("orderNumber")} placeholder="BK-10483" value={f.orderNumber} />
          </div>
          <label className="form-field"><span>Message <i>*</i></span><textarea aria-invalid={!!errors.message} onChange={(e) => set("message")(e.target.value)} rows={5} value={f.message} />{errors.message && <em className="field-error" role="alert">{errors.message}</em>}</label>
          {errors._ && <p className="form-error" role="alert">{errors._}</p>}
          <button className="auth-submit" disabled={busy} type="submit">{busy ? "Sending…" : "Send message"} <Icon name="arrow" /></button>
        </form>
      )}
    </main>
  );
}
