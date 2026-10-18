import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type SiteMeta, type User } from "../api";

interface AuthState {
  user: User | null; loading: boolean; meta: SiteMeta | null;
  login: (email: string, password: string) => Promise<User>;
  register: (kind: "customer" | "seller", body: Record<string, unknown>) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (perm: string) => boolean;
}
const Ctx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<SiteMeta | null>(null);

  const refresh = useCallback(async () => {
    try { setUser((await api.get<{ user: User | null }>("/auth/me")).user); } catch { setUser(null); }
  }, []);
  useEffect(() => {
    Promise.all([refresh(), api.get<SiteMeta>("/meta/site").then(setMeta).catch(() => {})]).finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo<AuthState>(() => ({
    user, loading, meta, refresh,
    login: async (email, password) => { const r = await api.post<{ user: User }>("/auth/login", { email, password }); setUser(r.user); return r.user; },
    register: async (kind, body) => { const r = await api.post<{ user: User }>(`/auth/register/${kind}`, body); setUser(r.user); return r.user; },
    logout: async () => { await api.post("/auth/logout"); setUser(null); },
    can: (perm) => !!user && (user.permissions.includes("*") || user.permissions.includes(perm)),
  }), [user, loading, meta, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
