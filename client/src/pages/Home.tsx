import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, money, qs, type Category, type Product } from "../api";
import { useAuth } from "../context/Auth";
import { useCart } from "../context/Cart";
import { useWishlist } from "../context/Wishlist";
import { useDebounced, useTitle } from "../hooks";
import Icon from "../components/Icon";
import SmartImage from "../components/SmartImage";
import SiteFooter from "../components/SiteFooter";
import "../styles/index.css";

const TILE_COLORS = ["mint", "sand", "dark", "stone"];
const photo = (id: string, w: number, q = 85) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=${q}`;

function AppButton({ children, variant = "primary", onClick }: { children: React.ReactNode; variant?: "primary" | "secondary" | "light"; onClick?: () => void }) {
  return <button className={`app-button ${variant}`} onClick={onClick} type="button">{children}</button>;
}

export default function Home() {
  useTitle("Premium braai meat, delivered chilled");
  const nav = useNavigate();
  const { user } = useAuth();
  const { cart, add, busy } = useCart();
  const wish = useWishlist();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("all");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [heroProduct, setHeroProduct] = useState<Product | null>(null);
  const debounced = useDebounced(query, 250);

  useEffect(() => { api.get<{ categories: Category[] }>("/catalog/categories").then((r) => setCategories(r.categories)).catch(() => {}); }, []);
  useEffect(() => {
    api.get<{ product: Product }>("/catalog/products/family-braai-box").then((r) => setHeroProduct(r.product)).catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<{ items: Product[] }>(`/catalog/products${qs({ category: active === "all" ? undefined : active, q: debounced, limit: 6, sort: "featured" })}`)
      .then((r) => { if (!cancelled) setProducts(r.items); })
      .catch(() => { if (!cancelled) setProducts([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, debounced]);

  const scrollTo = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); setMenuOpen(false); };
  const shopCategory = (slug: string) => { setActive(slug); setQuery(""); scrollTo("shop"); };

  return (
    <div className="site-shell">
      <header className="topbar">
        <button className="brand" onClick={() => scrollTo("home")} type="button">
          <span className="brand-mark"><Icon name="bag" size={25} /></span>
          <span className="brand-name">Bekies Braai Place</span>
          <span className="brand-dot">.</span>
        </button>

        <nav aria-label="Main navigation" className={menuOpen ? "main-nav open" : "main-nav"}>
          <button className="active" onClick={() => scrollTo("home")} type="button">Home</button>
          <button onClick={() => nav("/shop")} type="button">Shop</button>
          <button onClick={() => nav("/sell")} type="button">Sell on Bekies</button>
          <button onClick={() => scrollTo("story")} type="button">Our story</button>
          <button onClick={() => nav(user ? "/portal" : "/account")} type="button">{user ? "My dashboard" : "Sign in"}</button>
        </nav>

        <form className="search-box" onSubmit={(e) => { e.preventDefault(); nav(`/shop${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`); }} role="search">
          <Icon name="search" size={18} />
          <input aria-label="Search products" onChange={(e) => setQuery(e.target.value)} placeholder="Search meat & groceries" value={query} />
          <kbd>↵ Enter</kbd>
        </form>

        <div className="header-actions">
          <button aria-label={user ? "Open my dashboard" : "Sign in"} className="icon-button" onClick={() => nav(user ? "/portal" : "/account")} type="button"><Icon name="user" /></button>
          <button aria-label={`Cart with ${cart.count} items`} className="icon-button cart-button" onClick={() => nav("/cart")} type="button">
            <Icon name="cart" />
            {cart.count > 0 && <span>{cart.count}</span>}
          </button>
          <button aria-expanded={menuOpen} aria-label="Toggle menu" className="menu-button" onClick={() => setMenuOpen(!menuOpen)} type="button"><Icon name="menu" /></button>
        </div>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-copy">
            <div className="eyebrow"><span>Fresh from the butcher</span><i /><span>Delivered cold</span></div>
            <h1>Everything for a <em>better braai.</em></h1>
            <p className="hero-lede">Premium braai boxes, butcher-cut meat, and a smaller selection of grocery essentials—packed fresh and delivered chilled.</p>
            <div className="hero-actions">
              <AppButton onClick={() => nav("/shop?category=braai-meat")}>Shop braai meat <Icon name="arrow" /></AppButton>
              <AppButton onClick={() => nav("/shop?category=groceries")} variant="secondary">Browse groceries</AppButton>
            </div>
            <div className="trust-row">
              <div className="avatars">
                <img alt="" src={photo("1513872900980-460ea4c87668", 80, 80)} />
                <img alt="" src={photo("1657449899532-02fd5976ed4d", 80, 80)} />
                <img alt="" src={photo("1594679085391-0ea2baba0145", 80, 80)} />
              </div>
              <p><strong>4.9 / 5</strong><span>Trusted by local families</span></p>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-photo">
              <SmartImage alt="Braaied steaks and sausages cooking over hot coals" src={photo("1609534751961-f396ded2af99", 1400, 90)} />
              <div className="photo-label"><Icon name="spark" size={16} /> Butcher’s pick</div>
            </div>
            <div className="floating-card delivery-card">
              <span className="float-icon"><Icon name="truck" size={22} /></span>
              <p><strong>Cold-chain delivery</strong><span>Fresh from us to you</span></p>
            </div>
            <div className="floating-card product-card">
              <img alt="" src={photo("1752154424142-86c9c633cec1", 180, 80)} />
              <p><small>WEEKEND FAVOURITE</small><strong>{heroProduct?.name ?? "Family braai box"}</strong><span>{money(heroProduct?.price ?? 649)}</span></p>
              <button aria-label="View family braai box" onClick={() => nav("/product/family-braai-box")} type="button"><Icon name="chevron" size={18} /></button>
            </div>
            <span className="hero-stamp">BRAAI<br />READY</span>
          </div>
        </section>

        <section aria-label="Marketplace benefits" className="value-strip">
          <div><Icon name="shield" /><p><strong>Quality guaranteed</strong><span>Freshness you can trust</span></p></div>
          <div><Icon name="truck" /><p><strong>Chilled delivery</strong><span>Cold from our fridge to yours</span></p></div>
          <div><Icon name="store" /><p><strong>Expertly selected</strong><span>Premium cuts from trusted butchers</span></p></div>
        </section>

        <section className="shop-section" id="shop">
          <div className="section-heading">
            <div><span className="section-kicker">From trusted local butchers</span><h2>Braai meat favourites</h2></div>
            <button className="text-link" onClick={() => nav("/shop")} type="button">Shop all food <Icon name="arrow" size={18} /></button>
          </div>

          <div aria-label="Product categories" className="category-row">
            <button aria-pressed={active === "all"} className={active === "all" ? "selected" : ""} onClick={() => setActive("all")} type="button">All</button>
            {categories.map((c) => (
              <button aria-pressed={active === c.slug} className={active === c.slug ? "selected" : ""} key={c.slug} onClick={() => setActive(c.slug)} type="button">{c.name}</button>
            ))}
          </div>

          <div aria-busy={loading} className="product-grid">
            {products.map((product, i) => {
              const saved = wish.has(product.id);
              return (
                <article className="product-tile" key={product.id}>
                  <div className={`product-image ${TILE_COLORS[i % 4]}`}>
                    <span className="sale-pill">{product.savings > 0 ? `Save ${money(product.savings)}` : "Fresh pick"}</span>
                    <a href={`/product/${product.slug}`} onClick={(e) => { e.preventDefault(); nav(`/product/${product.slug}`); }}><SmartImage alt={product.name} src={product.image ?? undefined} /></a>
                    <button aria-label={`${saved ? "Remove" : "Add"} ${product.name} ${saved ? "from" : "to"} favorites`} aria-pressed={saved} className={saved ? "favorite active" : "favorite"} onClick={() => wish.toggle(product.id)} type="button"><Icon name="heart" size={18} /></button>
                  </div>
                  <div className="product-info">
                    <span>{product.category}</span>
                    <h3>{product.name}</h3>
                    <div><strong>{money(product.price)}</strong>{product.oldPrice && <del>{money(product.oldPrice)}</del>}</div>
                    <button aria-label={`Add ${product.name} to cart`} disabled={!product.inStock || busy} onClick={() => add(product.id, 1, product.name)} type="button"><Icon name="cart" size={17} /></button>
                  </div>
                </article>
              );
            })}
            {!loading && products.length === 0 && <p className="empty-state">No finds match that search yet. Try another phrase.</p>}
          </div>
        </section>

        <section className="split-cta" id="sell">
          <div className="cta-image"><SmartImage alt="Local butcher standing proudly behind his fresh meat counter" src={photo("1615932726364-a8f79917a65a", 1000)} /></div>
          <div className="cta-copy">
            <span className="section-kicker light">Quality from people who care</span>
            <h2>Proper cuts. Fresh food. <em>Real flavour.</em></h2>
            <p>We work with trusted butchers, growers, and local suppliers to bring you food that is fresh, flavourful, and ready for the fire.</p>
            <ul>
              <li><span>01</span>Hand-selected premium cuts</li>
              <li><span>02</span>Fresh groceries for the whole week</li>
              <li><span>03</span>Carefully packed for chilled delivery</li>
            </ul>
            <AppButton onClick={() => nav("/sell")} variant="light">Apply to sell <Icon name="arrow" /></AppButton>
          </div>
        </section>

        <section className="story-note" id="story">
          <span className="brand-mark"><Icon name="bag" size={24} /></span>
          <p>Great braai meat tastes better when it is shared around the fire.</p>
          <AppButton onClick={() => scrollTo("home")} variant="secondary">Back to top</AppButton>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
