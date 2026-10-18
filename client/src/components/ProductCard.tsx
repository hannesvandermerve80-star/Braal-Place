import { Link } from "react-router-dom";
import { money, type Product } from "../api";
import { useCart } from "../context/Cart";
import { useWishlist } from "../context/Wishlist";
import Icon from "./Icon";
import SmartImage from "./SmartImage";

export default function ProductCard({ product }: { product: Product }) {
  const { add, busy } = useCart();
  const wish = useWishlist();
  const saved = wish.has(product.id);
  return (
    <article className="catalog-card">
      <Link className="catalog-image" to={`/product/${product.slug}`}>
        <SmartImage alt={product.name} src={product.image ?? undefined} />
        {product.savings > 0 && <span>Save {money(product.savings)}</span>}
        {!product.inStock && <span className="sold-out">Sold out</span>}
      </Link>
      <button aria-label={saved ? `Remove ${product.name} from favourites` : `Save ${product.name} to favourites`} aria-pressed={saved} className={saved ? "catalog-heart saved" : "catalog-heart"} onClick={() => wish.toggle(product.id)} type="button"><Icon name="heart" size={17} /></button>
      <div className="catalog-info">
        <span>{product.category} · {product.seller.name}</span>
        <Link className="catalog-name" to={`/product/${product.slug}`}>{product.name}</Link>
        <div className="rating"><Icon name="star" size={12} /><strong>{product.rating}</strong><span>({product.reviews})</span></div>
        <div className="catalog-price">
          <strong>{money(product.price)}</strong>{product.oldPrice && <del>{money(product.oldPrice)}</del>}
          <button aria-label={`Add ${product.name} to cart`} disabled={!product.inStock || busy} onClick={() => add(product.id, 1, product.name)} type="button"><Icon name="cart" size={17} /></button>
        </div>
      </div>
    </article>
  );
}
