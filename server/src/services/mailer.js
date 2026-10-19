import nodemailer from "nodemailer";
import { all, one, run } from "../db/index.js";
import { config } from "../config.js";

/**
 * Transactional email. Messages are queued in the `emails` table inside the same transaction as the business
 * change (so they are never lost or duplicated), then delivered by a background worker with bounded retry.
 * With no SMTP_HOST configured, delivery is logged instead (development) — nothing is silently dropped.
 */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function layout(title, bodyHtml, cta) {
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#1c2b22">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0b5b3a;padding:20px 28px;color:#fff;font-size:20px;font-weight:bold">Bekies <span style="color:#ff6c09">Braai Place</span></td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 14px;font-size:21px;color:#0b5b3a">${esc(title)}</h1>${bodyHtml}
${cta ? `<p style="margin:26px 0 8px"><a href="${esc(cta.url)}" style="background:#ff6c09;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold;display:inline-block">${esc(cta.label)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;background:#f4f1ea;font-size:12px;color:#66736b">${esc(config.brand.name)} · ${esc(config.brand.serviceArea)}<br>Questions? ${esc(config.brand.supportEmail)}</td></tr>
</table></td></tr></table></body></html>`;
}
export const p = (t) => `<p style="margin:0 0 12px;line-height:1.55;font-size:15px">${esc(t)}</p>`;

/** Queue an email. `key` makes it idempotent (a retried event never sends twice). */
export function queueEmail({ to, subject, text, html, key = null }) {
  if (!to) return;
  run("INSERT OR IGNORE INTO emails (dedupe_key, to_addr, subject, text_body, html_body) VALUES (?,?,?,?,?)", key, to, subject, text, html ?? null);
}

let transport;
const getTransport = () => {
  if (!config.smtp) return null;
  transport ??= nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
};

const MAX_ATTEMPTS = 6;
let busy = false;
export async function processEmails(limit = 50) {
  if (busy) return 0;
  busy = true;
  try {
    const due = all("SELECT * FROM emails WHERE status='pending' AND next_attempt_at <= datetime('now') ORDER BY id LIMIT ?", limit);
    for (const m of due) {
      try {
        const t = getTransport();
        if (t) await t.sendMail({ from: config.smtp.from, to: m.to_addr, subject: m.subject, text: m.text_body, html: m.html_body ?? undefined });
        else if (!config.isTest) console.log(`[email:not-sent — SMTP not configured] to=${m.to_addr} subject="${m.subject}"\n${m.text_body}\n`);
        run("UPDATE emails SET status='sent', sent_at=datetime('now') WHERE id=?", m.id);
      } catch (err) {
        const attempts = m.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) run("UPDATE emails SET status='failed', attempts=?, last_error=? WHERE id=?", attempts, String(err.message).slice(0, 300), m.id);
        else run("UPDATE emails SET attempts=?, last_error=?, next_attempt_at=datetime('now', ?) WHERE id=?", attempts, String(err.message).slice(0, 300), `+${Math.min(2 ** attempts * 30, 3600)} seconds`, m.id);
      }
    }
    return due.length;
  } finally { busy = false; }
}

let timer;
export function startEmailWorker(intervalMs = 5000) {
  stopEmailWorker();
  timer = setInterval(() => { processEmails().catch((e) => console.error("[email]", e)); }, intervalMs);
  timer.unref();
}
export function stopEmailWorker() { if (timer) clearInterval(timer); }
export const emailStats = () => one("SELECT SUM(status='pending') pending, SUM(status='failed') failed, SUM(status='sent') sent FROM emails");
