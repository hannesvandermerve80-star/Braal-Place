import { Route, Routes } from "react-router-dom";
import PortalLayout from "./PortalLayout";
import Overview from "./Overview";
import OrdersPage from "./Orders";
import ApplicationsPage from "./Applications";
import { Inventory, Moderation, SellerProducts } from "./Products";
import { Payments, Payouts } from "./Money";
import { AuditLog, Users } from "./Admin";
import { AccountSettings, Addresses, StoreSettings, Support, Wishlist } from "./Account";

export default function PortalRoutes() {
  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route element={<Overview />} index />
        <Route element={<OrdersPage />} path="orders" />
        <Route element={<ApplicationsPage />} path="applications" />
        <Route element={<Moderation />} path="moderation" />
        <Route element={<SellerProducts />} path="products" />
        <Route element={<Inventory />} path="inventory" />
        <Route element={<Payouts />} path="payouts" />
        <Route element={<StoreSettings />} path="store" />
        <Route element={<Payments />} path="payments" />
        <Route element={<Users />} path="users" />
        <Route element={<AuditLog />} path="audit" />
        <Route element={<Support />} path="support" />
        <Route element={<Wishlist />} path="wishlist" />
        <Route element={<Addresses />} path="addresses" />
        <Route element={<AccountSettings />} path="account" />
        <Route element={<Overview />} path="*" />
      </Route>
    </Routes>
  );
}
