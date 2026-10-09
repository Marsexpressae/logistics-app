/* eslint-disable @typescript-eslint/no-explicit-any */
// In-browser stand-in for the parts of supabase-js this app uses, so the UI can be tested
// without a backend. Data lives in localStorage. Used automatically when no Supabase keys are set.

import { matchesSearch } from "./search.ts";

type Row = Record<string, any>;
type Db = {
  seq: { booking: number; container: number; invoice: number; ret?: number };
  [table: string]: any;
  drivers: Row[]; warehouses: Row[]; bookings: Row[]; booking_items: Row[]; payments: Row[];
  containers: Row[]; parcels: Row[]; parcel_events: Row[]; profiles: Row[]; audit_log: Row[]; roles: Row[]; permissions: Row[]; role_permissions: Row[];
  booking_events: Row[]; notifications: Row[]; app_settings: Row[]; returns: Row[]; booking_notes: Row[]; client_errors: Row[]; number_series: Row[]; organization: Row[]; customers: Row[]; booking_contacts: Row[]; customer_notes: Row[]; customer_receivers: Row[]; id_documents: Row[];
};

const STORAGE_KEY = "logistics-mock-db-v34";
const AUTH_KEY = "logistics-mock-signed-out";

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const today = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400_000).toISOString().slice(0, 10);
const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

// ---------------------------------------------------------------- roles & permissions (mirrors migration 0009)
const ROLES: Row[] = [
  { key: "super_admin", label: "Super admin", description: "Owner. Full access, including editing roles and permissions.", sort: 1 },
  { key: "manager", label: "Manager", description: "Runs day-to-day operations and can add staff and drivers.", sort: 2 },
  { key: "staff", label: "Office staff", description: "Handles bookings, pickups and accounts.", sort: 3 },
  { key: "warehouse", label: "Warehouse worker", description: "Receives, splits and ships parcels.", sort: 4 },
  { key: "driver", label: "Driver", description: "Sees and completes only their own pickups.", sort: 5 },
  { key: "accounts", label: "Accounts", description: "Sees invoices and customers and records payments. Cannot change bookings, pickups, the warehouse or containers.", sort: 6 },
];
const PERMISSIONS: Row[] = [
  ["dashboard.view", "General", "View dashboard", "See the dashboard counts"],
  ["bookings.view", "Bookings", "View bookings", "See the bookings list and details"],
  ["bookings.create", "Bookings", "Create bookings", "Add new bookings"],
  ["bookings.edit", "Bookings", "Edit bookings", "Change booking details, driver, bill and invoice amount"],
  ["bookings.cancel", "Bookings", "Cancel bookings", "Cancel a booking (a reason is required)"],
  ["bookings.delete", "Bookings", "Delete bookings", "Permanently delete a booking"],
  ["pickups.view_all", "Pickups", "View all pickups", "See every drivers pickups"],
  ["pickups.view_own", "Pickups", "View own pickups only", "See only pickups assigned to them (for drivers)"],
  ["pickups.collect", "Pickups", "Record collections", "Add items, log payments and mark pickups collected"],
  ["warehouse.view", "Warehouse", "View warehouse inventory", "See parcels in the warehouses"],
  ["warehouse.manage", "Warehouse", "Receive and split parcels", "Receive bookings, split into parcels, print labels"],
  ["containers.view", "Containers", "View containers", "See containers and their manifests"],
  ["containers.manage", "Containers", "Manage containers", "Create containers, load, depart, arrive and deliver parcels"],
  ["accounts.view", "Accounts", "View accounts", "See invoiced, collected and outstanding amounts"],
  ["payments.manage", "Accounts", "Edit or delete payments", "Correct or remove recorded payments"],
  ["drivers.manage", "People", "Manage driver records", "Add, edit or remove driver records"],
  ["users.manage", "People", "Manage users", "Add users, change their role, deactivate, reset passwords"],
  ["roles.manage", "People", "Edit roles and permissions", "Change which role can do what (super admin only by default)"],
  ["activity.view", "People", "View activity log", "See who changed what"],
  ["pickups.edit_contact", "Pickups", "Edit contact numbers", "Correct the call / WhatsApp numbers on pickups they can see"],
  ["notifications.view", "General", "Receive notifications", "See in-app notifications about changes to bookings"],
  ["bookings.reschedule", "Bookings", "Reschedule bookings", "Move a booking to another pickup date (a reason is required)"],
  ["pickups.cancel", "Pickups", "Cancel own pickups", "Cancel a pickup that has not been collected yet (a reason is required)"],
  ["pickups.reschedule", "Pickups", "Reschedule own pickups", "Move a pickup to another date (a reason is required)"],
  ["settings.manage", "People", "Change app settings", "Turn app controls on or off on the Settings page"],
  ["containers.override_departure", "Containers", "Depart with missing parcels", "Send a container even though some parcels of an invoice are not loaded (a reason is recorded on each booking)"],
  ["containers.override_payment", "Containers", "Load without full payment", "Load a parcel even when payment is required and not complete (a reason is recorded)"],
  ["notes.write", "Bookings", "Write notes on jobs", "Add notes to a booking or invoice and mention colleagues"],
  ["customers.view", "Customers", "See customers", "Open the customer list and each customer's history"],
  ["customers.edit", "Customers", "Add and edit customers", "Create customers, correct their details, and link them to bookings"],
  ["documents.print", "General", "Print documents", "Print receipts, return forms, parcel labels and statements"],
  ["customers.id_photo", "Customers", "See and add Emirates ID photos", "Record the Emirates ID and photo at pickup, and see them on the jobs you can open"],
  ["customers.manage", "Customers", "Merge and delete customers", "Merge duplicate customers or delete one (managers)"],
  ["returns.manage", "Warehouse", "Edit or delete returns", "Correct the date, note or receiver of a return, or delete a return (a reason is required)"],
  ["numbers.edit", "Bookings", "Set invoice and booking numbers", "Type a custom invoice or booking number, or change one, for example to match the accounting system"],
  ["items.edit", "Pickups", "Edit package items (before collection)", "Add, change or remove items and weights until the pickup is collected"],
  ["items.edit_after", "Pickups", "Edit package items (after collection)", "Add, change or remove items and weights after the pickup is collected"],
].map(([key, group_name, label, description], i) => ({ key, group_name, label, description, sort: (i + 1) * 10 }));
const GRANTS: Record<string, string[]> = {
  super_admin: PERMISSIONS.map((p) => p.key),
  manager: ["containers.override_payment", "containers.override_departure", "dashboard.view", "bookings.view", "bookings.create", "bookings.edit", "bookings.cancel", "pickups.view_all",
    "pickups.collect", "warehouse.view", "warehouse.manage", "containers.view", "containers.manage", "accounts.view",
    "payments.manage", "drivers.manage", "users.manage", "activity.view", "notifications.view", "bookings.reschedule",
    "items.edit", "items.edit_after", "notes.write", "numbers.edit", "returns.manage", "customers.view", "customers.edit", "customers.manage", "customers.id_photo"],
  staff: ["dashboard.view", "bookings.view", "bookings.create", "bookings.edit", "bookings.cancel", "pickups.view_all",
    "pickups.collect", "warehouse.view", "containers.view", "accounts.view", "notifications.view", "bookings.reschedule", "items.edit", "items.edit_after", "notes.write", "customers.view", "customers.edit", "customers.id_photo"],
  accounts: ["dashboard.view", "notifications.view", "bookings.view", "customers.view", "accounts.view", "payments.manage"],
  warehouse: ["dashboard.view", "warehouse.view", "warehouse.manage", "containers.view", "containers.manage", "notifications.view", "notes.write"],
  driver: ["pickups.view_own", "pickups.collect", "pickups.cancel", "pickups.reschedule", "notifications.view", "pickups.edit_contact", "items.edit", "notes.write", "customers.id_photo"],
};
// Printing is allowed for every role until a super admin removes it (like migration 0043).
for (const role of Object.keys(GRANTS)) if (!GRANTS[role].includes("documents.print")) GRANTS[role].push("documents.print");
const ROLE_PERMISSIONS: Row[] = Object.entries(GRANTS).flatMap(([role, perms]) => perms.map((permission) => ({ role, permission })));

// ---------------------------------------------------------------- seed data
function seed(): Db {
  const wA = { id: uid(), code: "A", name: "Warehouse A" };
  const wB = { id: uid(), code: "B", name: "Warehouse B" };
  const d1 = { id: uid(), name: "Ahmed Khan", phone: "+971 50 111 2222", user_id: null, active: true };
  const d2 = { id: uid(), name: "Bilal Hussain", phone: "+971 50 333 4444", user_id: null, active: true };

  const base = { sender_whatsapp: null, receiver_whatsapp: null, updated_at: ago(1), receiver_phone: null, notes: null, collected_at: null, cancellation_reason: null, cancelled_at: null, geo_lat: null, geo_lng: null };
  const b1 = { ...base, id: uid(), code: "BK-1001", sender_name: "Sara Ali", sender_phone: "+971551002000",
    receiver_name: "Omar Ali", receiver_phone: "+923001234567", receiver_address: "House 12, Gulberg, Lahore",
    pickup_area: "Dubai", pickup_date: today(0), geo_lat: 25.1124, geo_lng: 55.1986, pickup_address: "Villa 5, Al Barsha 1, Dubai", driver_id: d1.id, status: "booked",
    estimated_bill: 450, invoice_amount: null, created_at: ago(5) };
  const b2 = { ...base, id: uid(), code: "BK-1002", sender_name: "John Mathew", sender_phone: "+971562223000", sender_whatsapp: "+971509998877",
    receiver_name: "Mary Mathew", receiver_address: "Kochi, Kerala", pickup_area: "Dubai", pickup_date: today(-1), pickup_address: "Apt 804, Marina Tower, Dubai",
    driver_id: d2.id, status: "collected", estimated_bill: 800, invoice_amount: 800, invoice_no: "INV-1001",
    created_at: ago(30), collected_at: ago(3) };
  const b3 = { ...base, id: uid(), code: "BK-1003", sender_name: "Fatima Noor", sender_phone: "+971524005000",
    receiver_name: "Hamza Noor", receiver_address: "Block 7, Karachi", pickup_area: "Dubai", pickup_date: today(-2), pickup_address: "Shop 3, Deira, Dubai",
    driver_id: d1.id, status: "at_warehouse", estimated_bill: 600, invoice_amount: 600, invoice_no: "INV-1002",
    created_at: ago(60), collected_at: ago(48) };
  const b4 = { ...base, id: uid(), code: "BK-1004", sender_name: "Ravi Kumar", sender_phone: "+971506007000",
    receiver_name: "Anita Kumar", receiver_address: "Chennai, Tamil Nadu", pickup_area: "Sharjah", pickup_date: today(-4), pickup_address: "Warehouse St 9, Sharjah",
    driver_id: d2.id, status: "at_warehouse", estimated_bill: 300, invoice_amount: null, invoice_no: "INV-1003",
    created_at: ago(120), collected_at: ago(100) };

  const c1 = { id: uid(), code: "CN-101", destination: "Karachi", status: "departed", departed_at: ago(20), created_at: ago(90) };
  const c2 = { id: uid(), code: "CN-102", destination: "Lahore", status: "loading", departed_at: null, created_at: ago(2) };

  const parcel = (b: Row, seq: number, description: string, kg: number, status: string, w: Row | null, c: Row | null): Row => ({
    id: uid(), booking_id: b.id, seq, barcode: `${b.code}-P${seq}`, description, weight_kg: kg, status,
    warehouse_id: w?.id ?? null, container_id: c?.id ?? null, updated_at: ago(10),
  });
  const parcels = [
    parcel(b3, 1, "Clothes", 18, "in_warehouse", wA, null),
    parcel(b3, 2, "Kitchenware", 22, "in_warehouse", wB, null),
    parcel(b4, 1, "Electronics", 15, "in_transit", wA, c1),
  ];

  const events: Row[] = [];
  for (const p of parcels) {
    events.push({ id: uid(), parcel_id: p.id, status: "in_warehouse", created_at: ago(40) });
    if (p.status === "in_transit") {
      events.push({ id: uid(), parcel_id: p.id, status: "loaded", created_at: ago(24) });
      events.push({ id: uid(), parcel_id: p.id, status: "in_transit", created_at: ago(20) });
    }
  }

  return buildCustomers({
    seq: { booking: 1005, container: 103, invoice: 1004 },
    drivers: [d1, d2],
    warehouses: [wA, wB],
    bookings: [b1, b2, b3, b4],
    booking_items: [
      { id: uid(), booking_id: b2.id, description: "Suitcase", quantity: 2, weight_kg: 20 },
      { id: uid(), booking_id: b2.id, description: "Carton box", quantity: 1, weight_kg: 15 },
      { id: uid(), booking_id: b3.id, description: "Mixed goods", quantity: 2, weight_kg: 20 },
    ],
    payments: [
      { id: uid(), booking_id: b2.id, invoice_no: "INV-1001", amount: 400, method: "bank_transfer", received_by_driver: d2.id, note: null, created_at: ago(3) },
      { id: uid(), booking_id: b3.id, invoice_no: "INV-1002", amount: 600, method: "cash", received_by_driver: d1.id, note: null, created_at: ago(48) },
    ],
    containers: [c1, c2],
    parcels,
    parcel_events: events,
    audit_log: [],
    booking_events: [],
    returns: [],
    booking_notes: [],
    client_errors: [],
    organization: [{ id: uid(), legal_name: "", currency: "AED", country: "United Arab Emirates", updated_at: now() }],
    number_series: [
      { kind: "booking", label: "Booking numbers", sort: 10, prefix: "BK-", next_number: 1005, lookup_table: "bookings", lookup_column: "code" },
      { kind: "invoice", label: "Invoice numbers", sort: 20, prefix: "INV-", next_number: 1004, lookup_table: "bookings", lookup_column: "invoice_no" },
      { kind: "return", label: "Return numbers", sort: 30, prefix: "RT-", next_number: 1001, lookup_table: "returns", lookup_column: "code" },
      { kind: "container", label: "Container numbers", sort: 40, prefix: "CN-", next_number: 103, lookup_table: "containers", lookup_column: "code" },
    ],
    app_settings: [{ key: "require_payment_before_loading", value: false, label: "Require payment before loading into a container",
      description: "When on, a parcel can only be loaded if its booking has an invoice amount and it is paid in full. People with \"Load without full payment\" can override it with a reason.", updated_at: now() },
    { key: "require_id_before_collected", value: false, label: "Require the Emirates ID before marking a pickup collected",
      description: "When on, the driver must enter the customer's Emirates ID number before a pickup can be marked collected.", updated_at: now() },
    { key: "show_tracking_menu", value: true, label: "Show Tracking in the menu",
      description: "When off, the Tracking link is hidden from the left menu for everyone. The page itself still works if someone opens its address.", updated_at: now() }],
    notifications: [],
    profiles: [
      { id: "mock-user", full_name: "Tester (super admin)", role: "super_admin", active: true, email: "tester@example.test" },
      { id: "sample-manager", full_name: "Mona Manager", role: "manager", active: true, email: "mona@example.test" },
      { id: "sample-staff", full_name: "Sam Staff", role: "staff", active: true, email: "sam@example.test" },
      { id: "sample-driver", full_name: "Dan Driver", role: "driver", active: true, email: "dan@example.test" },
      { id: "sample-warehouse", full_name: "Wendy Warehouse", role: "warehouse", active: false, email: "wendy@example.test" },
    ],
    roles: ROLES,
    permissions: PERMISSIONS,
    role_permissions: ROLE_PERMISSIONS,
    customers: [], booking_contacts: [], customer_notes: [], customer_receivers: [], id_documents: [],
  } as Db);
}

// Like the database migration: one customer per distinct sender phone (or name), linked to each of their bookings.
function buildCustomers(d: Db): Db {
  for (const b of d.bookings) {
    const key = b.sender_phone ?? `name:${String(b.sender_name).toLowerCase()}`;
    let c = d.customers.find((x: Row) => x.key === key);
    if (!c) {
      c = { id: uid(), key, full_name: b.sender_name, phone: b.sender_phone ?? null, whatsapp: b.sender_whatsapp ?? null, address: b.pickup_address, geo_lat: b.geo_lat ?? null, geo_lng: b.geo_lng ?? null,
        emirates_id: null, warning_note: null, created_by_name: null, created_at: b.created_at, updated_at: b.created_at };
      d.customers.push(c);
    }
    d.booking_contacts.push({ booking_id: b.id, role: "customer", customer_id: c.id, created_at: b.created_at });
  }
  return d;
}

// ---------------------------------------------------------------- storage
let memory: Db | null = null;

function db(): Db {
  if (memory) return memory;
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return (memory = JSON.parse(raw));
    } catch {}
  }
  memory = seed();
  save();
  return memory;
}

function save() {
  if (typeof window === "undefined" || !memory) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {}
}

export function resetMockData() {
  memory = seed();
  save();
  location.reload();
}

// A short warehouse code: typed, or the first letters of the words ("Tarpal 2" gives T2), made unique.
function warehouseCode(name: string, typed: string | null, ignore: string | null): string {
  const d = db();
  let base = String(typed ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!base) {
    base = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).map((w) => (/^[0-9]+$/.test(w) ? w : w[0].toUpperCase())).join("");
  }
  base = base.slice(0, 6);
  if (!base) return "";
  let candidate = base;
  for (let n = 2; d.warehouses.some((w) => w.id !== ignore && w.code.toUpperCase() === candidate); n++) candidate = base.slice(0, 6 - String(n).length) + n;
  return candidate;
}

// ---------------------------------------------------------------- numbering (mirrors the database: series, typed numbers, uniqueness)
const NUMBER_RE = /^[A-Z0-9][A-Z0-9._/-]{0,39}$/;
function takeNumber(kind: string): string {
  const d = db();
  const s = d.number_series.find((x) => x.kind === kind)!;
  const used = (d as unknown as Record<string, Row[]>)[s.lookup_table as string] ?? [];
  for (;;) {
    const candidate = `${s.prefix}${s.next_number++}`;
    if (!used.some((r) => r[s.lookup_column as string] === candidate)) return candidate;
  }
}
const duplicate = (column: "code" | "invoice_no") => ({ message: `duplicate key value violates unique constraint "bookings_${column}_key"`, code: "23505" });
/** Checks a typed booking number or invoice number. Returns an error, or null when it is fine. */
function checkNumbers(row: Row, old: Row | null): { message: string; code?: string } | null {
  const d = db();
  if (typeof row.code === "string") row.code = row.code.trim().toUpperCase();
  if (typeof row.invoice_no === "string") row.invoice_no = row.invoice_no.trim().toUpperCase() || null;
  if (old && old.invoice_no && !row.invoice_no) return { message: "An invoice number cannot be removed" };
  const prefixOf = (kind: string) => String(d.number_series.find((x) => x.kind === kind)?.prefix ?? "");
  if (row.code && row.code !== old?.code && prefixOf("booking") && !String(row.code).startsWith(prefixOf("booking"))) return { message: `The booking number must start with ${prefixOf("booking")} (the prefix is set in Settings)` };
  if (row.invoice_no && row.invoice_no !== old?.invoice_no && prefixOf("invoice") && !String(row.invoice_no).startsWith(prefixOf("invoice"))) return { message: `The invoice number must start with ${prefixOf("invoice")} (the prefix is set in Settings)` };
  if (row.code && row.code !== old?.code) {
    if (!NUMBER_RE.test(row.code)) return { message: "Use letters, numbers, dashes or slashes for the booking number, for example BK-1050" };
    if (old && d.parcels.some((p) => p.booking_id === old.id)) return { message: "The booking number cannot change once parcels exist, because their labels carry it" };
    if (d.bookings.some((b) => b !== old && b.code === row.code)) return duplicate("code");
  }
  if (row.invoice_no && row.invoice_no !== old?.invoice_no) {
    if (!NUMBER_RE.test(row.invoice_no)) return { message: "Use letters, numbers, dashes or slashes for the invoice number, for example INV-3603" };
    if (d.bookings.some((b) => b !== old && b.invoice_no === row.invoice_no)) return duplicate("invoice_no");
  }
  return null;
}

// ---------------------------------------------------------------- relations used in select("... alias:table(cols)")
const RELATIONS: Record<string, { fk: string; kind: "one" | "many"; from?: string }> = {
  "bookings.drivers": { kind: "one", fk: "driver_id" },
  "bookings.payments": { kind: "many", fk: "booking_id" },
  "parcels.warehouses": { kind: "one", fk: "warehouse_id" },
  "parcels.bookings": { kind: "one", fk: "booking_id" },
  "containers.parcels": { kind: "many", fk: "container_id" },
  "returns.bookings": { kind: "one", fk: "booking_id" },
  "booking_contacts.customers": { kind: "one", fk: "customer_id" },
  "booking_contacts.bookings": { kind: "one", fk: "booking_id" },
  "returns.parcels": { kind: "many", fk: "return_id" },
};

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function project(table: string, row: Row, select: string): Row {
  const out: Row = {};
  for (const part of splitTopLevel(select)) {
    if (part === "*") { Object.assign(out, row); continue; }
    const m = part.match(/^(?:(\w+):)?(\w+)\((.*)\)$/);
    if (!m) { out[part] = row[part]; continue; }
    const [, alias, target, cols] = m;
    const rel = RELATIONS[`${table}.${target}`];
    if (!rel) continue;
    if (rel.kind === "one") {
      const found = (db()[target] as Row[]).find((r) => r.id === row[rel.fk]);
      out[alias ?? target] = found ? project(target, found, cols) : null;
    } else {
      const children = (db()[target] as Row[]).filter((r) => r[rel.fk] === row.id);
      out[alias ?? target] = cols === "count" ? [{ count: children.length }] : children.map((c) => project(target, c, cols));
    }
  }
  return out;
}

// ---------------------------------------------------------------- query builder
type Filter = (r: Row) => boolean;

class Query implements PromiseLike<any> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private selectStr = "*";
  private returning = false;
  private mode: "many" | "single" | "maybe" = "many";
  private head = false;
  private wantCount = false;
  private payload: any;
  private limitN: number | undefined;

  constructor(private table: string) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    this.selectStr = cols;
    if (this.op !== "select") this.returning = true;
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(v: any) { this.op = "insert"; this.payload = v; return this; }
  update(v: any) { this.op = "update"; this.payload = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, v: any) { this.filters.push((r) => r[col] === v); return this; }
  neq(col: string, v: any) { this.filters.push((r) => r[col] !== v); return this; }
  is(col: string, v: any) { this.filters.push((r) => (r[col] ?? null) === v); return this; }
  not(col: string, op: string, v: any) { this.filters.push((r) => (op === "is" ? (r[col] ?? null) !== v : r[col] !== v)); return this; }
  limit(n: number) { this.limitN = n; return this; }
  in(col: string, vs: any[]) { this.filters.push((r) => vs.includes(r[col])); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending ?? true }); return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  then<R1 = any, R2 = never>(ok?: ((v: any) => R1 | PromiseLike<R1>) | null, fail?: ((e: any) => R2 | PromiseLike<R2>) | null) {
    return new Promise((resolve) => setTimeout(() => resolve(this.run()), 60)).then(ok, fail);
  }

  private run() {
    const tableRows: Row[] = db()[this.table];
    if (!tableRows) return { data: null, error: { message: `Unknown table ${this.table}` }, count: null };
    let rows: Row[] = [];

    if (this.op === "insert") {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload];
      rows = items.map((it: Row) => withDefaults(this.table, it));
      if (this.table === "bookings") {
        for (const r of rows) {
          const err = checkNumbers(r, null);
          if (err) return { data: null, error: err, count: null };
        }
      }
      if (this.table === "payments") {
        for (const r of rows) if (typeof r.created_at === "string" && Date.parse(r.created_at) > Date.now() + 5 * 60_000) return { data: null, error: { message: "The payment date cannot be in the future" }, count: null };
      }
      if (this.table === "containers") {
        for (const r of rows) {
          if (!NUMBER_RE.test(r.code)) return { data: null, error: { message: "Use letters, numbers, dashes or slashes for the container number, for example 38 or CN-120" }, count: null };
          if (tableRows.some((x) => x.code === r.code)) return { data: null, error: { message: 'duplicate key value violates unique constraint "containers_code_key"', code: "23505" }, count: null };
        }
      }
      tableRows.push(...rows);
    } else {
      const matched = tableRows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") {
        // bookings carry a version stamp, bumped on every update (like the database trigger)
        if (this.table === "bookings") {
          for (const r of matched) {
            const err = checkNumbers({ ...r, ...this.payload }, r);
            if (err) return { data: null, error: err, count: null };
            const dbx = db();
            if (this.payload.status === "collected" && r.status !== "collected" && dbx.app_settings.find((x: Row) => x.key === "require_id_before_collected")?.value === true
              && !dbx.id_documents.some((x: Row) => x.booking_id === r.id && x.emirates_id)) {
              return { data: null, error: { message: "Enter the customer's Emirates ID before marking this pickup collected" }, count: null };
            }
          }
        }
        if (this.table === "bookings" && typeof this.payload.collected_at === "string" && Date.parse(this.payload.collected_at) > Date.now() + 5 * 60_000)
          return { data: null, error: { message: "The collection date cannot be in the future" }, count: null };
        if (this.table === "payments" && typeof this.payload.created_at === "string" && Date.parse(this.payload.created_at) > Date.now() + 5 * 60_000)
          return { data: null, error: { message: "The payment date cannot be in the future" }, count: null };
        if (this.table === "containers" && typeof this.payload.code === "string") {
          const code = this.payload.code.trim().toUpperCase();
          if (!NUMBER_RE.test(code)) return { data: null, error: { message: "Use letters, numbers, dashes or slashes for the container number, for example 38 or CN-120" }, count: null };
          if (tableRows.some((x) => x.code === code && !matched.includes(x))) return { data: null, error: { message: 'duplicate key value violates unique constraint "containers_code_key"', code: "23505" }, count: null };
          this.payload.code = code;
        }
        matched.forEach((r) => {
          const before = r.invoice_no;
          Object.assign(r, this.payload, this.table === "bookings" ? { updated_at: now() } : {});
          if (this.table === "bookings") {
            if (typeof r.code === "string") r.code = r.code.trim().toUpperCase();
            if (typeof r.invoice_no === "string") r.invoice_no = r.invoice_no.trim().toUpperCase();
            // Collecting a pickup issues the invoice number.
            if (["collected", "at_warehouse"].includes(r.status) && !r.invoice_no) r.invoice_no = takeNumber("invoice");
            // Payments follow the invoice number.
            if (r.invoice_no !== before) db().payments.filter((p) => p.booking_id === r.id).forEach((p) => (p.invoice_no = r.invoice_no));
          }
        });
        rows = matched;
      } else if (this.op === "delete") {
        db()[this.table] = tableRows.filter((r) => !matched.includes(r));
      } else rows = matched;
    }
    if (this.op !== "select") save();

    for (const { col, asc } of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
    }

    const count = this.wantCount ? rows.length : null;
    if (this.limitN !== undefined) rows = rows.slice(0, this.limitN);
    if (this.head) return { data: null, error: null, count };
    if (this.op === "update" || this.op === "delete" || this.op === "insert") {
      if (!this.returning) return { data: null, error: null, count };
    }

    const out = rows.map((r) => project(this.table, r, this.selectStr));
    if (this.mode === "many") return { data: out, error: null, count };
    if (out.length !== 1) {
      if (this.mode === "maybe" && out.length === 0) return { data: null, error: null, count };
      return { data: null, error: { code: "PGRST116", message: "No matching row found" }, count };
    }
    return { data: out[0], error: null, count };
  }
}

function withDefaults(table: string, it: Row): Row {
  const d = db();
  const row: Row = { id: uid(), ...it };
  switch (table) {
    case "bookings":
      Object.assign(row, {
        code: takeNumber("booking"), status: "booked", estimated_bill: null, invoice_amount: null, invoice_no: null,
        sender_phone: null, receiver_phone: null, receiver_address: null, notes: null,
        driver_id: null, collected_at: null, cancellation_reason: null, cancelled_at: null,
        geo_lat: null, geo_lng: null, created_at: now(), updated_at: now(), ...stripNull(it),
      });
      {
        const phone = /^\+[1-9]\d{6,14}$/.test(row.sender_phone ?? "") ? row.sender_phone : null;
        let cu = phone ? d.customers.find((x) => x.phone === phone) : undefined;
        if (!cu) {
          cu = { id: uid(), full_name: String(row.sender_name ?? "").trim().slice(0, 120), phone, whatsapp: row.sender_whatsapp && row.sender_whatsapp !== phone ? row.sender_whatsapp : null,
            address: /^legacy invoice/i.test(row.pickup_address ?? "") ? null : (row.pickup_address ?? null), geo_lat: row.geo_lat ?? null, geo_lng: row.geo_lng ?? null,
            emirates_id: null, warning_note: null, created_by_name: "Tester (super admin)", created_at: now(), updated_at: now() };
          d.customers.push(cu);
        }
        d.booking_contacts.push({ booking_id: row.id, role: "customer", customer_id: cu.id, created_at: now() });
      }
      break;
    case "containers":
      Object.assign(row, { code: typeof it.code === "string" && it.code.trim() ? it.code.trim().toUpperCase() : takeNumber("container"), status: "loading", departed_at: null, arrived_at: null, created_at: now(), ...it });
      if (typeof it.code === "string" && it.code.trim()) row.code = it.code.trim().toUpperCase();
      break;
    case "id_documents": {
      let eid: string | null = null;
      try { eid = cleanEid(it.emirates_id); } catch { eid = it.emirates_id ?? null; }
      Object.assign(row, { emirates_id: eid, photo_path: it.photo_path ?? null, uploaded_by_name: "Tester (super admin)", created_at: now() });
      if (eid) {
        for (const l of d.booking_contacts.filter((x) => x.booking_id === it.booking_id && x.role === "customer")) {
          const cu = d.customers.find((x) => x.id === l.customer_id);
          if (cu && !cu.emirates_id) cu.emirates_id = eid;
        }
      }
      break;
    }
    case "customer_notes":
      Object.assign(row, { author_id: "mock-user", author_name: "Tester (super admin)", created_at: now() });
      break;
    case "booking_notes":
      Object.assign(row, { author_id: "mock-user", author_name: "Tester (super admin)", mentions: it.mentions ?? [], created_at: now() });
      // Like the database: each mentioned colleague gets a notification (in sample data these go to people who are not signed in).
      for (const m of row.mentions) {
        const bk = d.bookings.find((x) => x.id === it.booking_id);
        d.notifications.push({ id: uid(), user_id: m, booking_id: it.booking_id, kind: "note_mention",
          title: `${row.author_name} mentioned you on ${bk?.invoice_no ?? bk?.code}`, body: String(it.body).slice(0, 160),
          actor_name: row.author_name, created_at: now(), read_at: null });
      }
      break;
    case "payments": {
      // A payment is recorded against the invoice; the first payment issues it if the booking has none yet.
      const bk = d.bookings.find((x) => x.id === it.booking_id);
      if (bk && !bk.invoice_no) bk.invoice_no = takeNumber("invoice");
      Object.assign(row, { created_at: now(), invoice_no: bk?.invoice_no ?? null });
      if (typeof it.created_at === "string") row.created_at = it.created_at;
      break;
    }
  }
  return row;
}
const stripNull = (o: Row) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

// ---------------------------------------------------------------- RPC (mirrors the SQL functions)
function setParcelStatus(p: Row, status: string) {
  p.status = status;
  p.updated_at = now();
  db().parcel_events.push({ id: uid(), parcel_id: p.id, status, created_at: now() });
}

// A typed day becomes noon on that day (never in the future); the parcel history then shows that day.
function eventTime(date: string | null | undefined): string | null {
  if (!date) return null;
  if (date > now().slice(0, 10)) throw new Error("The date cannot be in the future");
  return `${date}T12:00:00.000Z`;
}
function backdate(parcelIds: string[], status: string, ts: string | null) {
  if (!ts) return;
  const d = db();
  d.parcel_events.filter((e) => parcelIds.includes(e.parcel_id) && e.status === status).forEach((e) => (e.created_at = ts));
}

const fail = (message: string) => ({ data: null, error: { message } });

const EID_ERROR = "An Emirates ID has 15 digits and starts with 784, for example 784-1990-1234567-1";
function cleanEid(v: unknown): string | null {
  const dg = String(v ?? "").replace(/\D/g, "");
  if (!dg) return null;
  if (!/^784\d{12}$/.test(dg)) throw new Error(EID_ERROR);
  return `${dg.slice(0, 3)}-${dg.slice(3, 7)}-${dg.slice(7, 14)}-${dg.slice(14)}`;
}
function cleanPhone(v: unknown, what: string): string | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const n = t.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(n)) throw new Error(`Enter the ${what} in international format, for example +971567375716`);
  return n;
}
const linkedBookings = (customerId: string) => {
  const d = db();
  return d.booking_contacts.filter((l) => l.customer_id === customerId).map((l) => d.bookings.find((b) => b.id === l.booking_id)).filter(Boolean) as Row[];
};
function customerRow(c: Row): Row {
  const bs = linkedBookings(c.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return { id: c.id, full_name: c.full_name, phone: c.phone, whatsapp: c.whatsapp, address: c.address, geo_lat: c.geo_lat, geo_lng: c.geo_lng, emirates_id: c.emirates_id,
    invoices: bs.length, last_invoice: bs[0] ? (bs[0].invoice_no ?? bs[0].code) : null };
}
function customerHits(q: string): Row[] {
  return db().customers
    .filter((c) => matchesSearch(q, [c.full_name, c.address, c.emirates_id, ...linkedBookings(c.id).flatMap((b) => [b.invoice_no, b.code])], [c.phone, c.whatsapp]))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
function customerArgs(a: Row): Row {
  const nm = String(a.p_name ?? "").trim();
  if (nm.length < 1 || nm.length > 120) throw new Error("Enter the name");
  const phone = cleanPhone(a.p_phone, "phone number");
  const wa = cleanPhone(a.p_whatsapp, "WhatsApp number");
  return { full_name: nm, phone, whatsapp: wa && wa !== phone ? wa : null, address: String(a.p_address ?? "").trim() || null,
    geo_lat: a.p_lat ?? null, geo_lng: a.p_lng ?? null, emirates_id: cleanEid(a.p_eid) };
}

const PHONE_FIELDS = (b: Row) => [b.sender_phone, b.sender_whatsapp, b.receiver_phone, b.receiver_whatsapp];

// Mirrors the database: keep a history row, and tell the other party. Offline there is only one user, so the
// notification goes to that user, which lets the notification screens be tried without a second account.
function recordChange(b: Row, kind: string, reason: string, oldDate: string | null, newDate: string | null, title: string, body: string) {
  const d = db();
  d.booking_events.push({ id: uid(), booking_id: b.id, kind, reason, old_date: oldDate, new_date: newDate, actor_name: "You (sample data)", created_at: now() });
  d.notifications.push({ id: uid(), user_id: "mock-user", booking_id: b.id, kind, title, body, actor_name: "Sample teammate", created_at: now(), read_at: null });
}

const RPC: Record<string, (a: any) => { data: any; error: { message: string } | null }> = {
  split_booking({ p_booking_id, p_warehouse_id, p_parcels, p_date }) {
    const d = db();
    const b = d.bookings.find((x) => x.id === p_booking_id);
    if (!b) return fail("Booking not found");
    if (!["collected", "at_warehouse"].includes(b.status)) return fail(`Booking ${b.code} has not been collected yet`);
    if (!p_parcels.length) return fail("Add at least one parcel");
    if (d.parcels.some((p) => p.booking_id === b.id && p.status !== "in_warehouse"))
      return fail(`Some parcels of ${b.code} have already left the warehouse; cannot re-split`);

    if (p_parcels.some((p: Row) => Number(p.weight_kg ?? 0) < 0)) return fail("A parcel weight cannot be negative");
    let ts: string | null;
    try { ts = eventTime(p_date); } catch (e) { return fail((e as Error).message); }
    if (ts && b.collected_at && ts.slice(0, 10) < String(b.collected_at).slice(0, 10)) return fail(`Received cannot be before the collection date (${String(b.collected_at).slice(0, 10)})`);

    // Repacking keeps history: the old parcels are marked repacked, the new ones get the next round and new barcodes.
    const mine = d.parcels.filter((p) => p.booking_id === b.id);
    const round = Math.max(0, ...mine.map((p) => p.round ?? 1)) + 1;
    const lastSeq = Math.max(0, ...mine.map((p) => p.seq));
    mine.filter((p) => p.status === "in_warehouse").forEach((p) => {
      p.container_id = null;
      setParcelStatus(p, "repacked");
    });

    p_parcels.forEach((p: Row, i: number) => {
      const barcode = round === 1 ? `${b.code}-P${i + 1}` : `${b.code}-R${round}-P${i + 1}`;
      const row = { id: uid(), booking_id: b.id, seq: lastSeq + i + 1, round, barcode, description: p.description || null,
        weight_kg: p.weight_kg ?? 0, status: "in_warehouse", warehouse_id: p_warehouse_id, container_id: null, updated_at: now() };
      d.parcels.push(row);
      d.parcel_events.push({ id: uid(), parcel_id: row.id, status: "in_warehouse", created_at: now() });
    });
    b.status = "at_warehouse";
    if (ts) {
      const ids = d.parcels.filter((p) => p.booking_id === b.id).map((p) => p.id);
      const fresh = d.parcels.filter((p) => p.booking_id === b.id && p.round === round).map((p) => p.id);
      backdate(fresh, "in_warehouse", ts);
      backdate(ids.filter((i) => !fresh.includes(i)), "repacked", new Date(new Date(ts).getTime() - 60000).toISOString());
    }
    save();
    return { data: p_parcels.length, error: null };
  },

  load_parcel({ p_container_id, p_barcode, p_override_reason, p_date }) {
    const d = db();
    const c = d.containers.find((x) => x.id === p_container_id);
    if (!c) return fail("Container not found");
    if (c.status !== "loading") return fail(`Container ${c.code} has already departed`);
    const p = d.parcels.find((x) => x.barcode === p_barcode.trim().toUpperCase());
    if (!p) return fail(`No parcel with barcode ${p_barcode}`);
    if (p.status === "repacked") return fail(`Parcel ${p.barcode} was repacked. Scan the new label instead.`);
    if (p.status !== "in_warehouse") return fail(`Parcel ${p.barcode} is not in a warehouse (status: ${p.status})`);
    if (d.app_settings.find((s) => s.key === "require_payment_before_loading")?.value === true) {
      const b = d.bookings.find((x) => x.id === p.booking_id)!;
      const paid = d.payments.filter((x) => x.booking_id === b.id).reduce((s, x) => s + Number(x.amount), 0);
      if (b.invoice_amount === null || paid < Number(b.invoice_amount)) {
        if (!String(p_override_reason ?? "").trim())
          return fail(`PAYMENT_REQUIRED ${b.code} : ${b.invoice_amount === null ? "no invoice amount is set yet" : `paid ${paid} of ${b.invoice_amount}`}`);
        d.booking_events.push({ id: uid(), booking_id: b.id, kind: "loaded_without_payment", reason: `${String(p_override_reason).trim()} (${p.barcode} into ${c.code})`,
          old_date: null, new_date: null, actor_name: "You (sample data)", created_at: now() });
      }
    }
    let ts: string | null;
    try { ts = eventTime(p_date); } catch (e) { return fail((e as Error).message); }
    p.container_id = c.id;
    setParcelStatus(p, "loaded");
    if (ts) {
      backdate([p.id], "loaded", ts);
      backdate([p.id], "in_warehouse", new Date(new Date(ts).getTime() - 60000).toISOString()); // the earlier step cannot be later than the loading
    }
    save();
    return { data: p, error: null };
  },

  unload_parcel({ p_parcel_id }) {
    const p = db().parcels.find((x) => x.id === p_parcel_id && x.status === "loaded");
    if (!p) return fail("Parcel cannot be unloaded");
    p.container_id = null;
    setParcelStatus(p, "in_warehouse");
    save();
    return { data: null, error: null };
  },

  prepare_return({ p_booking_id, p_parcel_ids }) {
    const d = db();
    if (!p_parcel_ids?.length) return fail("Select at least one parcel");
    const ps = d.parcels.filter((p) => p_parcel_ids.includes(p.id));
    if (ps.length !== p_parcel_ids.length || ps.some((p) => p.booking_id !== p_booking_id || p.status !== "in_warehouse"))
      return fail("Only parcels of this booking that are in the warehouse can be returned");
    const row = { id: uid(), code: takeNumber("return"), booking_id: p_booking_id, status: "open", note: null, form_date: now().slice(0, 10), created_by_name: "You (sample data)",
      created_at: now(), completed_at: null, completed_by_name: null, received_by_name: null };
    d.returns.push(row);
    ps.forEach((p) => { p.return_id = row.id; setParcelStatus(p, "ready_for_return"); });
    save();
    return { data: row.id, error: null };
  },

  complete_return({ p_return_id, p_received_by }) {
    const d = db();
    const r = d.returns.find((x) => x.id === p_return_id);
    if (!r) return fail("Return not found");
    if (!String(p_received_by ?? "").trim()) return fail("Enter the name of the person who received the parcels");
    if (r.status !== "open") return fail(`This return is already ${r.status}`);
    const ps = d.parcels.filter((p) => p.return_id === r.id && p.status === "ready_for_return");
    ps.forEach((p) => setParcelStatus(p, "returned"));
    Object.assign(r, { status: "completed", completed_at: now(), completed_by_name: "You (sample data)", received_by_name: String(p_received_by).trim() });
    d.booking_events.push({ id: uid(), booking_id: r.booking_id, kind: "returned", reason: `${r.code}: ${ps.length} parcel(s) returned to ${r.received_by_name}`,
      old_date: null, new_date: null, actor_name: "You (sample data)", created_at: now() });
    save();
    return { data: null, error: null };
  },

  delete_booking({ p_booking_id, p_reason, p_with_payments }) {
    const d = db();
    const b = d.bookings.find((x) => x.id === p_booking_id);
    if (!b) return fail("Booking not found");
    if (!String(p_reason ?? "").trim()) return fail("Enter the reason for deleting this booking");
    const name = b.invoice_no ?? b.code;
    if (d.parcels.some((p) => p.booking_id === b.id && ["loaded", "in_transit", "arrived", "delivered"].includes(p.status)))
      return fail(`Some packages of ${name} have shipped (in a container, in transit or delivered), so it cannot be deleted. Cancel it instead, or unload the packages from the container first.`);
    const pays = d.payments.filter((p) => p.booking_id === b.id);
    const total = pays.reduce((s, p) => s + Number(p.amount), 0);
    if (pays.length && !p_with_payments) return fail(`PAYMENTS_EXIST : ${pays.length} payment(s) totalling ${total} are recorded on ${name}`);
    d.audit_log.push({ id: uid(), table_name: "deletion_reason", row_id: b.id, booking_id: b.id, action: "delete", actor_name: "You (sample data)", changed_at: now(),
      changes: { reason: String(p_reason).trim(), booking: b.code, invoice: b.invoice_no ?? null, payments_deleted: pays.length, payments_total: total } });
    const parcelIds = d.parcels.filter((p) => p.booking_id === b.id).map((p) => p.id);
    d.payments = d.payments.filter((p) => p.booking_id !== b.id);
    d.returns = d.returns.filter((r) => r.booking_id !== b.id);
    d.parcel_events = d.parcel_events.filter((e) => !parcelIds.includes(e.parcel_id));
    d.parcels = d.parcels.filter((p) => p.booking_id !== b.id);
    d.booking_items = d.booking_items.filter((i) => i.booking_id !== b.id);
    d.booking_notes = d.booking_notes.filter((n) => n.booking_id !== b.id);
    d.booking_contacts = d.booking_contacts.filter((l) => l.booking_id !== b.id);
    d.id_documents = d.id_documents.filter((x) => x.booking_id !== b.id);
    d.booking_events = d.booking_events.filter((e) => e.booking_id !== b.id);
    d.notifications = d.notifications.filter((n) => n.booking_id !== b.id);
    d.bookings = d.bookings.filter((x) => x !== b);
    save();
    return { data: null, error: null };
  },

  update_return({ p_return_id, p_form_date, p_received_by, p_note }) {
    const r = db().returns.find((x) => x.id === p_return_id);
    if (!r) return fail("Return not found");
    if (r.status === "cancelled") return fail("A cancelled return cannot be edited");
    if (!p_form_date) return fail("Enter the date");
    if (r.status === "completed" && !String(p_received_by ?? "").trim()) return fail("Enter the name of the person who received the parcels");
    Object.assign(r, { form_date: p_form_date, note: String(p_note ?? "").trim() || null });
    if (r.status === "completed") r.received_by_name = String(p_received_by).trim();
    save();
    return { data: null, error: null };
  },

  delete_return({ p_return_id, p_reason }) {
    const d = db();
    const r = d.returns.find((x) => x.id === p_return_id);
    if (!r) return fail("Return not found");
    if (!String(p_reason ?? "").trim()) return fail("Enter the reason for deleting this return");
    const back = d.parcels.filter((p) => p.return_id === r.id && ["ready_for_return", "returned"].includes(p.status));
    back.forEach((p) => { p.return_id = null; setParcelStatus(p, "in_warehouse"); });
    d.booking_events.push({ id: uid(), booking_id: r.booking_id, kind: "return_deleted",
      reason: `${r.code} deleted (${back.length} parcel(s) back in the warehouse): ${String(p_reason).trim()}`, old_date: null, new_date: null, actor_name: "You (sample data)", created_at: now() });
    d.returns = d.returns.filter((x) => x !== r);
    save();
    return { data: null, error: null };
  },

  cancel_return({ p_return_id }) {
    const d = db();
    const r = d.returns.find((x) => x.id === p_return_id);
    if (!r) return fail("Return not found");
    if (r.status !== "open") return fail(`This return is already ${r.status}`);
    d.parcels.filter((p) => p.return_id === r.id && p.status === "ready_for_return").forEach((p) => { p.return_id = null; setParcelStatus(p, "in_warehouse"); });
    r.status = "cancelled";
    save();
    return { data: null, error: null };
  },

  // Accounts: the same rules as the database functions accounts_summary() and accounts_invoices().
  accounts_summary() {
    const d = db();
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const rows = d.bookings.map((b) => ({ b, paid: r2(d.payments.filter((p) => p.booking_id === b.id).reduce((s, p) => s + Number(p.amount), 0)) }));
    const live = rows.filter((r) => r.b.status !== "cancelled");
    const withAmount = live.filter((r) => r.b.invoice_amount != null);
    const noAmount = live.filter((r) => r.b.invoice_no && r.b.invoice_amount == null);
    const byWho = new Map<string, { name: string; cash: number; bank: number }>();
    for (const p of d.payments) {
      const key = p.received_by_driver ?? "office";
      const name = p.received_by_driver ? (d.drivers.find((x) => x.id === key)?.name ?? "Office / not recorded") : "Office / not recorded";
      const row = byWho.get(key) ?? { name, cash: 0, bank: 0 };
      if (p.method === "cash") row.cash = r2(row.cash + Number(p.amount));
      else row.bank = r2(row.bank + Number(p.amount));
      byWho.set(key, row);
    }
    return {
      data: {
        invoiced: r2(withAmount.reduce((s, r) => s + Number(r.b.invoice_amount), 0)),
        collected: r2(rows.reduce((s, r) => s + r.paid, 0)),
        outstanding: r2(withAmount.reduce((s, r) => s + Math.max(Number(r.b.invoice_amount) - r.paid, 0), 0)),
        no_amount_count: noAmount.length,
        estimated_pending: r2(noAmount.reduce((s, r) => s + Number(r.b.estimated_bill ?? 0), 0)),
        collections: [...byWho.values()].sort((a, b) => a.name.localeCompare(b.name)),
      },
      error: null,
    };
  },

  accounts_invoices({ p_status = "all", p_search = null, p_limit = 25, p_offset = 0 }) {
    const d = db();
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const q = String(p_search ?? "").trim().toLowerCase();
    const list = d.bookings
      .filter((b) => b.invoice_no && (!q || [b.invoice_no, b.code, b.sender_name].some((v) => String(v ?? "").toLowerCase().includes(q))))
      .map((b) => {
        const paid = r2(d.payments.filter((p) => p.booking_id === b.id).reduce((s, p) => s + Number(p.amount), 0));
        const amount = b.invoice_amount == null ? null : Number(b.invoice_amount);
        const status = amount === null ? "not_invoiced" : amount - paid <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
        return { b, paid, amount, status };
      })
      .filter((r) =>
        p_status === "all" ? true
        : p_status === "outstanding" ? ["unpaid", "partial"].includes(r.status) && r.b.status !== "cancelled"
        : p_status === "not_invoiced" ? r.status === "not_invoiced" && r.b.status !== "cancelled"
        : r.status === p_status)
      .sort((x, y) => Number(y.b.invoice_no.slice(4)) - Number(x.b.invoice_no.slice(4)));
    const page = list.slice(Math.max(p_offset, 0), Math.max(p_offset, 0) + Math.max(Math.min(p_limit, 100), 1));
    return {
      data: page.map((r) => ({
        r_booking_id: r.b.id, r_invoice_no: r.b.invoice_no, r_code: r.b.code, r_customer: r.b.sender_name, r_amount: r.amount, r_paid: r.paid,
        r_balance: r.amount === null ? null : Math.max(r2(r.amount - r.paid), 0), r_booking_status: r.b.status, r_pay_status: r.status, r_total: list.length,
      })),
      error: null,
    };
  },

  // Warehouses: the same rules as add_warehouse(), update_warehouse() and delete_warehouse().
  move_parcels({ p_parcel_ids, p_warehouse_id }) {
    const d = db();
    if (!p_parcel_ids?.length) return fail("Select at least one package");
    const dest = d.warehouses.find((w) => w.id === p_warehouse_id);
    if (!dest) return fail("Choose where to move them");
    if (dest.active === false) return fail(`${dest.name} is not active`);
    const ps = d.parcels.filter((p) => p_parcel_ids.includes(p.id));
    if (ps.length !== p_parcel_ids.length || ps.some((p) => p.status !== "in_warehouse")) return fail("Only packages that are in the warehouse can be moved");
    const moving = ps.filter((p) => p.warehouse_id !== dest.id);
    const groups = new Map<string, Row[]>();
    for (const p of moving) groups.set(`${p.booking_id}|${p.warehouse_id}`, [...(groups.get(`${p.booking_id}|${p.warehouse_id}`) ?? []), p]);
    for (const list of groups.values()) {
      const from = d.warehouses.find((w) => w.id === list[0].warehouse_id)?.name ?? "no place";
      d.booking_events.push({ id: uid(), booking_id: list[0].booking_id, kind: "moved", old_date: null, new_date: null, actor_name: "You (sample data)", created_at: now(),
        reason: `Moved ${list.length} ${list.length === 1 ? "package" : "packages"} from ${from} to ${dest.name}: ${list.sort((a, b) => a.seq - b.seq).map((p) => p.barcode).join(", ")}` });
    }
    moving.forEach((p) => Object.assign(p, { warehouse_id: dest.id, position: null }));
    save();
    return { data: moving.length, error: null };
  },

  set_parcel_position({ p_parcel_id, p_position }) {
    const p = db().parcels.find((x) => x.id === p_parcel_id);
    if (!p) return fail("Parcel not found");
    const pos = String(p_position ?? "").trim();
    if (pos.length > 60) return fail("The position can have up to 60 characters");
    p.position = pos || null;
    save();
    return { data: null, error: null };
  },

  add_warehouse({ p_name, p_code }) {
    const d = db();
    const nm = String(p_name ?? "").trim();
    if (nm.length < 1 || nm.length > 40) return fail("Enter a name of up to 40 characters");
    if (d.warehouses.some((w) => w.name.toLowerCase() === nm.toLowerCase())) return fail("A warehouse with this name already exists");
    const code = warehouseCode(nm, p_code, null);
    if (!code) return fail("Enter a short code for this warehouse");
    const row = { id: uid(), code, name: nm, active: true };
    d.warehouses.push(row);
    save();
    return { data: row.id, error: null };
  },

  update_warehouse({ p_id, p_name, p_code, p_active }) {
    const d = db();
    const w = d.warehouses.find((x) => x.id === p_id);
    if (!w) return fail("Warehouse not found");
    const nm = String(p_name ?? "").trim();
    if (nm.length < 1 || nm.length > 40) return fail("Enter a name of up to 40 characters");
    if (d.warehouses.some((x) => x.id !== p_id && x.name.toLowerCase() === nm.toLowerCase())) return fail("A warehouse with this name already exists");
    if (!p_active && !d.warehouses.some((x) => x.id !== p_id && x.active !== false)) return fail("There must be at least one active warehouse");
    Object.assign(w, { name: nm, code: warehouseCode(nm, p_code, p_id), active: p_active !== false });
    save();
    return { data: null, error: null };
  },

  delete_warehouse({ p_id }) {
    const d = db();
    if (!d.warehouses.some((x) => x.id === p_id)) return fail("Warehouse not found");
    if (d.parcels.some((p) => p.warehouse_id === p_id)) return fail("This warehouse has parcels, now or in the past, so it cannot be deleted. Deactivate it instead.");
    if (!d.warehouses.some((x) => x.id !== p_id && x.active !== false)) return fail("There must be at least one active warehouse");
    d.warehouses = d.warehouses.filter((x) => x.id !== p_id);
    save();
    return { data: null, error: null };
  },

  set_organization({ p_legal_name, p_currency, p_country }) {
    const cur = String(p_currency ?? "").trim().toUpperCase();
    const land = String(p_country ?? "").trim();
    if (String(p_legal_name ?? "").trim().length > 120) return fail("The organization name can have up to 120 characters");
    if (!/^[A-Z]{3}$/.test(cur)) return fail("Choose a currency");
    if (!land || land.length > 60) return fail("Enter the country");
    Object.assign(db().organization[0], { legal_name: String(p_legal_name ?? "").trim(), currency: cur, country: land, updated_at: now() });
    save();
    return { data: null, error: null };
  },

  next_number_preview({ p_kind }) {
    const s = db().number_series.find((x) => x.kind === p_kind);
    if (!s) return fail("Unknown number series");
    const used = (db() as unknown as Record<string, Row[]>)[s.lookup_table as string] ?? [];
    let n = Number(s.next_number);
    while (used.some((r) => r[s.lookup_column as string] === `${s.prefix}${n}`)) n += 1;
    return { data: `${s.prefix}${n}`, error: null };
  },

  set_number_series({ p_kind, p_prefix, p_next }) {
    const s = db().number_series.find((x) => x.kind === p_kind);
    const prefix = String(p_prefix ?? "").trim().toUpperCase();
    if (!s) return fail("Unknown number series");
    if (!/^[A-Z0-9._/-]{0,10}$/.test(prefix)) return fail("The prefix can have up to 10 letters, numbers, dashes or slashes");
    if (!(Number(p_next) >= 1)) return fail("The next number must be 1 or more");
    Object.assign(s, { prefix, next_number: Number(p_next) });
    save();
    return { data: null, error: null };
  },

  save_booking_receiver({ p_booking_id }) {
    const d = db();
    const b = d.bookings.find((x) => x.id === p_booking_id);
    if (!b) return fail("Booking not found");
    const sender = d.booking_contacts.find((l) => l.booking_id === b.id && l.role === "customer")?.customer_id as string | undefined;
    if (!sender) return fail("Link a customer to this booking first");
    if (!String(b.receiver_name ?? "").trim()) return fail("This booking has no receiver name yet");
    const phone = /^\+[1-9]\d{6,14}$/.test(b.receiver_phone ?? "") ? b.receiver_phone : null;
    const addr = String(b.receiver_address ?? "").trim().slice(0, 300) || null;
    let rid = (phone && d.customers.find((x) => x.phone === phone)?.id) || null;
    if (!rid) {
      rid = uid();
      d.customers.push({ id: rid, full_name: String(b.receiver_name).trim().slice(0, 120), phone, whatsapp: null, address: addr, geo_lat: null, geo_lng: null, emirates_id: null,
        warning_note: null, created_by_name: "Tester (super admin)", created_at: now(), updated_at: now() });
    }
    if (rid !== sender && !d.customer_receivers.some((x) => x.sender_id === sender && x.receiver_id === rid && (x.address ?? "") === (addr ?? ""))) {
      d.customer_receivers.push({ id: uid(), sender_id: sender, receiver_id: rid, address: addr, created_at: now() });
    }
    d.booking_contacts = d.booking_contacts.filter((l) => !(l.booking_id === b.id && l.role === "receiver"));
    d.booking_contacts.push({ booking_id: b.id, role: "receiver", customer_id: rid, created_at: now() });
    save();
    return { data: rid, error: null };
  },

  set_customer_warning({ p_id, p_note }) {
    const c = db().customers.find((x) => x.id === p_id);
    if (!c) return fail("Customer not found");
    c.warning_note = String(p_note ?? "").trim().slice(0, 300) || null;
    save();
    return { data: null, error: null };
  },

  booking_warning({ p_booking_id }) {
    const d = db();
    const l = d.booking_contacts.find((x) => x.booking_id === p_booking_id && x.role === "customer");
    return { data: (l && d.customers.find((x) => x.id === l.customer_id)?.warning_note) || null, error: null };
  },

  add_receiver({ p_sender, p_name, p_phone, p_address, p_receiver_id = null }) {
    try {
      const d = db();
      if (!d.customers.some((x) => x.id === p_sender)) return fail("Customer not found");
      let rid = p_receiver_id as string | null;
      const phone = cleanPhone(p_phone, "phone number");
      const addr = String(p_address ?? "").trim() || null;
      if (!rid) {
        const nm = String(p_name ?? "").trim();
        if (nm.length < 1 || nm.length > 120) return fail("Enter the receiver's name");
        rid = (phone && d.customers.find((x) => x.phone === phone)?.id) || null;
        if (!rid) {
          rid = uid();
          d.customers.push({ id: rid, full_name: nm, phone, whatsapp: null, address: addr, geo_lat: null, geo_lng: null, emirates_id: null, warning_note: null,
            created_by_name: "Tester (super admin)", created_at: now(), updated_at: now() });
        }
      } else if (!d.customers.some((x) => x.id === rid)) return fail("Customer not found");
      if (rid === p_sender) return fail("A customer cannot be their own receiver");
      let entry = d.customer_receivers.find((x) => x.sender_id === p_sender && x.receiver_id === rid && (x.address ?? "") === (addr ?? ""));
      if (!entry) {
        entry = { id: uid(), sender_id: p_sender, receiver_id: rid, address: addr, created_at: now() };
        d.customer_receivers.push(entry);
      }
      save();
      return { data: entry.id, error: null };
    } catch (e) { return fail((e as Error).message); }
  },

  remove_receiver({ p_id }) {
    db().customer_receivers = db().customer_receivers.filter((x) => x.id !== p_id);
    save();
    return { data: null, error: null };
  },

  customer_receivers_of({ p_sender }) {
    const d = db();
    const out = d.customer_receivers.filter((x) => x.sender_id === p_sender).map((x) => ({ r: x, c: d.customers.find((c) => c.id === x.receiver_id)! }))
      .sort((a, b) => a.c.full_name.localeCompare(b.c.full_name))
      .map(({ r: x, c }) => ({ id: x.id, receiver_id: c.id, name: c.full_name, phone: c.phone, whatsapp: c.whatsapp, address: x.address ?? c.address }));
    return { data: out, error: null };
  },

  delete_id_document({ p_id, p_reason }) {
    const d = db();
    const doc = d.id_documents.find((x) => x.id === p_id);
    if (String(p_reason ?? "").trim().length < 3) return fail("Please give a reason");
    if (!doc) return fail("Not found");
    d.audit_log.push({ id: uid(), table_name: "deletion_reason", row_id: doc.id, booking_id: doc.booking_id, action: "delete", actor_name: "You (sample data)", changed_at: now(),
      changes: { reason: String(p_reason).trim(), deleted: "Emirates ID number and photo" } });
    d.id_documents = d.id_documents.filter((x) => x !== doc);
    save();
    return { data: doc.photo_path, error: null };
  },

  possible_duplicates() {
    const d = db();
    const groups: Row[] = [];
    for (const kind of ["phone", "emirates_id"] as const) {
      const values = [...new Set(d.customers.map((c) => c[kind]).filter(Boolean))].sort();
      for (const value of values) {
        const cs = d.customers.filter((c) => c[kind] === value);
        if (cs.length > 1) groups.push({ kind, value, customers: cs.map((c) => ({ id: c.id, full_name: c.full_name, phone: c.phone, emirates_id: c.emirates_id, address: c.address, invoices: linkedBookings(c.id).length })) });
      }
    }
    return { data: groups, error: null };
  },

  merge_customers({ p_keep, p_remove }) {
    const d = db();
    if (p_keep === p_remove) return fail("Choose two different customers");
    const k = d.customers.find((x) => x.id === p_keep);
    const rm = d.customers.find((x) => x.id === p_remove);
    if (!k || !rm) return fail("Customer not found");
    d.booking_contacts.forEach((l) => { if (l.customer_id === rm.id) l.customer_id = k.id; });
    d.customer_notes.forEach((n) => { if (n.customer_id === rm.id) n.customer_id = k.id; });
    for (const x of d.customer_receivers) {
      if (x.sender_id === rm.id) x.sender_id = k.id;
      if (x.receiver_id === rm.id) x.receiver_id = k.id;
    }
    const seen = new Set<string>();
    d.customer_receivers = d.customer_receivers.filter((x) => {
      const key = `${x.sender_id}|${x.receiver_id}|${x.address ?? ""}`;
      if (x.sender_id === x.receiver_id || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    for (const f of ["phone", "whatsapp", "address", "geo_lat", "geo_lng", "emirates_id", "warning_note"]) k[f] = k[f] ?? rm[f];
    k.updated_at = now();
    d.customer_notes.push({ id: uid(), customer_id: k.id, author_id: "mock-user", author_name: "Tester (super admin)", created_at: now(),
      body: `Merged with the record of ${rm.full_name}${rm.phone ? ` (${rm.phone})` : ""}. All invoices, notes and receivers moved here.` });
    d.customers = d.customers.filter((x) => x !== rm);
    save();
    return { data: null, error: null };
  },

  delete_customer({ p_id }) {
    const d = db();
    if (d.booking_contacts.some((l) => l.customer_id === p_id)) return fail("This customer is linked to invoices. Merge them into another customer, or unlink the invoices first.");
    if (!d.customers.some((x) => x.id === p_id)) return fail("Customer not found");
    d.customers = d.customers.filter((x) => x.id !== p_id);
    d.customer_receivers = d.customer_receivers.filter((x) => x.sender_id !== p_id && x.receiver_id !== p_id);
    save();
    return { data: null, error: null };
  },

  create_customer(a) {
    try {
      const d = db();
      const row = { id: uid(), ...customerArgs(a), warning_note: null, created_by_name: "Tester (super admin)", created_at: now(), updated_at: now() };
      d.customers.push(row);
      save();
      return { data: row.id, error: null };
    } catch (e) { return fail((e as Error).message); }
  },

  update_customer(a) {
    try {
      const c = db().customers.find((x) => x.id === a.p_id);
      const fields = customerArgs(a);
      if (!c) return fail("Customer not found");
      Object.assign(c, fields, { updated_at: now() });
      for (const l of db().booking_contacts.filter((x) => x.customer_id === c.id && x.role === "customer")) {
        const bk = db().bookings.find((x) => x.id === l.booking_id);
        if (bk && bk.status === "booked") {
          bk.sender_name = c.full_name;
          if (c.phone) { bk.sender_phone = c.phone; bk.sender_whatsapp = c.whatsapp; }
        }
      }
      save();
      return { data: null, error: null };
    } catch (e) { return fail((e as Error).message); }
  },

  link_booking_customer({ p_booking_id, p_customer_id, p_role = "customer" }) {
    const d = db();
    if (!["customer", "booker", "receiver"].includes(p_role)) return fail("Unknown role");
    if (!d.bookings.some((b) => b.id === p_booking_id)) return fail("Booking not found");
    d.booking_contacts = d.booking_contacts.filter((l) => !(l.booking_id === p_booking_id && l.role === p_role));
    if (p_customer_id) {
      if (!d.customers.some((c) => c.id === p_customer_id)) return fail("Customer not found");
      d.booking_contacts.push({ booking_id: p_booking_id, role: p_role, customer_id: p_customer_id, created_at: now() });
    }
    save();
    return { data: null, error: null };
  },

  create_customer_from_booking({ p_booking_id }) {
    const d = db();
    const b = d.bookings.find((x) => x.id === p_booking_id);
    if (!b) return fail("Booking not found");
    const id = uid();
    d.customers.push({ id, full_name: String(b.sender_name).slice(0, 120), phone: b.sender_phone ?? null, whatsapp: b.sender_whatsapp ?? null,
      address: /^legacy invoice/i.test(b.pickup_address) ? null : b.pickup_address, geo_lat: b.geo_lat ?? null, geo_lng: b.geo_lng ?? null, emirates_id: null, warning_note: null,
      created_by_name: "Tester (super admin)", created_at: now(), updated_at: now() });
    d.booking_contacts = d.booking_contacts.filter((l) => !(l.booking_id === b.id && l.role === "customer"));
    d.booking_contacts.push({ booking_id: b.id, role: "customer", customer_id: id, created_at: now() });
    save();
    return { data: id, error: null };
  },

  search_customers({ p_query, p_limit = 10 }) {
    const q = String(p_query ?? "").trim();
    if (q.replace(/\s/g, "").length < 2) return { data: { customers: [], total: 0 }, error: null };
    const hits = customerHits(q);
    return { data: { customers: hits.slice(0, Math.max(1, Math.min(Number(p_limit) || 10, 50))).map(customerRow), total: hits.length }, error: null };
  },

  list_customers({ p_limit = 50, p_offset = 0 }) {
    const all = [...db().customers].sort((a, b) => a.full_name.localeCompare(b.full_name));
    return { data: { customers: all.slice(Number(p_offset), Number(p_offset) + Number(p_limit)).map(customerRow), total: all.length }, error: null };
  },

  bookings_without_customer({ p_limit = 100 }) {
    const d = db();
    const lone = d.bookings.filter((b) => !d.booking_contacts.some((l) => l.booking_id === b.id && l.role === "customer"))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { data: { bookings: lone.slice(0, Number(p_limit)).map((b) => ({ id: b.id, code: b.code, invoice_no: b.invoice_no ?? null, sender_name: b.sender_name,
      sender_phone: b.sender_phone ?? null, pickup_address: b.pickup_address, status: b.status, created_at: b.created_at })), total: lone.length }, error: null };
  },

  customer_timeline({ p_customer_id, p_limit = 100, p_offset = 0 }) {
    const d = db();
    const rows: Row[] = [];
    const add = (at: string, kind: string, title: string, detail: string | null, b: Row | null, actor: string | null) =>
      rows.push({ r_at: at, r_kind: kind, r_title: title, r_detail: detail, r_booking_id: b?.id ?? null, r_invoice: b ? (b.invoice_no ?? b.code) : null, r_actor: actor });
    const c = d.customers.find((x) => x.id === p_customer_id);
    if (c) add(c.created_at, "customer", "Customer record created", null, null, c.created_by_name ?? null);
    for (const b of linkedBookings(p_customer_id)) {
      add(b.created_at, "booking", `Booking ${b.code} created`, null, b, null);
      for (const e of d.booking_events.filter((x) => x.booking_id === b.id)) add(e.created_at, "event", String(e.kind).replace(/_/g, " "), e.reason ?? null, b, e.actor_name ?? null);
      for (const p of d.payments.filter((x) => x.booking_id === b.id)) add(p.created_at, "payment", `Payment of ${p.amount} received`, p.method ?? null, b, null);
      for (const n of d.booking_notes.filter((x) => x.booking_id === b.id)) add(n.created_at, "note", "Note on the invoice", n.body, b, n.author_name);
      for (const p of d.parcels.filter((x) => x.booking_id === b.id))
        for (const e of d.parcel_events.filter((x) => x.parcel_id === p.id)) add(e.created_at, "package", `${p.barcode}: ${String(e.status).replace(/_/g, " ")}`, null, b, null);
    }
    for (const n of d.customer_notes.filter((x) => x.customer_id === p_customer_id)) add(n.created_at, "note", "Note on the customer", n.body, null, n.author_name);
    rows.sort((a, b) => String(b.r_at).localeCompare(String(a.r_at)));
    return { data: rows.slice(Number(p_offset), Number(p_offset) + Number(p_limit)), error: null };
  },

  // The same search as the database function global_search().
  global_search({ p_query, p_limit = 6 }) {
    const d = db();
    const q = String(p_query ?? "").trim();
    const empty = { bookings: [], parcels: [], containers: [], customers: [], bookings_total: 0, parcels_total: 0, containers_total: 0, customers_total: 0 };
    if (q.replace(/\s/g, "").length < 2) return { data: empty, error: null };
    const lim = Math.max(1, Math.min(Number(p_limit) || 6, 50));
    const paid = (id: string) => d.payments.filter((p) => p.booking_id === id).reduce((s, p) => s + Number(p.amount), 0);
    const hits = d.bookings
      .filter((b) => matchesSearch(q, [b.invoice_no, b.code, b.sender_name, b.receiver_name, b.pickup_area, b.pickup_address, b.receiver_address, b.notes], PHONE_FIELDS(b)))
      .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
    const pay = (b: Row) => (!b.invoice_no ? null : b.invoice_amount == null ? "not_invoiced" : Number(b.invoice_amount) - paid(b.id) <= 0 ? "paid" : paid(b.id) > 0 ? "partial" : "unpaid");
    const parcelHits = d.parcels
      .filter((p) => p.status !== "repacked")
      .map((p) => ({ p, b: d.bookings.find((x) => x.id === p.booking_id)!, w: d.warehouses.find((x) => x.id === p.warehouse_id) }))
      .filter(({ p, b, w }) => matchesSearch(q, [p.barcode, p.description, p.position, b?.invoice_no, b?.code, b?.sender_name, w?.name, p.delivery_tracking]))
      .sort((x, y) => x.p.barcode.localeCompare(y.p.barcode));
    const containerHits = d.containers
      .filter((c) => matchesSearch(q, [c.code, c.destination]))
      .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
    return {
      data: {
        bookings: hits.slice(0, lim).map((b) => ({ id: b.id, code: b.code, invoice_no: b.invoice_no ?? null, sender_name: b.sender_name, receiver_name: b.receiver_name ?? null,
          sender_phone: b.sender_phone ?? null, status: b.status, pickup_date: b.pickup_date, pickup_area: b.pickup_area, pay_status: pay(b) })),
        parcels: parcelHits.slice(0, lim).map(({ p, b, w }) => ({ id: p.id, barcode: p.barcode, description: p.description ?? null, weight_kg: p.weight_kg, status: p.status,
          position: p.position ?? null, booking_id: p.booking_id, invoice_no: b?.invoice_no ?? null, booking_code: b?.code, sender_name: b?.sender_name, place: w?.name ?? null })),
        containers: containerHits.slice(0, lim).map((c) => ({ id: c.id, code: c.code, destination: c.destination ?? null, status: c.status })),
        customers: customerHits(q).slice(0, lim).map(customerRow),
        bookings_total: hits.length, parcels_total: parcelHits.length, containers_total: containerHits.length, customers_total: customerHits(q).length,
      },
      error: null,
    };
  },

  // The private error log (Settings > Problems). In sample data mode errors are only kept in this browser.
  log_client_error({ p_message, p_stack, p_path, p_agent }) {
    const d = db();
    const msg = String(p_message ?? "").trim().slice(0, 500);
    if (!msg) return { data: null, error: null };
    const same = d.client_errors.find((e) => e.message === msg && Date.now() - new Date(e.last_seen).getTime() < 10 * 60_000);
    if (same) Object.assign(same, { count: same.count + 1, last_seen: now() });
    else d.client_errors.unshift({ id: Date.now() + Math.random(), first_seen: now(), last_seen: now(), count: 1, user_id: "mock-user", user_name: "Tester (super admin)",
      path: String(p_path ?? "").slice(0, 200), message: msg, stack: String(p_stack ?? "").slice(0, 2000), user_agent: String(p_agent ?? "").slice(0, 200) });
    d.client_errors = d.client_errors.slice(0, 300);
    save();
    return { data: null, error: null };
  },

  clear_client_errors() {
    db().client_errors = [];
    save();
    return { data: null, error: null };
  },

  mentionable_users() {
    return {
      data: db().profiles.filter((p) => p.active && p.id !== "mock-user").map((p) => ({ id: p.id, full_name: p.full_name, role_label: p.role })),
      error: null,
    };
  },

  container_check({ p_container_id }) {
    const d = db();
    const ids = [...new Set(d.parcels.filter((p) => p.container_id === p_container_id).map((p) => p.booking_id))];
    const rows = ids.map((id) => {
      const b = d.bookings.find((x) => x.id === id)!;
      const rel = d.parcels.filter((p) => p.booking_id === id && (p.container_id === p_container_id || p.status === "in_warehouse"));
      return {
        booking_id: id, booking_code: b.code, invoice_no: b.invoice_no ?? null, expected: rel.length,
        loaded: rel.filter((p) => p.container_id === p_container_id).length,
        missing: rel.filter((p) => p.status === "in_warehouse").sort((x, y) => x.seq - y.seq).map((p) => p.barcode),
      };
    });
    return { data: rows.sort((x, y) => x.booking_code.localeCompare(y.booking_code)), error: null };
  },

  depart_container({ p_container_id, p_override_reason, p_date }) {
    const d = db();
    const c = d.containers.find((x) => x.id === p_container_id && x.status === "loading");
    if (!c) return fail("Container is not open for loading");
    const short = (RPC.container_check({ p_container_id }).data as Row[]).filter((r) => r.missing.length);
    if (short.length) {
      if (!String(p_override_reason ?? "").trim())
        return fail(`PARCELS_MISSING : ${short.map((r) => `${r.booking_code} (${r.loaded} of ${r.expected})`).join(", ")}`);
      short.forEach((r) =>
        d.booking_events.push({ id: uid(), booking_id: r.booking_id, kind: "departed_with_missing",
          reason: `${String(p_override_reason).trim()} (${c.code} left without ${r.missing.join(", ")})`,
          old_date: null, new_date: null, actor_name: "You (sample data)", created_at: now() }));
    }
    let ts: string | null;
    try { ts = eventTime(p_date); } catch (e) { return fail((e as Error).message); }
    c.status = "departed";
    c.departed_at = ts ?? now();
    const loaded = d.parcels.filter((p) => p.container_id === c.id && p.status === "loaded");
    loaded.forEach((p) => setParcelStatus(p, "in_transit"));
    backdate(loaded.map((p) => p.id), "in_transit", ts);
    if (ts) {
      backdate(loaded.map((p) => p.id), "loaded", new Date(new Date(ts).getTime() - 60000).toISOString());
      backdate(loaded.map((p) => p.id), "in_warehouse", new Date(new Date(ts).getTime() - 120000).toISOString());
    }
    save();
    return { data: loaded.length, error: null };
  },

  arrive_container({ p_container_id, p_date }) {
    const d = db();
    const c = d.containers.find((x) => x.id === p_container_id && x.status === "departed");
    if (!c) return fail("Container has not departed, or has already arrived");
    let ts: string | null;
    try { ts = eventTime(p_date); } catch (e) { return fail((e as Error).message); }
    if (ts && c.departed_at && ts.slice(0, 10) < String(c.departed_at).slice(0, 10)) return fail(`The arrival cannot be before the departure (${String(c.departed_at).slice(0, 10)})`);
    c.status = "arrived";
    c.arrived_at = ts ?? now();
    const moved = d.parcels.filter((p) => p.container_id === c.id && p.status === "in_transit");
    moved.forEach((p) => setParcelStatus(p, "arrived"));
    backdate(moved.map((p) => p.id), "arrived", ts);
    save();
    return { data: moved.length, error: null };
  },

  deliver_parcel({ p_parcel_id, p_partner, p_tracking, p_date }) {
    const d = db();
    const p = d.parcels.find((x) => x.id === p_parcel_id && x.status === "arrived");
    if (!p) return fail("Parcel must have arrived before it can be delivered");
    const partner = String(p_partner ?? "").trim() || null;
    const tracking = String(p_tracking ?? "").trim() || null;
    if ((partner?.length ?? 0) > 60 || (tracking?.length ?? 0) > 60) return fail("The partner and the tracking number can have up to 60 characters");
    let ts: string | null;
    try { ts = eventTime(p_date); } catch (e) { return fail((e as Error).message); }
    const arrived = d.containers.find((c) => c.id === p.container_id)?.arrived_at;
    if (ts && arrived && ts.slice(0, 10) < String(arrived).slice(0, 10)) return fail(`The delivery cannot be before the arrival (${String(arrived).slice(0, 10)})`);
    setParcelStatus(p, "delivered");
    Object.assign(p, { delivered_at: ts ?? now(), delivery_partner: partner, delivery_tracking: tracking });
    backdate([p.id], "delivered", ts);
    save();
    return { data: null, error: null };
  },

  update_contact({ p_booking_id, p_party, p_phone, p_whatsapp }) {
    const b = db().bookings.find((x) => x.id === p_booking_id);
    if (!b) return fail("Booking not found");
    const e164 = /^\+[1-9][0-9]{6,14}$/;
    if (p_party === "sender" && !p_phone) return fail("The customer needs a call number");
    if ((p_phone && !e164.test(p_phone)) || (p_whatsapp && !e164.test(p_whatsapp)))
      return fail("Enter the number in international format, for example +971567375716");
    const wa = p_whatsapp && p_whatsapp !== p_phone ? p_whatsapp : null;
    if (p_party === "sender") {
      b.sender_phone = p_phone; b.sender_whatsapp = wa;
      // the correction is to the person, so the customer record is corrected too
      for (const l of db().booking_contacts.filter((x) => x.booking_id === b.id && x.role === "customer")) {
        const cu = db().customers.find((x) => x.id === l.customer_id);
        if (cu) { cu.phone = p_phone; cu.whatsapp = wa; cu.updated_at = now(); }
      }
    }
    else { b.receiver_phone = p_phone ?? null; b.receiver_whatsapp = wa; }
    b.updated_at = now();
    save();
    return { data: null, error: null };
  },

  reschedule_booking({ p_booking_id, p_new_date, p_reason }) {
    const d = db();
    const b = d.bookings.find((x) => x.id === p_booking_id);
    if (!b) return fail("Booking not found");
    if (!String(p_reason ?? "").trim()) return fail("A reason is required");
    if (b.status !== "booked") return fail("Only pickups that have not been collected can be rescheduled");
    if (!p_new_date) return fail("Choose a date");
    if (p_new_date === b.pickup_date) return fail("The pickup is already on that date");
    const old = b.pickup_date;
    b.pickup_date = p_new_date;
    b.updated_at = now();
    recordChange(b, "rescheduled", String(p_reason).trim(), old, p_new_date,
      `${b.code} rescheduled`, `Moved from ${old} to ${p_new_date}. Reason: ${String(p_reason).trim()}`);
    // Nobody needs an alert about a day that has already passed (the usual reason is entering an old record).
    if (p_new_date < today()) db().notifications.pop();
    save();
    return { data: null, error: null };
  },

  cancel_booking({ p_booking_id, p_reason }) {
    const d = db();
    if (!String(p_reason ?? "").trim()) return fail("A cancellation reason is required");
    if (d.parcels.some((p) => p.booking_id === p_booking_id))
      return fail("Booking already has parcels in the warehouse and cannot be cancelled");
    const b = d.bookings.find((x) => x.id === p_booking_id && ["booked", "collected"].includes(x.status));
    if (!b) return fail("Only booked or collected bookings can be cancelled");
    b.status = "cancelled";
    b.cancellation_reason = String(p_reason).trim();
    b.cancelled_at = now();
    recordChange(b, "cancelled", String(p_reason).trim(), b.pickup_date, null,
      `${b.code} cancelled`, `Reason: ${String(p_reason).trim()}`);
    save();
    return { data: null, error: null };
  },

  track_booking({ p_code }) {
    const d = db();
    const b = d.bookings.find((x) => x.code === p_code.trim().toUpperCase() || x.invoice_no === p_code.trim().toUpperCase());
    if (!b) return { data: null, error: null };
    const parcels = d.parcels
      .filter((p) => p.booking_id === b.id && p.status !== "repacked")
      .sort((x, y) => x.seq - y.seq)
      .map((p) => ({
        barcode: p.barcode, description: p.description, weight_kg: p.weight_kg, status: p.status,
        delivery_partner: p.delivery_partner ?? null, delivery_tracking: p.delivery_tracking ?? null, delivered_at: p.delivered_at ?? null,
        warehouse: d.warehouses.find((w) => w.id === p.warehouse_id)?.code ?? null,
        container: d.containers.find((c) => c.id === p.container_id)?.code ?? null,
        updated_at: p.updated_at,
        events: d.parcel_events.filter((e) => e.parcel_id === p.id)
          .sort((x, y) => x.created_at.localeCompare(y.created_at))
          .map((e) => ({ status: e.status, at: e.created_at })),
      }));
    return { data: { code: b.code, invoice_no: b.invoice_no ?? null, status: b.status, booked_at: b.created_at, parcels }, error: null };
  },
};

// ---------------------------------------------------------------- auth (signed in by default)
const listeners = new Set<(event: string, session: any) => void>();
const currentSession = () => {
  if (typeof window !== "undefined" && localStorage.getItem(AUTH_KEY)) return null;
  return { user: { id: "mock-user", email: "tester@example.com" } };
};
const emit = (event: string) => listeners.forEach((fn) => fn(event, currentSession()));

const auth = {
  getSession: async () => ({ data: { session: currentSession() }, error: null }),
  onAuthStateChange(fn: (event: string, session: any) => void) {
    listeners.add(fn);
    return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
  },
  async signInWithPassword() {
    localStorage.removeItem(AUTH_KEY);
    emit("SIGNED_IN");
    return { data: {}, error: null };
  },
  async updateUser({ password }: { password?: string }) {
    if (password !== undefined && String(password).length < 8) return { data: {}, error: { message: "Password should be at least 8 characters." } };
    return { data: {}, error: null };
  },
  async signOut() {
    localStorage.setItem(AUTH_KEY, "1");
    emit("SIGNED_OUT");
    return { error: null };
  },
};

export function createMockClient() {
  return {
    from: (table: string) => new Query(table),
    rpc: (name: string, args: any) =>
      new Promise((resolve) => setTimeout(() => resolve(RPC[name](args)), 60)),
    auth,
    storage: { from: () => mockStorage },
  };
}

// Private file storage for the ID photos. In sample data mode the files only live in this browser tab.
const files = new Map<string, Blob>();
const mockStorage = {
  async upload(path: string, file: Blob) {
    files.set(path, file);
    return { data: { path }, error: null };
  },
  async createSignedUrl(path: string) {
    const f = files.get(path);
    return { data: { signedUrl: f ? URL.createObjectURL(f) : "" }, error: f ? null : { message: "Photo not found (sample data keeps photos only until the page is reloaded)" } };
  },
  async remove(paths: string[]) {
    paths.forEach((p) => files.delete(p));
    return { data: null, error: null };
  },
};

/**
 * Sample-data stand-in for the /api/users server route (the Users screen). Same rules as the real route:
 * valid and unique email, a name is required, and a manager cannot touch a super admin.
 */
export async function mockUsersApi(path: string, init?: RequestInit): Promise<any> {
  await new Promise((r) => setTimeout(r, 60));
  const profiles = db().profiles;
  const me = profiles.find((p) => p.id === "mock-user");
  if (!init?.method || init.method === "GET") {
    return {
      users: profiles.map((p) => ({ id: p.id, email: p.email, full_name: p.full_name, role: p.role, active: p.active, driver: null, last_sign_in_at: null })),
      unlinkedDrivers: [],
    };
  }
  const id = path.split("/").pop();
  const target = profiles.find((p) => p.id === id);
  const body = JSON.parse(String(init.body ?? "{}"));
  if (!target) throw new Error("User not found");
  if (me?.role !== "super_admin" && target.role === "super_admin") throw new Error("Only a super admin can change a super admin");
  if (body.full_name !== undefined && !String(body.full_name).trim()) throw new Error("Name cannot be empty");
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
    if (profiles.some((p) => p.id !== id && p.email === email)) throw new Error("That email address is already used by someone else");
    target.email = email;
  }
  if (body.full_name !== undefined) target.full_name = String(body.full_name).trim();
  if (body.role !== undefined) target.role = body.role;
  if (body.active !== undefined) target.active = Boolean(body.active);
  save();
  return { ok: true };
}
