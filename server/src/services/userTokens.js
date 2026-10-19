import crypto from "node:crypto";
import { one, run } from "../db/index.js";

const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");

/** Issue a single-use token (only its SHA-256 is stored). Older unused tokens of the same kind are invalidated. */
export function issueToken(userId, kind, ttlMinutes) {
  const token = crypto.randomBytes(32).toString("base64url");
  run("UPDATE user_tokens SET used_at=datetime('now') WHERE user_id=? AND kind=? AND used_at IS NULL", userId, kind);
  run("INSERT INTO user_tokens (user_id, kind, token_hash, expires_at) VALUES (?,?,?, datetime('now', ?))", userId, kind, hash(token), `+${ttlMinutes} minutes`);
  return token;
}

/** Atomically consume a token; returns the user id or null. */
export function consumeToken(token, kind) {
  const row = one("SELECT * FROM user_tokens WHERE token_hash=? AND kind=? AND used_at IS NULL AND expires_at > datetime('now')", hash(String(token)), kind);
  if (!row) return null;
  const r = run("UPDATE user_tokens SET used_at=datetime('now') WHERE id=? AND used_at IS NULL", row.id);
  return r.changes ? row.user_id : null;
}
