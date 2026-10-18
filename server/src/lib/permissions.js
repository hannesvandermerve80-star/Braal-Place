/**
 * Granular permission grants (see docs/backend-architecture.md).
 * - admin: unrestricted ("*").
 * - manager: only the permissions a Super Admin explicitly grants (stored on the user).
 * - seller / buyer: no platform permissions; they are scoped by store membership / ownership.
 */
export const ALL_PERMISSIONS = [
  "seller.review",
  "product.moderate",
  "orders.manage",
  "payments.view",
  "refund.approve",
  "users.manage",
  "audit.view",
  "support.manage",
];

export const DEFAULT_MANAGER_PERMISSIONS = ["seller.review", "product.moderate", "orders.manage", "support.manage"];

export function permissionsFor(user) {
  if (!user) return [];
  if (user.role === "admin") return ["*"];
  if (user.role === "manager") {
    try {
      const p = typeof user.permissions === "string" ? JSON.parse(user.permissions) : user.permissions;
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

export const hasPermission = (user, perm) => {
  const p = permissionsFor(user);
  return p.includes("*") || p.includes(perm);
};
