import {
  Boxes,
  ClipboardList,
  Container,
  LayoutDashboard,
  Truck,
  UserCog,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/types";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: Role[]; // who sees this page. The database enforces the same rules (see migration 0005).
};

export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, roles: ["admin", "staff", "warehouse"] },
  { label: "Bookings", href: "/bookings", icon: ClipboardList, roles: ["admin", "staff"] },
  { label: "Pickups", href: "/pickups", icon: Truck, roles: ["admin", "staff", "driver"] },
  { label: "Warehouse Inventory", href: "/warehouse-inventory", icon: Boxes, roles: ["admin", "staff", "warehouse"] },
  { label: "Containers", href: "/containers", icon: Container, roles: ["admin", "staff", "warehouse"] },
  { label: "Accounts", href: "/accounts", icon: Wallet, roles: ["admin", "staff"] },
  { label: "Users", href: "/users", icon: UserCog, roles: ["admin"] },
];

// Pages that are not in the sidebar but need tighter rules than their parent.
const extraRules = [{ prefix: "/warehouse-inventory/split", roles: ["admin", "warehouse"] as Role[] }];

/** Can this role open this path? The longest matching rule wins. */
export function canAccess(role: Role, path: string): boolean {
  const rules = [...navItems.map((i) => ({ prefix: i.href, roles: i.roles })), ...extraRules];
  const matches = rules
    .filter((r) => (r.prefix === "/" ? path === "/" : path === r.prefix || path.startsWith(r.prefix + "/")))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return matches.length > 0 && matches[0].roles.includes(role);
}

/** Landing page for a role (first sidebar item it can see). */
export const homePath = (role: Role) => navItems.find((i) => i.roles.includes(role))?.href ?? "/";

/** Can this role change containers / parcels (vs. read-only)? */
export const canOperateWarehouse = (role: Role) => role === "admin" || role === "warehouse";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  staff: "Office staff",
  driver: "Driver",
  warehouse: "Warehouse worker",
};
