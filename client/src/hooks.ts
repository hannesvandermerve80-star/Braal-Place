import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

/** Fetch JSON with loading/error state and manual reload. */
export function useFetch<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!url);
  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try { setData(await api.get<T>(url)); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e : new ApiError(0, "Something went wrong")); }
    finally { setLoading(false); }
  }, [url]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, ...deps]);
  return { data, error, loading, reload: load, setData };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export const useTitle = (title: string) => useEffect(() => { document.title = `${title} · Bekies Braai Place`; }, [title]);
