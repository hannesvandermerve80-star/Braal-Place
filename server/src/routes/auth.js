import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { one, run, tx } from "../db/index.js";
import { config } from "../config.js";
import { COOKIE, publicUser, requireAuth, setAuthCookie } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { conflict, unauthorized, wrap, badRequest } from "../lib/httpError.js";
import { email, mobile, password, str } from "../lib/validators.js";
import { audit } from "../services/audit.js";
import { issueToken, consumeToken } from "../services/userTokens.js";
import { sendPasswordReset, sendVerifyEmail } from "../services/emailTemplates.js";

const router = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isTest ? 10000 : 40, standardHeaders: true, legacyHeaders: false, message: { error: { status: 429, message: "Too many attempts. Please wait a few minutes and try again." } } });

const registerSchema = z.object({
  firstName: str(1, 60, "First name is required"),
  lastName: str(1, 60, "Last name is required"),
  email,
  password,
  mobile,
  consent: z.literal(true, { errorMap: () => ({ message: "You must accept the Terms, Privacy Policy and POPIA consent notice" }) }),
  marketing: z.boolean().optional(),
});

function createUser(body, role) {
  if (one("SELECT 1 FROM users WHERE email = ?", body.email)) throw conflict("An account with that email already exists", { fields: { email: "Email already registered" } });
  const hash = bcrypt.hashSync(body.password, 10);
  const r = run(
    "INSERT INTO users (email, password_hash, first_name, last_name, mobile, role, popia_consent_at, marketing_consent) VALUES (?,?,?,?,?,?,datetime('now'),?)",
    body.email, hash, body.firstName, body.lastName, body.mobile, role, body.marketing ? 1 : 0,
  );
  return one("SELECT * FROM users WHERE id = ?", Number(r.lastInsertRowid));
}

router.post("/register/customer", authLimiter, validate(registerSchema), wrap((req, res) => {
  const user = tx(() => { const u = createUser(req.body, "buyer"); sendVerifyEmail(u, issueToken(u.id, "email_verify", 60 * 48)); return u; });
  req.user = user;
  audit(req, "auth.register", "user", user.id, { role: "buyer" });
  setAuthCookie(res, user);
  res.status(201).json({ user: publicUser(user) });
}));

router.post("/register/seller", authLimiter, validate(registerSchema), wrap((req, res) => {
  const user = tx(() => {
    const u = createUser(req.body, "seller");
    run("INSERT INTO seller_applications (user_id, status, data) VALUES (?, 'draft', ?)", u.id, JSON.stringify({}));
    sendVerifyEmail(u, issueToken(u.id, "email_verify", 60 * 48));
    return u;
  });
  req.user = user;
  audit(req, "auth.register", "user", user.id, { role: "seller" });
  setAuthCookie(res, user);
  res.status(201).json({ user: publicUser(user) });
}));

const MAX_FAILS = 5;
router.post("/login", authLimiter, validate(z.object({ email, password: z.string().min(1, "Password is required") })), wrap((req, res) => {
  const { email: addr, password: pw } = req.body;
  const user = one("SELECT * FROM users WHERE email = ?", addr);
  // same message for unknown account / wrong password to avoid account enumeration
  const generic = () => unauthorized("Incorrect email or password");
  if (!user) { bcrypt.compareSync(pw, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv"); throw generic(); }
  if (user.locked_until && new Date(user.locked_until.replace(" ", "T") + "Z") > new Date()) throw unauthorized("Too many failed attempts. Try again in a few minutes.");
  if (!bcrypt.compareSync(pw, user.password_hash)) {
    const fails = user.failed_logins + 1;
    if (fails >= MAX_FAILS) run("UPDATE users SET failed_logins=0, locked_until=datetime('now','+15 minutes') WHERE id=?", user.id);
    else run("UPDATE users SET failed_logins=? WHERE id=?", fails, user.id);
    throw generic();
  }
  if (user.status !== "active") throw unauthorized("This account has been suspended. Contact support.");
  run("UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?", user.id);
  req.user = user;
  audit(req, "auth.login", "user", user.id);
  setAuthCookie(res, user);
  res.json({ user: publicUser(user) });
}));

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

router.get("/me", (req, res) => res.json({ user: publicUser(req.user) }));

router.patch("/me", requireAuth, validate(z.object({ firstName: str(1, 60).optional(), lastName: str(1, 60).optional(), mobile: mobile.optional() })), wrap((req, res) => {
  const b = req.body;
  run("UPDATE users SET first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name), mobile=COALESCE(?,mobile) WHERE id=?", b.firstName ?? null, b.lastName ?? null, b.mobile ?? null, req.user.id);
  res.json({ user: publicUser(one("SELECT * FROM users WHERE id=?", req.user.id)) });
}));

router.post("/change-password", requireAuth, validate(z.object({ currentPassword: z.string().min(1), newPassword: password })), wrap((req, res) => {
  if (!bcrypt.compareSync(req.body.currentPassword, req.user.password_hash)) throw badRequest("Current password is incorrect", { fields: { currentPassword: "Incorrect password" } });
  run("UPDATE users SET password_hash=?, sessions_valid_after=datetime('now') WHERE id=?", bcrypt.hashSync(req.body.newPassword, 10), req.user.id);
  audit(req, "auth.password_changed", "user", req.user.id);
  setAuthCookie(res, req.user); // keep this device signed in; all other sessions are revoked
  res.json({ ok: true });
}));

/* ---- forgot / reset password (always answers 200 so accounts cannot be enumerated) ---- */
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isTest ? 10000 : 8, standardHeaders: true, legacyHeaders: false, message: { error: { status: 429, message: "Too many requests. Please wait and try again." } } });
router.post("/forgot-password", resetLimiter, validate(z.object({ email })), wrap((req, res) => {
  const user = one("SELECT * FROM users WHERE email = ? AND status='active'", req.body.email);
  if (user) tx(() => { sendPasswordReset(user, issueToken(user.id, "password_reset", 60)); audit(req, "auth.password_reset_requested", "user", user.id); });
  res.json({ ok: true, message: "If an account exists for that email, a reset link is on its way." });
}));

router.post("/reset-password", resetLimiter, validate(z.object({ token: z.string().min(20).max(200), newPassword: password })), wrap((req, res) => {
  const userId = tx(() => {
    const id = consumeToken(req.body.token, "password_reset");
    if (!id) return null;
    run("UPDATE users SET password_hash=?, failed_logins=0, locked_until=NULL, email_verified=1, sessions_valid_after=datetime('now') WHERE id=?", bcrypt.hashSync(req.body.newPassword, 10), id);
    return id;
  });
  if (!userId) throw badRequest("This reset link is invalid or has expired. Please request a new one.");
  req.user = one("SELECT * FROM users WHERE id=?", userId);
  audit(req, "auth.password_reset", "user", userId);
  res.json({ ok: true });
}));

/* ---- email verification ---- */
router.post("/verify-email", resetLimiter, validate(z.object({ token: z.string().min(20).max(200) })), wrap((req, res) => {
  const userId = tx(() => { const id = consumeToken(req.body.token, "email_verify"); if (id) run("UPDATE users SET email_verified=1 WHERE id=?", id); return id; });
  if (!userId) throw badRequest("This confirmation link is invalid or has expired.");
  res.json({ ok: true });
}));

router.post("/resend-verification", requireAuth, resetLimiter, wrap((req, res) => {
  if (!req.user.email_verified) tx(() => sendVerifyEmail(req.user, issueToken(req.user.id, "email_verify", 60 * 48)));
  res.json({ ok: true });
}));

export default router;
