import { Link, useParams } from "react-router-dom";
import { type Product } from "../api";
import { useFetch, useTitle } from "../hooks";
import ProductCard from "../components/ProductCard";

export default function Store() {
  const { slug } = useParams();
  const { data, error, loading } = useFetch<{ store: { name: string; description: string | null; city: string | null; verified: boolean; rating: number }; products: Product[] }>(`/stores/${slug}`);
  useTitle(data?.store.name ?? "Store");
  if (loading) return <main className="commerce-main"><div className="skeleton-card tall" /></main>;
  if (error || !data) return <main className="commerce-main"><div className="commerce-empty"><strong>Store not found</strong><p>This seller may no longer be active.</p><Link to="/shop">Back to shop</Link></div></main>;
  const s = data.store;
  return (
    <main className="commerce-main">
      <div className="store-hero"><span>{s.verified ? "VERIFIED SELLER" : "SELLER"} · {s.city}</span><h1>{s.name}</h1><p>{s.description}</p><b>★ {s.rating} seller rating</b></div>
      <div className="catalog-grid store-grid">{data.products.map((p) => <ProductCard key={p.id} product={p} />)}</div>
    </main>
  );
}
