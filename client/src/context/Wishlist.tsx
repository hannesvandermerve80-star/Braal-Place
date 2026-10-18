import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { useAuth } from "./Auth";
import { useToast } from "./Toast";
import { useNavigate } from "react-router-dom";

interface WishState { ids: number[]; has: (id: number) => boolean; toggle: (id: number) => Promise<void> }
const Ctx = createContext<WishState>(null as unknown as WishState);
export const useWishlist = () => useContext(Ctx);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ids, setIds] = useState<number[]>([]);
  const toast = useToast();
  const nav = useNavigate();
  useEffect(() => {
    if (!user) { setIds([]); return; }
    api.get<{ ids: number[] }>("/me/wishlist").then((r) => setIds(r.ids)).catch(() => {});
  }, [user?.id]);
  const toggle = useCallback(async (id: number) => {
    if (!user) { toast("Sign in to save favourites"); nav("/account"); return; }
    const has = ids.includes(id);
    setIds((c) => (has ? c.filter((x) => x !== id) : [...c, id]));
    try { await (has ? api.del(`/me/wishlist/${id}`) : api.put(`/me/wishlist/${id}`)); }
    catch { setIds((c) => (has ? [...c, id] : c.filter((x) => x !== id))); toast("Couldn't update your wishlist"); }
  }, [user, ids, toast, nav]);
  const value = useMemo(() => ({ ids, has: (id: number) => ids.includes(id), toggle }), [ids, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
