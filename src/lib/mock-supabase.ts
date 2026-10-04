/* eslint-disable @typescript-eslint/no-explicit-any */
// In-browser stand-in for the parts of supabase-js this app uses, so the UI can be tested
// without a backend. Data lives in localStorage. Used automatically when no Supabase keys are set.

type Row = Record<string, any>;
type Db = {
  seq: { booking: number; container: number; invoice: number; ret?: number };
  [table: string]: any;
  drivers: Row[]; warehouses: Row[]; bookings: Row[]; booking_items: Row[]; payments: Row[];
  containers: Row[]; parcels: Row[]; parcel_events: Row[]; profiles: Row[]; audit_log: Row[]; roles: Row[]; permissions: Row[]; role_permissions: Row[];
  booking_events: Row[]; notifications: Row[]; app_settings: Row[]; returns: Row[]; booking_notes: Row[]; number_series: Row[]; organization: Row[];
};

const STORAGE_KEY = "logistics-mock-db-v22";
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
    "items.edit", "items.edit_after", "notes.write", "numbers.edit", "returns.manage"],
  staff: ["dashboard.view", "bookings.view", "bookings.create", "bookings.edit", "bookings.cancel", "pickups.view_all",
    "pickups.collect", "warehouse.view", "containers.view", "accounts.view", "notifications.view", "bookings.reschedule", "items.edit", "items.edit_after", "notes.write"],
  warehouse: ["dashboard.view", "warehouse.view", "warehouse.manage", "containers.view", "containers.manage", "notifications.view", "notes.write"],
  driver: ["pickups.view_own", "pickups.collect", "pickups.cancel", "pickups.reschedule", "notifications.view", "pickups.edit_contact", "items.edit", "notes.write"],
};
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

  return {
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
    organization: [{ id: uid(), legal_name: "", currency: "AED", country: "United Arab Emirates", updated_at: now() }],
    number_series: [
      { kind: "invoice", prefix: "INV-", next_number: 1004 },
      { kind: "booking", prefix: "BK-", next_number: 1005 },
    ],
    app_settings: [{ key: "require_payment_before_loading", value: false, label: "Require payment before loading into a container",
      description: "When on, a parcel can only be loaded if its booking has an invoice amount and it is paid in full. People with \"Load without full payment\" can override it with a reason.", updated_at: now() }],
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
  } as Db;
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

// ---------------------------------------------------------------- numbering (mirrors the database: series, typed numbers, uniqueness)
const NUMBER_RE = /^[A-Z0-9][A-Z0-9._/-]{0,39}$/;
function takeNumber(kind: "invoice" | "booking"): string {
  const d = db();
  const s = d.number_series.find((x) => x.kind === kind)!;
  for (;;) {
    const candidate = `${s.prefix}${s.next_number++}`;
    if (!d.bookings.some((b) => (kind === "invoice" ? b.invoice_no : b.code) === candidate)) return candidate;
  }
}
const duplicate = (column: "code" | "invoice_no") => ({ message: `duplicate key value violates unique constraint "bookings_${column}_key"`, code: "23505" });
/** Checks a typed booking number or invoice number. Returns an error, or null when it is fine. */
function checkNumbers(row: Row, old: Row | null): { message: string; code?: string } | null {
  const d = db();
  if (typeof row.code === "string") row.code = row.code.trim().toUpperCase();
  if (typeof row.invoice_no === "string") row.invoice_no = row.invoice_no.trim().toUpperCase() || null;
  if (old && old.invoice_no && !row.invoice_no) return { message: "An invoice number cannot be removed" };
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
      tableRows.push(...rows);
    } else {
      const matched = tableRows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") {
        // bookings carry a version stamp, bumped on every update (like the database trigger)
        if (this.table === "bookings") {
          for (const r of matched) {
            const err = checkNumbers({ ...r, ...this.payload }, r);
            if (err) return { data: null, error: err, count: null };
          }
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
      break;
    case "containers":
      Object.assign(row, { code: `CN-${d.seq.container++}`, status: "loading", departed_at: null, created_at: now(), ...it });
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

const fail = (message: string) => ({ data: null, error: { message } });

// Mirrors the database: keep a history row, and tell the other party. Offline there is only one user, so the
// notification goes to that user, which lets the notification screens be tried without a second account.
function recordChange(b: Row, kind: string, reason: string, oldDate: string | null, newDate: string | null, title: string, body: string) {
  const d = db();
  d.booking_events.push({ id: uid(), booking_id: b.id, kind, reason, old_date: oldDate, new_date: newDate, actor_name: "You (sample data)", created_at: now() });
  d.notifications.push({ id: uid(), user_id: "mock-user", booking_id: b.id, kind, title, body, actor_name: "Sample teammate", created_at: now(), read_at: null });
}

const RPC: Record<string, (a: any) => { data: any; error: { message: string } | null }> = {
  split_booking({ p_booking_id, p_warehouse_id, p_parcels }) {
    const d = db();
    const b = d.bookings.find((x) => x.id === p_booking_id);
    if (!b) return fail("Booking not found");
    if (!["collected", "at_warehouse"].includes(b.status)) return fail(`Booking ${b.code} has not been collected yet`);
    if (!p_parcels.length) return fail("Add at least one parcel");
    if (d.parcels.some((p) => p.booking_id === b.id && p.status !== "in_warehouse"))
      return fail(`Some parcels of ${b.code} have already left the warehouse; cannot re-split`);

    if (p_parcels.some((p: Row) => Number(p.weight_kg ?? 0) < 0)) return fail("A parcel weight cannot be negative");

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
    save();
    return { data: p_parcels.length, error: null };
  },

  load_parcel({ p_container_id, p_barcode, p_override_reason }) {
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
    p.container_id = c.id;
    setParcelStatus(p, "loaded");
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
    d.seq.ret = d.seq.ret ?? 1001;
    const row = { id: uid(), code: `RT-${d.seq.ret++}`, booking_id: p_booking_id, status: "open", note: null, form_date: now().slice(0, 10), created_by_name: "You (sample data)",
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

  depart_container({ p_container_id, p_override_reason }) {
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
    c.status = "departed";
    c.departed_at = now();
    const loaded = d.parcels.filter((p) => p.container_id === c.id && p.status === "loaded");
    loaded.forEach((p) => setParcelStatus(p, "in_transit"));
    save();
    return { data: loaded.length, error: null };
  },

  arrive_container({ p_container_id }) {
    const d = db();
    const c = d.containers.find((x) => x.id === p_container_id && x.status === "departed");
    if (!c) return fail("Container has not departed, or has already arrived");
    c.status = "arrived";
    const moved = d.parcels.filter((p) => p.container_id === c.id && p.status === "in_transit");
    moved.forEach((p) => setParcelStatus(p, "arrived"));
    save();
    return { data: moved.length, error: null };
  },

  deliver_parcel({ p_parcel_id }) {
    const p = db().parcels.find((x) => x.id === p_parcel_id && x.status === "arrived");
    if (!p) return fail("Parcel must have arrived before it can be delivered");
    setParcelStatus(p, "delivered");
    save();
    return { data: null, error: null };
  },

  update_contact({ p_booking_id, p_party, p_phone, p_whatsapp }) {
    const b = db().bookings.find((x) => x.id === p_booking_id);
    if (!b) return fail("Booking not found");
    const e164 = /^\+[1-9][0-9]{6,14}$/;
    if (p_party === "sender" && !p_phone) return fail("The sender needs a call number");
    if ((p_phone && !e164.test(p_phone)) || (p_whatsapp && !e164.test(p_whatsapp)))
      return fail("Enter the number in international format, for example +971567375716");
    const wa = p_whatsapp && p_whatsapp !== p_phone ? p_whatsapp : null;
    if (p_party === "sender") { b.sender_phone = p_phone; b.sender_whatsapp = wa; }
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
    if (!p_new_date || p_new_date < today()) return fail("Choose today or a future date");
    if (p_new_date === b.pickup_date) return fail("The pickup is already on that date");
    const old = b.pickup_date;
    b.pickup_date = p_new_date;
    b.updated_at = now();
    recordChange(b, "rescheduled", String(p_reason).trim(), old, p_new_date,
      `${b.code} rescheduled`, `Moved from ${old} to ${p_new_date}. Reason: ${String(p_reason).trim()}`);
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
  };
}

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
