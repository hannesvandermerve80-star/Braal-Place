export class ApiError extends Error {
  status: number;
  fields: Record<string, string>;
  details: any;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
    this.fields = details?.fields ?? {};
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: "include",
      headers: body !== undefined && !isForm ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details);
  return data as T;
}

export const api = {
  get: <T,>(u: string) => request<T>("GET", u),
  post: <T,>(u: string, b?: unknown) => request<T>("POST", u, b ?? {}),
  put: <T,>(u: string, b?: unknown) => request<T>("PUT", u, b ?? {}),
  patch: <T,>(u: string, b?: unknown) => request<T>("PATCH", u, b ?? {}),
  del: <T,>(u: string) => request<T>("DELETE", u),
};

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/* ------------------------------------------------------------------ types */
export type Role = "admin" | "manager" | "seller" | "buyer";
export interface User {
  id: number; email: string; firstName: string; lastName: string; mobile: string | null; role: Role;
  permissions: string[]; rewardsPoints: number; store: { id: number; slug: string; name: string; status: string } | null;
}
export interface Product {
  id: number; slug: string; name: string; description: string; category: string; categorySlug: string; unit: string;
  price: number; oldPrice: number | null; savings: number; image: string | null; rating: number; reviews: number; featured: boolean;
  seller: { id: number; slug: string; name: string; verified: boolean; rating: number };
  stock: number; inStock: boolean; lowStock: boolean;
  // seller/staff views
  sku?: string; status?: string; moderationNote?: string | null; onHand?: number; reserved?: number; lowStockThreshold?: number;
}
export interface Category { id: number; slug: string; name: string; count: number }
export interface Totals { subtotal: number; delivery: number; discount: number; total: number; vat: number; promo: { code: string; valid: boolean; message: string | null } | null; freeDeliveryThreshold: number; amountToFreeDelivery: number }
export interface CartLine { id: number; productId: number; qty: number; lineTotal: number; purchasable: boolean; product: Product }
export interface CartView { items: CartLine[]; count: number; totals: Totals; warnings: { productId: number; message: string }[] }
export interface Order {
  id: number; number: string; status: string; paymentStatus: string; createdAt: string; updatedAt: string; estimatedDelivery: string | null;
  subtotal: number; delivery: number; discount: number; total: number; vat: number; promoCode: string | null;
  contact: { firstName: string; lastName: string; email?: string; mobile?: string };
  address: { street: string; suburb: string; city: string; postalCode: string };
  customer: string;
  items: { id: number; productId: number; storeId: number; name: string; sku: string; image: string | null; unitPrice: number; qty: number; lineTotal: number }[];
  sellers: { storeId: number; name: string; slug: string; status: string; subtotal: number; commission: number; net: number }[];
  timeline: { status: string; title: string; at: string; storeId: number | null }[];
  payment: { provider: string; reference: string; status: string } | null;
}
export interface Application {
  id: number; status: string; displayStatus: string; step: number; businessName: string | null; owner: string | null; risk: string;
  escalated: boolean; needsDocuments: boolean; completeness: number; submittedAt: string | null; updatedAt: string; decisionNote: string | null;
  data: Record<string, string>;
  documents: { id: number; kind: string; name: string; mime: string; size: number; uploadedAt: string }[];
  representative?: { firstName: string; lastName: string; email: string; mobile: string };
  history?: { from: string | null; to: string; note: string | null; at: string; actor: string }[];
}
export interface SiteMeta { brand: { name: string; supportEmail: string; supportPhone: string }; freeDeliveryThreshold: number; deliveryFee: number; demoMode: boolean; demoAccounts: { role: Role; label: string; email: string; password: string }[] }

export const money = (v: number) => `R${v.toLocaleString("en-ZA", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const niceStatus = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const when = (s: string) => {
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return d.toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
export const dateOnly = (s: string) => new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z").toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
