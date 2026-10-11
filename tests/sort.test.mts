// The sorting rules for the lists.
import test from "node:test";
import assert from "node:assert/strict";
import { CONTAINER_ORDER, STAGE_ORDER, firstDirOf, orderOf, sortRows, type SortColumn } from "../src/lib/sort.ts";

type Row = { id: number; code?: string | null; amount?: number | null; day?: string | null; stage?: string };
const col = (over: Partial<SortColumn<Row>> & Pick<SortColumn<Row>, "value">): SortColumn<Row> => ({ key: "k", label: "K", ...over });
const ids = (rows: Row[]) => rows.map((r) => r.id);

test("text ignores capitals and sorts numbers inside text as numbers (BK-9 before BK-10)", () => {
  const rows: Row[] = [{ id: 1, code: "BK-10" }, { id: 2, code: "bk-9" }, { id: 3, code: "BK-2" }];
  assert.deepEqual(ids(sortRows(rows, col({ value: (r) => r.code }), "asc")), [3, 2, 1]);
  assert.deepEqual(ids(sortRows(rows, col({ value: (r) => r.code }), "desc")), [1, 2, 3]);
});

test("numbers sort as numbers, not as text", () => {
  const rows: Row[] = [{ id: 1, amount: 100 }, { id: 2, amount: 9 }, { id: 3, amount: 25 }];
  assert.deepEqual(ids(sortRows(rows, col({ kind: "number", value: (r) => r.amount }), "asc")), [2, 3, 1]);
});

test("dates written YYYY-MM-DD sort oldest to newest", () => {
  const rows: Row[] = [{ id: 1, day: "2026-10-05" }, { id: 2, day: "2025-12-27" }, { id: 3, day: "2026-01-02" }];
  assert.deepEqual(ids(sortRows(rows, col({ kind: "date", value: (r) => r.day }), "asc")), [2, 3, 1]);
  assert.deepEqual(ids(sortRows(rows, col({ kind: "date", value: (r) => r.day }), "desc")), [1, 3, 2]);
});

test("empty values go last in both directions", () => {
  const rows: Row[] = [{ id: 1, code: null }, { id: 2, code: "B" }, { id: 3, code: "" }, { id: 4, code: "A" }];
  assert.deepEqual(ids(sortRows(rows, col({ value: (r) => r.code }), "asc")), [4, 2, 1, 3]);
  assert.deepEqual(ids(sortRows(rows, col({ value: (r) => r.code }), "desc")), [2, 4, 1, 3]);
});

test("rows that tie keep the order they came in", () => {
  const rows: Row[] = [{ id: 1, code: "X" }, { id: 2, code: "X" }, { id: 3, code: "X" }];
  assert.deepEqual(ids(sortRows(rows, col({ value: (r) => r.code }), "asc")), [1, 2, 3]);
  assert.deepEqual(ids(sortRows(rows, col({ value: (r) => r.code }), "desc")), [1, 2, 3]);
});

test("with no column the list is left exactly as it is", () => {
  const rows: Row[] = [{ id: 2 }, { id: 1 }];
  assert.equal(sortRows(rows, undefined, "asc"), rows);
});

test("the original list is never changed", () => {
  const rows: Row[] = [{ id: 1, code: "B" }, { id: 2, code: "A" }];
  sortRows(rows, col({ value: (r) => r.code }), "asc");
  assert.deepEqual(ids(rows), [1, 2]);
});

test("status sorts by progress, not alphabetically", () => {
  const rows: Row[] = [{ id: 1, stage: "delivered" }, { id: 2, stage: "booked" }, { id: 3, stage: "at_warehouse" }, { id: 4, stage: "returned" }];
  const byStage = col({ kind: "number", value: (r) => orderOf(STAGE_ORDER, r.stage) });
  assert.deepEqual(ids(sortRows(rows, byStage, "asc")), [2, 3, 1, 4]);
  assert.equal(orderOf(CONTAINER_ORDER, "arrived"), 2);
  assert.equal(orderOf(CONTAINER_ORDER, "nonsense"), CONTAINER_ORDER.length); // unknown goes last
});

test("the first click: text A to Z, numbers and dates biggest or newest first, unless the column says otherwise", () => {
  assert.equal(firstDirOf(col({ value: () => 1 })), "asc");
  assert.equal(firstDirOf(col({ kind: "number", value: () => 1 })), "desc");
  assert.equal(firstDirOf(col({ kind: "date", value: () => 1 })), "desc");
  assert.equal(firstDirOf(col({ kind: "number", firstDir: "asc", value: () => 1 })), "asc");
});

// ---- the data layer (sample data) sorts Customers and Accounts the way the database does
import { readFileSync } from "node:fs";
import { createMockClient } from "../src/lib/mock-supabase.ts";

test("customers: sorted by the data layer, anything else means the normal order (by name)", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = createMockClient();
  const names = async (sort: string | null, dir: string | null) => ((await c.rpc("list_customers", { p_limit: 200, p_offset: 0, p_sort: sort, p_dir: dir })).data.customers as { full_name: string }[]).map((x) => x.full_name);
  const normal = await names(null, null);
  assert.deepEqual(normal, [...normal].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(await names("name", "desc"), [...normal].reverse());
  assert.deepEqual(await names("name; drop table customers", "asc"), normal);
  const byInvoices = (await c.rpc("list_customers", { p_limit: 200, p_offset: 0, p_sort: "invoices", p_dir: "desc" })).data.customers as { invoices: number }[];
  assert.deepEqual(byInvoices.map((x) => x.invoices), [...byInvoices.map((x) => x.invoices)].sort((a, b) => b - a));
  const search = (await c.rpc("search_customers", { p_query: normal[0].slice(0, 3), p_limit: 50, p_sort: "name", p_dir: "desc" })).data.customers as { full_name: string }[];
  assert.deepEqual(search.map((x) => x.full_name), [...search.map((x) => x.full_name)].sort((a, b) => b.localeCompare(a)));
});

test("accounts: invoices sorted by the data layer; the normal order is newest invoice first, and short numbers sort as numbers", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = createMockClient();
  const make = async (invoice: string, amount: number, name: string) =>
    (await c.from("bookings").insert({ sender_name: name, sender_phone: "+971501110009", pickup_area: "Dubai", pickup_address: "x", pickup_date: "2026-01-02", invoice_no: invoice, invoice_amount: amount }).select("*").single()).data;
  await make("INV-9001", 100, "SortAcc Zed");
  await make("INV-9010", 200, "SortAcc Amy");
  await make("INV-5", 50, "SortAcc Mid"); // a short number: 5 comes before 9001 (numbers are compared as numbers, not as text)
  const list = async (sort: string | null, dir: string | null) =>
    ((await c.rpc("accounts_invoices", { p_status: "all", p_search: "SortAcc", p_limit: 25, p_offset: 0, p_sort: sort, p_dir: dir })).data as { r_invoice_no: string }[]).map((r) => r.r_invoice_no);
  assert.deepEqual(await list(null, null), ["INV-9010", "INV-9001", "INV-5"]);
  assert.deepEqual(await list("invoice", "asc"), ["INV-5", "INV-9001", "INV-9010"]);
  assert.deepEqual(await list("amount", "desc"), ["INV-9010", "INV-9001", "INV-5"]);
  assert.deepEqual(await list("customer", "asc"), ["INV-9010", "INV-5", "INV-9001"]);
  assert.deepEqual(await list("nonsense", "asc"), ["INV-9010", "INV-9001", "INV-5"]);
});

test("the four lists keep using the sortable headings", () => {
  for (const f of ["src/app/bookings/page.tsx", "src/app/customers/page.tsx", "src/app/containers/page.tsx", "src/app/accounts/page.tsx"]) {
    const code = readFileSync(f, "utf8");
    assert.equal(/<th className="px-4 py-3/.test(code), false, `${f} has a heading that cannot be sorted`);
    assert.ok(code.includes("SortableTh") && code.includes("SortSelect") || f.endsWith("accounts/page.tsx"), `${f} should offer sorting`);
  }
});
