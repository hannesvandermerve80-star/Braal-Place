import { run } from "../db/index.js";

export function audit(req, action, targetType, targetId, meta = {}) {
  const actor = req?.user;
  run(
    "INSERT INTO audit_logs (actor_id, actor_label, action, target_type, target_id, meta, request_id) VALUES (?,?,?,?,?,?,?)",
    actor?.id ?? null,
    actor ? `${actor.first_name} ${actor.last_name} (${actor.role})` : "system",
    action,
    targetType ?? null,
    targetId == null ? null : String(targetId),
    JSON.stringify(meta),
    req?.id ?? null,
  );
}
