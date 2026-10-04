import {
  Bell,
  Boxes,
  ClipboardList,
  Container,
  History,
  LayoutDashboard,
  MapPinned,
  Settings,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  shortLabel: string; // fits under a phone tab icon
  anyOf: string[]; // the page is available to anyone holding at least one of these permissions
};

// Permission keys live in the database (permissions table). Roles are mapped to them by a super admin,
// so no role names appear in the code.
export const navItems: NavItem[] = [
  { label: "Dashboard", shortLabel: "Home", href: "/", icon: LayoutDashboard, anyOf: ["dashboard.view"] },
  { label: "Bookings", shortLabel: "Bookings", href: "/bookings", icon: ClipboardList, anyOf: ["bookings.view"] },
  { label: "Pickups", shortLabel: "Pickups", href: "/pickups", icon: Truck, anyOf: ["pickups.view_all", "pickups.view_own"] },
  { label: "Warehouse", shortLabel: "Warehouse", href: "/warehouse-inventory", icon: Boxes, anyOf: ["warehouse.view"] },
  { label: "Containers", shortLabel: "Containers", href: "/containers", icon: Container, anyOf: ["containers.view", "containers.manage"] },
  { label: "Tracking", shortLabel: "Tracking", href: "/tracking", icon: MapPinned, anyOf: ["bookings.view", "warehouse.view", "pickups.view_all", "pickups.view_own"] },
  { label: "Accounts", shortLabel: "Accounts", href: "/accounts", icon: Wallet, anyOf: ["accounts.view"] },
  { label: "Activity", shortLabel: "Activity", href: "/activity", icon: History, anyOf: ["activity.view"] },
  { label: "Notifications", shortLabel: "Alerts", href: "/notifications", icon: Bell, anyOf: ["notifications.view"] },
  { label: "Settings", shortLabel: "Settings", href: "/settings", icon: Settings, anyOf: ["settings.manage", "users.manage", "roles.manage"] },
];

// Pages that are not in the sidebar but need tighter rules than their parent.
const extraRules: { prefix: string; anyOf: string[] }[] = [
  { prefix: "/bookings/new", anyOf: ["bookings.create"] },
  // The results page behind the search box in the top bar.
  { prefix: "/search", anyOf: ["bookings.view", "warehouse.view", "containers.view", "pickups.view_all", "pickups.view_own"] },
  { prefix: "/warehouse-inventory/split", anyOf: ["warehouse.manage"] },
  { prefix: "/warehouse-inventory/returns", anyOf: ["warehouse.manage"] },
  { prefix: "/settings/users", anyOf: ["users.manage"] },
  { prefix: "/settings/roles", anyOf: ["roles.manage"] },
];

/** Can someone holding these permissions open this path? The longest matching rule wins. */
export function canAccess(permissions: string[], path: string): boolean {
  const rules = [...navItems.map((i) => ({ prefix: i.href, anyOf: i.anyOf })), ...extraRules];
  const matches = rules
    .filter((r) => (r.prefix === "/" ? path === "/" : path === r.prefix || path.startsWith(r.prefix + "/")))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return matches.length > 0 && matches[0].anyOf.some((p) => permissions.includes(p));
}

/** Landing page: the first sidebar page this user can open. */
export const homePath = (permissions: string[]) =>
  navItems.find((i) => i.anyOf.some((p) => permissions.includes(p)))?.href ?? "/";
