import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { siteConfig } from "../siteConfig";
import "../styles/site-footer.css";

type IconName =
  | "bag"
  | "mail"
  | "pin"
  | "phone"
  | "shield"
  | "truck"
  | "headset"
  | "store"
  | "leaf"
  | "send"
  | "chevron"
  | "facebook"
  | "instagram"
  | "x"
  | "youtube"
  | "linkedin";

function FooterIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    bag: (
      <>
        <path d="M5.5 8.5h13l1.7 12h-14.4l-.3-12Z" />
        <path d="M8.5 9V6.5a3.5 3.5 0 0 1 7 0V9M8.2 12h9.2l-1.2 5.5H9.4L8.2 12Z" />
        <path d="M10.2 12v7M15.7 12v7M8.8 15h7.8" />
      </>
    ),
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </>
    ),
    pin: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5 13 13 0 0 0 2.8.7 2 2 0 0 1 1.7 2.1Z" />,
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m8.5 12 2.2 2.2 4.8-5.2" />
      </>
    ),
    truck: (
      <>
        <path d="M2 7h12v10H2zM14 11h4l3 3v3h-7zM4 4h8M1 11h4" />
        <circle cx="6" cy="19" r="2" />
        <circle cx="18" cy="19" r="2" />
      </>
    ),
    headset: (
      <>
        <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1v-5ZM20 14h-3v6h2a1 1 0 0 0 1-1v-5ZM17 20c0 1-2 2-4 2" />
      </>
    ),
    store: (
      <>
        <path d="M4 10v10h16V10M3 4h18l-2 6a3 3 0 0 1-4 1 3 3 0 0 1-6 0 3 3 0 0 1-4-1L3 4ZM9 20v-5h6v5" />
      </>
    ),
    leaf: (
      <>
        <path d="M20 3C11 5 7 10 8 16c.5 3 3 4.5 5.5 3 5.7-3.5 6.5-10 6.5-16Z" />
        <path d="M4 22c3-6 7-10 13-14M7 16c-2-2-4-2-5-2 0 4 2 7 6 7" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4 20-7Z" />
        <path d="M22 2 11 13" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    facebook: <path d="M14 8h3V4h-3c-3 0-5 2-5 5v3H6v4h3v6h4v-6h3l1-4h-4V9c0-.7.3-1 1-1Z" />,
    instagram: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r=".7" fill="currentColor" stroke="none" />
      </>
    ),
    x: <path d="m5 4 14 16M19 4 5 20" />,
    youtube: (
      <>
        <path d="M21 8.2a2.7 2.7 0 0 0-1.9-1.9C17.4 6 12 6 12 6s-5.4 0-7.1.3A2.7 2.7 0 0 0 3 8.2 28 28 0 0 0 2.7 12 28 28 0 0 0 3 15.8a2.7 2.7 0 0 0 1.9 1.9c1.7.3 7.1.3 7.1.3s5.4 0 7.1-.3a2.7 2.7 0 0 0 1.9-1.9 28 28 0 0 0 .3-3.8 28 28 0 0 0-.3-3.8Z" />
        <path d="m10 9 5 3-5 3V9Z" />
      </>
    ),
    linkedin: (
      <>
        <path d="M6 9v10M6 5.5v.1M10.5 19v-6c0-2 1.2-3.5 3.3-3.5s3.2 1.5 3.2 3.5v6M10.5 10v9" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9">
        {paths[name]}
      </g>
    </svg>
  );
}

export default function SiteFooter({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const nav = useNavigate();
  const go = (to: string) => { nav(to); window.scrollTo({ top: 0 }); };

  const subscribe = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      const r = await api.post<{ message: string }>("/newsletter", { email });
      setMessage(r.message);
      setEmail("");
    } catch (e) {
      setMessage(e instanceof ApiError ? (e.fields.email ?? e.message) : "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  if (compact) {
    return (
      <footer className="bekies-footer compact">
        <div className="compact-brand">
          <span><FooterIcon name="bag" /></span>
          <strong>{siteConfig.brand}</strong>
          <small>Workspace</small>
        </div>
        <div className="compact-links">
          <button onClick={() => go("/")} type="button">Marketplace</button>
          <button onClick={() => go("/privacy")} type="button">Privacy & POPIA</button>
          <button onClick={() => go("/help")} type="button">Help centre</button>
        </div>
        <p>© {new Date().getFullYear()} {siteConfig.legalName}</p>
      </footer>
    );
  }

  const benefits = [
    { icon: "shield" as const, title: "Secure Shopping", copy: "Your data and payments are always protected." },
    { icon: "truck" as const, title: "Fast & Reliable Delivery", copy: "Get your orders on time, every time." },
    { icon: "headset" as const, title: "24/7 Customer Support", copy: "We’re here when you need us." },
    { icon: "store" as const, title: "Verified Sellers", copy: "Shop with confidence from trusted sellers." },
    { icon: "leaf" as const, title: "A Bigger Impact", copy: "Supporting local businesses and communities." },
  ];
  const quickLinks: [string, string][] = [["Home", "/"], ["Shop", "/shop"], ["Categories", "/shop"], ["Sell on Bekies", "/sell"], ["About Us", "/about"], ["Contact Us", "/contact"], ["Help & Support", "/help"], ["Track Order", "/track"]];
  const sellerLinks: [string, string][] = [["Become a Seller", "/sell"], ["Seller Guidelines", "/seller-guidelines"], ["Seller Support", "/contact"], ["Fees & Commission", "/seller-fees"], ["Seller Login", "/portal"]];

  return (
    <footer className="bekies-footer">
      <div className="footer-ribbon top" aria-hidden="true" />

      <section className="footer-benefits" aria-label="Marketplace benefits">
        {benefits.map((benefit) => (
          <article key={benefit.title}>
            <span><FooterIcon name={benefit.icon} /></span>
            <h3>{benefit.title}</h3>
            <p>{benefit.copy}</p>
          </article>
        ))}
      </section>

      <section className="footer-main">
        <div className="footer-brand-column">
          <button className="footer-logo" onClick={() => go("/")} type="button">
            <span><FooterIcon name="bag" /></span>
            <strong>Bekies<small>braai place</small></strong>
          </button>
          <div className="footer-motto"><span>Shop</span><i /><span>Sell</span><i /><span>Grow Together</span></div>
          <p><strong>Bekies braai place</strong> is your trusted online marketplace where buyers and sellers come together. Discover great products, support local businesses, and be part of a growing community.</p>
          <div className="social-links" aria-label="Social media">
            {(["facebook", "instagram", "x", "youtube", "linkedin"] as const).map((name) => (
              <a aria-label={name} href={siteConfig.social[name]} key={name} rel="noopener noreferrer" target="_blank"><FooterIcon name={name} /></a>
            ))}
          </div>
        </div>

        <div className="footer-link-group">
          <h3>Quick Links</h3>
          {quickLinks.map(([label, to]) => (
            <button key={label} onClick={() => go(to)} type="button">
              <FooterIcon name="chevron" />{label}
            </button>
          ))}
        </div>

        <div className="footer-support-column">
          <h3>Customer Support</h3>
          <div className="support-item">
            <span><FooterIcon name="phone" /></span>
            <p><strong>{siteConfig.supportPhone}</strong><small>Mon - Fri, 8:00am - 6:00pm</small></p>
          </div>
          <div className="support-item">
            <span><FooterIcon name="mail" /></span>
            <p><strong>{siteConfig.supportEmail}</strong><small>We’ll respond within 24 hours</small></p>
          </div>
          <div className="support-item">
            <span><FooterIcon name="pin" /></span>
            <p><strong>8 Rose Street, Cape Town CBD</strong><small>State House Building<br />Cape Town, 8001</small></p>
          </div>
          <div className="payment-section">
            <h3>Payment Methods</h3>
            <div aria-label="Visa, Mastercard, Apple Pay, PayPal and EFT">
              <b className="visa">VISA</b>
              <b className="mastercard"><i /><i /></b>
              <b className="apple">●Pay</b>
              <b className="paypal">P <span>PayPal</span></b>
              <b className="eft"><span>⌂</span><small>EFT</small></b>
            </div>
          </div>
        </div>

        <div className="footer-link-group seller-links">
          <h3>For Sellers</h3>
          {sellerLinks.map(([label, to]) => (
            <button key={label} onClick={() => go(to)} type="button">
              <FooterIcon name="chevron" />{label}
            </button>
          ))}
        </div>

        <form className="footer-newsletter" onSubmit={subscribe}>
          <h3>Join Our Newsletter</h3>
          <p>Get the latest deals, new arrivals and exclusive offers straight to your inbox.</p>
          <label>
            <FooterIcon name="mail" />
            <input aria-label="Email for newsletter" onChange={(event) => setEmail(event.target.value)} placeholder="Enter your email address" type="email" value={email} />
          </label>
          <button disabled={sending} type="submit"><FooterIcon name="send" />{sending ? "Subscribing…" : "Subscribe"}</button>
          <small aria-live="polite">{message}</small>
        </form>
      </section>

      <section className="footer-bottom">
        <p>© {new Date().getFullYear()} Bekies braai place. All rights reserved.</p>
        <div className="footer-legal">
          <button onClick={() => go("/privacy")} type="button">Privacy Policy</button><i />
          <button onClick={() => go("/terms")} type="button">Terms & Conditions</button><i />
          <button onClick={() => go("/returns")} type="button">Returns & Refunds</button><i />
          <button onClick={() => go("/shipping")} type="button">Shipping Policy</button><i />
          <button onClick={() => go("/cookies")} type="button">Cookie Policy</button>
        </div>
        <span className="south-african">Proudly South African <b aria-label="South African flag"><i /><i /><i /><i /><i /><i /></b></span>
      </section>
      <div className="footer-ribbon bottom" aria-hidden="true" />
    </footer>
  );
}
