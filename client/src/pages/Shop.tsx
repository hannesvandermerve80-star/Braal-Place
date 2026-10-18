import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, qs, type Category, type Product } from "../api";
import { useDebounced, useTitle } from "../hooks";
import Icon from "../components/Icon";
import ProductCard from "../components/ProductCard";

const SORTS: [string, string][] = [["featured", "Featured"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"], ["rating", "Rating"], ["newest", "Newest"]];

export default function Shop() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "all";
  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? "featured";
  const inStock = params.get("inStock") === "true";
  const specials = params.get("specials") === "true";
  const maxPrice = Number(params.get("maxPrice") ?? 700);
  const page = Number(params.get("page") ?? 1);

  const [categories, setCategories] = useState<Category[]>([]);
  const [data, setData] = useState<{ items: Product[]; total: number; pages: number } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [price, setPrice] = useState(maxPrice);
  const debouncedPrice = useDebounced(price, 300);

  const activeName = category === "all" ? "All products" : categories.find((c) => c.slug === category)?.name ?? "Products";
  useTitle(activeName);

  const set = (patch: Record<string, string | number | boolean | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === "" || v === false || v === "all") next.delete(k); else next.set(k, String(v)); }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  useEffect(() => { api.get<{ categories: Category[] }>("/catalog/categories").then((r) => setCategories(r.categories)).catch(() => {}); }, []);
  useEffect(() => { if (debouncedPrice !== maxPrice) set({ maxPrice: debouncedPrice >= 700 ? undefined : debouncedPrice }); /* eslint-disable-next-line */ }, [debouncedPrice]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<{ items: Product[]; total: number; pages: number }>(`/catalog/products${qs({ category: category === "all" ? undefined : category, q, sort, inStock, specials, maxPrice: maxPrice >= 700 ? undefined : maxPrice, page, limit: 12 })}`)
      .then((r) => { if (!cancelled) { setData(r); setError(""); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category, q, sort, inStock, specials, maxPrice, page]);

  const total = categories.reduce((n, c) => n + c.count, 0);
  const clear = () => { setPrice(700); setParams({}, { replace: true }); };

  return (
    <main className="commerce-main">
      <div className="catalog-hero"><div><span>THE BRAAI MEAT MARKETPLACE</span><h1>Better meat. Better braais.</h1><p>Premium butcher cuts, braai boxes, boerewors and selected groceries delivered chilled.</p></div><div className="catalog-hero-art"><b>FREE DELIVERY</b><strong>Orders over R750</strong><span>Johannesburg &amp; Pretoria</span></div></div>
      <div className="breadcrumb">Home <b>/</b> Shop <b>/</b> {activeName}{q && <> <b>/</b> “{q}”</>}</div>
      <div className="catalog-layout">
        <aside aria-label="Filters" className="catalog-filters">
          <div>
            <strong>Categories</strong>
            <button className={category === "all" ? "active" : ""} onClick={() => set({ category: "all" })} type="button"><span>All products</span><small>{total}</small></button>
            {categories.map((c) => <button className={category === c.slug ? "active" : ""} key={c.slug} onClick={() => set({ category: c.slug })} type="button"><span>{c.name}</span><small>{c.count}</small></button>)}
          </div>
          <div>
            <strong>Price range</strong>
            <input aria-label="Maximum price" max="700" min="50" onChange={(e) => setPrice(Number(e.target.value))} step="10" type="range" value={price} />
            <p><span>R50</span><span>{price >= 700 ? "R700+" : `Up to R${price}`}</span></p>
          </div>
          <div>
            <strong>Availability</strong>
            <label><input checked={inStock} onChange={(e) => set({ inStock: e.target.checked })} type="checkbox" /> In stock</label>
            <label><input checked={specials} onChange={(e) => set({ specials: e.target.checked })} type="checkbox" /> Specials only</label>
          </div>
          <div className="cold-note"><Icon name="truck" /><strong>Chilled delivery</strong><p>Your meat stays safely cold from seller to doorstep.</p></div>
        </aside>
        <section aria-busy={loading} className="catalog-results">
          <div className="results-head">
            <div><span>Curated selection</span><h2>{activeName}</h2><p>{data ? `${data.total} product${data.total === 1 ? "" : "s"}` : "Loading…"}</p></div>
            <label>Sort by<select onChange={(e) => set({ sort: e.target.value === "featured" ? undefined : e.target.value })} value={sort}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </div>
          {error && <div className="commerce-empty" role="alert"><strong>We couldn't load products</strong><p>{error}</p><button onClick={() => setParams(new URLSearchParams(params))} type="button">Try again</button></div>}
          <div className="catalog-grid">{data?.items.map((p) => <ProductCard key={p.id} product={p} />)}</div>
          {loading && !data && <div className="catalog-grid">{Array.from({ length: 6 }, (_, i) => <div className="skeleton-card" key={i} />)}</div>}
          {data && data.items.length === 0 && <div className="commerce-empty"><strong>No products found</strong><p>Try a different search or category.</p><button onClick={clear} type="button">Clear filters</button></div>}
          {data && data.pages > 1 && (
            <nav aria-label="Pagination" className="pager">
              <button disabled={page <= 1} onClick={() => set({ page: page - 1 })} type="button">← Previous</button>
              <span>Page {page} of {data.pages}</span>
              <button disabled={page >= data.pages} onClick={() => set({ page: page + 1 })} type="button">Next →</button>
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}
