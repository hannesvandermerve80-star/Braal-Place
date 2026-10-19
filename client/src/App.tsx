import CheckoutReturn from "./pages/CheckoutReturn";
import Invoice from "./pages/Invoice";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import CommerceLayout from "./components/CommerceLayout";
import Home from "./pages/Home";
import Shop from "./pages/Shop";
import ProductPage from "./pages/Product";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Track, { TrackLookup } from "./pages/Track";
import Account from "./pages/Account";
import SellerApply from "./pages/SellerApply";
import Store from "./pages/Store";
import NotFound from "./pages/NotFound";
import { Contact, ContentPage, Help } from "./pages/Content";
import { useAuth } from "./context/Auth";
import "./styles/extra.css";

const Portal = lazy(() => import("./portal/routes"));
const Fallback = () => <div className="app-loading">Loading…</div>;

export default function App() {
  const { loading } = useAuth();
  if (loading) return <Fallback />;
  return (
    <Routes>
      <Route element={<Home />} path="/" />
      <Route element={<CommerceLayout />}>
        <Route element={<Shop />} path="/shop" />
        <Route element={<ProductPage />} path="/product/:slug" />
        <Route element={<Store />} path="/store/:slug" />
        <Route element={<Cart />} path="/cart" />
        <Route element={<Checkout />} path="/checkout" />
        <Route element={<TrackLookup />} path="/track" />
        <Route element={<Track />} path="/track/:number" />
        <Route element={<CheckoutReturn />} path="/checkout/return/:number" />
        <Route element={<Invoice />} path="/invoice/:number" />
        <Route element={<Account />} path="/account" />
        <Route element={<SellerApply />} path="/sell" />
        <Route element={<Help />} path="/help" />
        <Route element={<Contact />} path="/contact" />
        {["about", "privacy", "terms", "returns", "shipping", "cookies", "seller-guidelines", "seller-fees"].map((p) => <Route element={<ContentPage />} key={p} path={`/${p}`} />)}
        <Route element={<NotFound />} path="*" />
      </Route>
      <Route element={<Suspense fallback={<Fallback />}><Portal /></Suspense>} path="/portal/*" />
      <Route element={<Navigate replace to="/" />} path="/home" />
    </Routes>
  );
}
