import { Link } from "react-router-dom";
import { useTitle } from "../hooks";

export default function NotFound() {
  useTitle("Page not found");
  return (
    <main className="commerce-main"><div className="commerce-empty"><strong>404 — page not found</strong><p>The page you're looking for has moved or doesn't exist.</p><Link className="empty-link" to="/shop">Browse the shop</Link></div></main>
  );
}
