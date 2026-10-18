import { useState } from "react";
import { api, ApiError, niceStatus, when, type Role, type User } from "../api";
import { useFetch } from "../hooks";
import { ConfirmPassword, Empty, ErrorState, Loading, Modal, Panel, StatusBadge, useAction } from "./ui";

type AdminUser = User & { status: string; emailVerified: boolean };

export function Users() {
  const { data, error, loading, reload } = useFetch<{ items: AdminUser[]; allPermissions: string[] }>("/admin/users");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (loading || !data) return <Loading />;
  return (
    <Panel action={<button className="portal-primary" onClick={() => setCreating(true)} type="button">Add manager</button>} kicker="Access control" title="Users & roles">
      <div className="table-wrap"><table>
        <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Permissions</th><th>Status</th><th /></tr></thead>
        <tbody>{data.items.map((u) => (
          <tr key={u.id}><td><strong>{u.firstName} {u.lastName}</strong></td><td>{u.email}</td><td>{niceStatus(u.role)}</td>
            <td className="perm-cell">{u.permissions.includes("*") ? "All" : u.permissions.length ? u.permissions.join(", ") : "—"}</td>
            <td><StatusBadge>{u.status}</StatusBadge></td><td><button className="table-action" onClick={() => setEditing(u)} type="button">Edit</button></td></tr>
        ))}</tbody>
      </table></div>
      {editing && <EditUser all={data.allPermissions} onClose={() => setEditing(null)} onSaved={reload} user={editing} />}
      {creating && <CreateManager all={data.allPermissions} onClose={() => setCreating(false)} onSaved={reload} />}
    </Panel>
  );
}

function PermissionBoxes({ all, value, onChange }: { all: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return <fieldset className="perm-grid"><legend>Permissions</legend>{all.map((p) => <label key={p}><input checked={value.includes(p)} onChange={(e) => onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))} type="checkbox" /> {p}</label>)}</fieldset>;
}

function EditUser({ user, all, onClose, onSaved }: { user: AdminUser; all: string[]; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState<Role>(user.role);
  const [status, setStatus] = useState(user.status);
  const [perms, setPerms] = useState(user.permissions.filter((p) => p !== "*"));
  const [confirming, setConfirming] = useState(false);
  const { run } = useAction();
  return (
    <>
      <Modal onClose={onClose} title={`Edit ${user.firstName} ${user.lastName}`}>
        <form className="pf" onSubmit={(e) => { e.preventDefault(); setConfirming(true); }}>
          <div className="pf-grid">
            <label>Role<select onChange={(e) => setRole(e.target.value as Role)} value={role}>{["admin", "manager", "seller", "buyer"].map((r) => <option key={r} value={r}>{niceStatus(r)}</option>)}</select></label>
            <label>Status<select onChange={(e) => setStatus(e.target.value)} value={status}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
          </div>
          {role === "manager" && <PermissionBoxes all={all} onChange={setPerms} value={perms} />}
          <p className="muted">The manager role itself grants nothing — only the permissions ticked here. Changes are audited and need your password.</p>
          <div className="modal-actions"><button className="portal-filter" onClick={onClose} type="button">Cancel</button><button className="portal-primary" type="submit">Save changes</button></div>
        </form>
      </Modal>
      {confirming && <ConfirmPassword confirmLabel="Confirm change" description="Role and permission changes take effect immediately." onClose={() => setConfirming(false)} onConfirm={async (pw) => { await api.patch(`/admin/users/${user.id}`, { role, status, permissions: role === "manager" ? perms : undefined, confirmPassword: pw }); await run(async () => {}, "User updated"); onSaved(); onClose(); }} title="Confirm sensitive change" />}
    </>
  );
}

function CreateManager({ all, onClose, onSaved }: { all: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", mobile: "", password: "" });
  const [perms, setPerms] = useState(["seller.review", "product.moderate", "orders.manage", "support.manage"]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const { run } = useAction();
  const field = (label: string, k: keyof typeof f, type = "text") => <label className={errors[k] ? "has-error" : ""}>{label}<input onChange={(e) => setF({ ...f, [k]: e.target.value })} required type={type} value={f[k]} />{errors[k] && <em className="field-error">{errors[k]}</em>}</label>;
  return (
    <>
      <Modal onClose={onClose} title="Add a manager">
        <form className="pf" onSubmit={(e) => { e.preventDefault(); setConfirming(true); }}>
          <div className="pf-grid">{field("First name", "firstName")}{field("Last name", "lastName")}{field("Email", "email", "email")}{field("Mobile", "mobile", "tel")}{field("Temporary password", "password", "password")}</div>
          <PermissionBoxes all={all} onChange={setPerms} value={perms} />
          <div className="modal-actions"><button className="portal-filter" onClick={onClose} type="button">Cancel</button><button className="portal-primary" type="submit">Create manager</button></div>
        </form>
      </Modal>
      {confirming && <ConfirmPassword confirmLabel="Create manager" description="Creating privileged accounts is audited." onClose={() => setConfirming(false)} onConfirm={async (pw) => {
        try { await api.post("/admin/users", { ...f, permissions: perms, confirmPassword: pw }); }
        catch (e) { if (e instanceof ApiError && Object.keys(e.fields).length) { setErrors(e.fields); setConfirming(false); } throw e; }
        await run(async () => {}, "Manager created"); onSaved(); onClose();
      }} title="Confirm new account" />}
    </>
  );
}

interface Log { id: number; actor: string; action: string; targetType: string | null; targetId: string | null; meta: Record<string, unknown>; requestId: string | null; at: string }
export function AuditLog() {
  const [q, setQ] = useState("");
  const { data, error, loading, reload } = useFetch<{ items: Log[]; total: number }>(`/admin/audit-logs${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <Panel action={<input aria-label="Filter audit log" className="portal-filter search-input" onChange={(e) => setQ(e.target.value)} placeholder="Filter by action, actor or target" value={q} />} kicker="Append-only record" title="Audit log">
      {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <Loading /> : data && data.items.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>{data.items.map((l) => <tr key={l.id}><td>{when(l.at)}</td><td>{l.actor}</td><td><strong>{l.action}</strong></td><td>{l.targetType ? `${l.targetType} ${l.targetId ?? ""}` : "—"}</td><td className="meta-cell"><code>{Object.keys(l.meta).length ? JSON.stringify(l.meta) : "—"}</code></td></tr>)}</tbody>
        </table></div>
      ) : <Empty title="No matching entries" />}
      {data && <p className="muted pad">Showing {data.items.length} of {data.total} entries.</p>}
    </Panel>
  );
}
