import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, type CartView } from "../api";
import { useAuth } from "./Auth";
import { useToast } from "./Toast";

const empty: CartView = { items: [], count: 0, warnings: [], totals: { subtotal: 0, delivery: 0, discount: 0, total: 0, vat: 0, promo: null, freeDeliveryThreshold: 750, amountToFreeDelivery: 750 } };
interface CartState {
  cart: CartView; busy: boolean;
  add: (productId: number, qty?: number, label?: string) => Promise<void>;
  setQty: (itemId: number, qty: number) => Promise<void>;
  remove: (itemId: number) => Promise<void>;
  applyPromo: (code: string) => Promise<void>;
  clearPromo: () => Promise<void>;
  reload: () => Promise<void>;
}
const Ctx = createContext<CartState>(null as unknown as CartState);
export const useCart = () => useContext(Ctx);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartView>(empty);
  const [busy, setBusy] = useState(false);
  const { user, loading } = useAuth();
  const toast = useToast();

  const reload = useCallback(async () => { try { setCart(await api.get<CartView>("/cart")); } catch { setCart(empty); } }, []);
  // reload on login/logout (guest cart merges server-side)
  useEffect(() => { if (!loading) reload(); }, [user?.id, loading, reload]);

  const run = useCallback(async (fn: () => Promise<CartView>, ok?: string) => {
    setBusy(true);
    try { setCart(await fn()); if (ok) toast(ok); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Something went wrong"); throw e; }
    finally { setBusy(false); }
  }, [toast]);

  const value = useMemo<CartState>(() => ({
    cart, busy, reload,
    add: (id, qty = 1, label) => run(() => api.post<CartView>("/cart/items", { productId: id, qty }), label ? `${label} added to your cart` : "Added to your cart").catch(() => {}),
    setQty: (id, qty) => run(() => api.patch<CartView>(`/cart/items/${id}`, { qty })).catch(() => {}),
    remove: (id) => run(() => api.del<CartView>(`/cart/items/${id}`)).catch(() => {}),
    applyPromo: (code) => run(() => api.post<CartView>("/cart/promo", { code }), "Promo code applied"),
    clearPromo: () => run(() => api.del<CartView>("/cart/promo")).catch(() => {}),
  }), [cart, busy, reload, run]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
