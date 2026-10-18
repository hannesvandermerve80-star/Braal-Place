import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, dateOnly, money, type Product } from "../api";
import { useAuth } from "../context/Auth";
import { useCart } from "../context/Cart";
import { useToast } from "../context/Toast";
import { useWishlist } from "../context/Wishlist";
import { useFetch, useTitle } from "../hooks";
import Icon from "../components/Icon";
import ProductCard from "../components/ProductCard";
import SmartImage from "../components/SmartImage";

interface Detail { product: Product; related: Product[]; reviews: { id: number; rating: number; body: string; author: string; createdAt: string }[] }

export default function ProductPage() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { data, error, loading, reload } = useFetch<Detail>(`/catalog/products/${slug}`);
  const { add, busy } = useCart();
  const wish = useWishlist();
  const { user } = useAuth();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [thumb, setThumb] = useState(0);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  useTitle(data?.product.name ?? "Product");

  if (loading && !data) return <main className="commerce-main product-page"><div className="skeleton-card tall" /></main>;
  if (error || !data) {
    return (
      <main className="commerce-main product-page">
        <div className="commerce-empty"><strong>{error?.status === 404 ? "We couldn't find that product" : "Something went wrong"}</strong><p>{error?.message}</p><button onClick={() => nav("/shop")} type="button">Back to shop</button></div>
      </main>
    );
  }
  const p = data.product;
  const saved = wish.has(p.id);
  const eta = new Date(Date.now() + 2 * 86400000).toISOString();
  const maxQty = Math.max(1, Math.min(p.stock, 10));

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post(`/catalog/products/${p.id}/reviews`, { rating, body }); toast("Thanks for your review!"); setBody(""); reload(); }
    catch (err) { toast(err instanceof ApiError ? err.message : "Couldn't save your review"); }
  };

  return (
    <main className="commerce-main product-page">
      <button className="back-link" onClick={() => (window.history.length > 1 ? nav(-1) : nav("/shop"))} type="button"><Icon name="back" /> Back to shop</button>
      <div className="product-detail">
        <div className="detail-gallery">
          <div className="detail-main-image"><SmartImage alt={p.name} src={p.image ?? undefined} /><span>Freshness guaranteed</span></div>
          <div className="detail-thumbs">{[0, 1, 2].map((i) => <button aria-label={`Photo ${i + 1}`} className={thumb === i ? "active" : ""} key={i} onClick={() => setThumb(i)} type="button"><SmartImage alt="" src={p.image ?? undefined} /></button>)}</div>
        </div>
        <div className="detail-copy">
          <span className="detail-category">{p.category}</span><h1>{p.name}</h1>
          <div className="detail-rating"><Icon name="star" size={15} /><strong>{p.rating}</strong><span>{p.reviews} verified reviews</span></div>
          <div className="detail-price"><strong>{money(p.price)}</strong>{p.oldPrice && <del>{money(p.oldPrice)}</del>}<small>VAT included · per {p.unit}</small></div>
          <p className="detail-description">{p.description}</p>
          <div className="seller-line"><span>{p.seller.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span><p>Sold by<strong>{p.seller.name}</strong><small>{p.seller.verified ? "Verified seller" : "Seller"} · {p.seller.rating} rating</small></p><Link className="store-link" to={`/store/${p.seller.slug}`}>View store</Link></div>
          <div className={p.inStock ? "stock-line" : "stock-line out"}><i /><strong>{p.inStock ? (p.lowStock ? "Low stock" : "In stock") : "Out of stock"}</strong>{p.inStock && <span>{p.stock} available</span>}</div>
          <div className="detail-actions">
            <label>Qty<select disabled={!p.inStock} onChange={(e) => setQty(Number(e.target.value))} value={qty}>{Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}</select></label>
            <button disabled={!p.inStock || busy} onClick={() => add(p.id, qty, p.name)} type="button"><Icon name="cart" /> {p.inStock ? "Add to cart" : "Sold out"}</button>
            <button aria-label={saved ? "Remove from wishlist" : "Save to wishlist"} aria-pressed={saved} className={saved ? "save-detail saved" : "save-detail"} onClick={() => wish.toggle(p.id)} type="button"><Icon name="heart" /></button>
          </div>
          <div className="detail-benefits"><div><Icon name="truck" /><p><strong>Chilled delivery</strong><span>Estimated {dateOnly(eta)}</span></p></div><div><Icon name="shield" /><p><strong>Buyer protection</strong><span>Secure checkout and support</span></p></div></div>
        </div>
      </div>

      <section className="reviews-section">
        <div><span>Customer feedback</span><h2>Reviews</h2></div>
        <div className="reviews-grid">
          <div>{data.reviews.length === 0 && <p className="muted">No written reviews yet.</p>}
            {data.reviews.map((r) => <article className="review" key={r.id}><div className="stars" aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}<span>{"★".repeat(5 - r.rating)}</span></div><p>{r.body || "Great product."}</p><small>{r.author}</small></article>)}
          </div>
          {user ? (
            <form className="review-form" onSubmit={submitReview}>
              <strong>Bought this? Leave a review</strong>
              <label>Rating<select onChange={(e) => setRating(Number(e.target.value))} value={rating}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 ? "s" : ""}</option>)}</select></label>
              <textarea maxLength={1000} onChange={(e) => setBody(e.target.value)} placeholder="How was the quality and delivery?" rows={3} value={body} />
              <button type="submit">Submit review</button>
            </form>
          ) : <div className="review-form"><strong>Bought this?</strong><p className="muted"><Link to="/account">Sign in</Link> to leave a review.</p></div>}
        </div>
      </section>

      <section className="related-products"><div><span>You may also like</span><h2>Complete your braai</h2></div><div className="catalog-grid">{data.related.map((r) => <ProductCard key={r.id} product={r} />)}</div></section>
    </main>
  );
}
