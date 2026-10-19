import { useState } from "react";
import { api, ApiError, money, niceStatus, qs, type Category, type Product } from "../api";
import { useFetch } from "../hooks";
import { Empty, ErrorState, Loading, Modal, Panel, StatusBadge, useAction } from "./ui";

const blank = { name: "", description: "", categoryId: 0, unit: "each", price: "", oldPrice: "", image: "", stock: "0", lowStockThreshold: "10" };

function ProductForm({ product, categories, onClose, onSaved }: { product: Product | null; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(product ? { name: product.name, description: product.description, categoryId: categories.find((c) => c.slug === product.categorySlug)?.id ?? 0, unit: product.unit, price: String(product.price), oldPrice: product.oldPrice ? String(product.oldPrice) : "", image: product.image ?? "", stock: String(product.onHand ?? 0), lowStockThreshold: String(product.lowStockThreshold ?? 10) } : { ...blank, categoryId: categories[0]?.id ?? 0 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (v: string | number) => { setF((c) => ({ ...c, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({}); setFormError("");
    const body = { name: f.name, description: f.description, categoryId: Number(f.categoryId), unit: f.unit, price: Number(f.price), oldPrice: f.oldPrice ? Number(f.oldPrice) : null, image: f.image || null, stock: Number(f.stock), lowStockThreshold: Number(f.lowStockThreshold) };
    try {
      if (product) await api.patch(`/seller/products/${product.id}`, body); else await api.post("/seller/products", body);
      onSaved(); onClose();
    } catch (err) {
      if (err instanceof ApiError) { setErrors(err.fields); setFormError(Object.keys(err.fields).length ? "Please fix the highlighted fields." : err.message); }
    }
  };
  const row = (label: string, k: keyof typeof f, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={errors[k] ? "has-error" : ""}>{label}<input onChange={(e) => set(k)(e.target.value)} value={String(f[k])} {...props} />{errors[k] && <em className="field-error">{errors[k]}</em>}</label>
  );
  void run; void busy;
  const [uploading, setUploading] = useState(false);
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true); setFormError("");
    try {
      const body = new FormData(); body.append("file", file);
      const res = await fetch("/api/seller/uploads/image", { method: "POST", body, credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Upload failed");
      set("image")(json.url);
    } catch (err) { setFormError(err instanceof Error ? err.message : "Upload failed"); }
    finally { setUploading(false); }
  };
  return (
    <Modal onClose={onClose} title={product ? "Edit product" : "Add product"}>
      <form className="pf" noValidate onSubmit={save}>
        {product?.moderationNote && <p className="form-error">Moderator note: {product.moderationNote}</p>}
        {row("Product name", "name", { required: true })}
        <label>Description<textarea maxLength={1000} onChange={(e) => set("description")(e.target.value)} rows={3} value={f.description} /></label>
        <div className="pf-grid">
          <label>Category<select onChange={(e) => set("categoryId")(Number(e.target.value))} value={f.categoryId}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          {row("Unit", "unit", { placeholder: "kg, pack, each" })}
          {row("Price (R)", "price", { inputMode: "decimal", required: true })}
          {row("Was-price (R, optional)", "oldPrice", { inputMode: "decimal" })}
          {row("Stock on hand", "stock", { inputMode: "numeric" })}
          {row("Low-stock alert at", "lowStockThreshold", { inputMode: "numeric" })}
        </div>
        <div className="image-upload">
          <span>Product photo</span>
          <div>
            {f.image ? <img alt="" src={f.image} /> : <div className="image-upload-empty">No photo yet</div>}
            <label className="portal-filter">{uploading ? "Uploading…" : f.image ? "Replace photo" : "Upload photo"}
              <input accept="image/jpeg,image/png,image/webp" disabled={uploading} hidden onChange={upload} type="file" />
            </label>
          </div>
          <small>JPG, PNG or WebP, up to 3 MB. Square photos look best.</small>
          {errors.image && <em className="field-error">{errors.image}</em>}
        </div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <p className="muted">New products start as a draft. Submit them for moderation when ready — name, description, category or photo edits to live products are re-reviewed.</p>
        <div className="modal-actions"><button className="portal-filter" onClick={onClose} type="button">Cancel</button><button className="portal-primary" type="submit">{product ? "Save changes" : "Create draft"}</button></div>
      </form>
    </Modal>
  );
}

export function SellerProducts() {
  const { data, error, loading, reload } = useFetch<{ items: Product[] }>("/seller/products");
  const cats = useFetch<{ categories: Category[] }>("/catalog/categories");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const { run, busy } = useAction();
  const label = (p: Product) => (p.status === "published" ? (p.stock === 0 ? "Out of stock" : p.lowStock ? "Low stock" : "Published") : niceStatus(p.status ?? ""));
  return (
    <Panel action={<button className="portal-primary" disabled={!cats.data} onClick={() => setEditing("new")} type="button">Add product</button>} kicker="Store catalogue" title="Products">
      {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <Loading /> : data && data.items.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Price</th><th>Status</th><th /></tr></thead>
          <tbody>{data.items.filter((p) => p.status !== "archived").map((p) => (
            <tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.sku}</td><td>{p.stock}</td><td>{money(p.price)}</td><td><StatusBadge>{label(p)}</StatusBadge></td>
              <td className="row-actions">
                <button className="table-action" onClick={() => setEditing(p)} type="button">Edit</button>
                {["draft", "changes_requested"].includes(p.status ?? "") && <button className="table-action" disabled={busy} onClick={async () => { if (await run(() => api.post(`/seller/products/${p.id}/submit`), "Submitted for moderation")) reload(); }} type="button">Submit</button>}
                <button className="table-action danger" disabled={busy} onClick={async () => { if (confirm(`Archive “${p.name}”?`) && (await run(() => api.del(`/seller/products/${p.id}`), "Product archived"))) reload(); }} type="button">Archive</button>
              </td></tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title="No products yet">Add your first product to start selling.</Empty>}
      {editing && cats.data && <ProductForm categories={cats.data.categories} onClose={() => setEditing(null)} onSaved={reload} product={editing === "new" ? null : editing} />}
    </Panel>
  );
}

export function Inventory() {
  const { data, error, loading, reload } = useFetch<{ items: Product[] }>("/seller/products");
  const [draft, setDraft] = useState<Record<number, string>>({});
  const { run, busy } = useAction();
  const items = data?.items.filter((p) => p.status !== "archived") ?? [];
  return (
    <Panel kicker="Stock control" title="Inventory">
      {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <Loading /> : items.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Product</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Update stock</th><th>Status</th></tr></thead>
          <tbody>{items.map((p) => {
            const v = draft[p.id] ?? String(p.onHand ?? 0);
            return (
              <tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.onHand}</td><td>{p.reserved}</td><td>{p.stock}</td>
                <td className="stock-edit"><input aria-label={`Stock for ${p.name}`} inputMode="numeric" min={0} onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))} type="number" value={v} /><button className="table-action" disabled={busy || Number(v) === p.onHand} onClick={async () => { if (await run(() => api.patch(`/seller/products/${p.id}/inventory`, { stock: Number(v) }), "Stock updated")) { setDraft((d) => { const n = { ...d }; delete n[p.id]; return n; }); reload(); } }} type="button">Save</button></td>
                <td><StatusBadge>{p.stock === 0 ? "Out of stock" : p.lowStock ? "Low stock" : "In stock"}</StatusBadge></td></tr>
            );
          })}</tbody>
        </table></div>
      ) : <Empty title="No products to track yet" />}
    </Panel>
  );
}

export function Moderation() {
  const { data, error, loading, reload } = useFetch<{ items: Product[] }>("/products/moderation");
  const { run, busy } = useAction();
  const [target, setTarget] = useState<Product | null>(null);
  const [note, setNote] = useState("");
  return (
    <Panel kicker="Catalogue quality" title="Product moderation">
      {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <Loading /> : data && data.items.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Product</th><th>Seller</th><th>Category</th><th>Price</th><th>Status</th><th /></tr></thead>
          <tbody>{data.items.map((p) => (
            <tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.seller.name}</td><td>{p.category}</td><td>{money(p.price)}</td><td><StatusBadge>{niceStatus(p.status ?? "")}</StatusBadge></td>
              <td className="row-actions">
                <button className="table-action" disabled={busy || p.status !== "submitted"} onClick={async () => { if (await run(() => api.post(`/products/${p.id}/moderation`, { decision: "approve" }), "Product approved and published")) reload(); }} type="button">Approve</button>
                <button className="table-action danger" disabled={busy || p.status !== "submitted"} onClick={() => { setTarget(p); setNote(""); }} type="button">Request changes</button>
              </td></tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title="Queue is clear">No products are waiting for moderation.</Empty>}
      {target && (
        <Modal onClose={() => setTarget(null)} title={`Request changes — ${target.name}`}>
          <form className="pf" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.post(`/products/${target.id}/moderation`, { decision: "request_changes", note }), "Changes requested")) { setTarget(null); reload(); } }}>
            <label>What should the seller change?<textarea autoFocus maxLength={500} onChange={(e) => setNote(e.target.value)} required rows={3} value={note} /></label>
            <div className="modal-actions"><button className="portal-filter" onClick={() => setTarget(null)} type="button">Cancel</button><button className="portal-primary" disabled={busy || !note.trim()} type="submit">Send to seller</button></div>
          </form>
        </Modal>
      )}
    </Panel>
  );
}

void qs;
