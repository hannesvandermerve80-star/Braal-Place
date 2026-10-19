import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { one } from "../db/index.js";
import { forbidden, unauthorized } from "../lib/httpError.js";
import { hasPermission, permissionsFor } from "../lib/permissions.js";

export const COOKIE = "bekies_token";

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export function setAuthCookie(res, user) {
  res.cookie(COOKIE, signToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    maxAge: 7 * 24 * 3600 * 1000,
    path: "/",
  });
}

/** Attaches req.user when a valid token (cookie or Bearer) is present. Never rejects. */
export function attachUser(req, _res, next) {
  const header = req.headers.authorization;
  const token = req.cookies?.[COOKIE] || (header?.startsWith("Bearer ") ? header.slice(7) : null);
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const user = one("SELECT * FROM users WHERE id = ?", payload.sub);
      const cutoff = user?.sessions_valid_after ? Math.floor(new Date(user.sessions_valid_after.replace(" ", "T") + "Z").getTime() / 1000) : 0;
      if (user && user.status === "active" && (payload.iat ?? 0) >= cutoff) req.user = user;
    } catch { /* invalid/expired token -> anonymous */ }
  }
  next();
}

export const requireAuth = (req, _res, next) => (req.user ? next() : next(unauthorized()));

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

export const requirePermission = (perm) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!hasPermission(req.user, perm)) return next(forbidden(`Permission required: ${perm}`));
  next();
};

/** Sensitive actions require the actor to re-enter their password (recent authentication). */
export function assertRecentAuth(req, password) {
  if (!password || !bcrypt.compareSync(String(password), req.user.password_hash)) {
    throw forbidden("Please confirm your password to perform this sensitive action");
  }
}

export function publicUser(u) {
  if (!u) return null;
  const store = u.role === "seller"
    ? one("SELECT s.id, s.slug, s.name, s.status FROM stores s JOIN store_members m ON m.store_id = s.id WHERE m.user_id = ? LIMIT 1", u.id)
    : null;
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    mobile: u.mobile,
    emailVerified: !!u.email_verified,
    role: u.role,
    status: u.status,
    permissions: permissionsFor(u),
    rewardsPoints: u.rewards_points,
    store: store ? { ...store } : null,
    createdAt: u.created_at,
  };
}
