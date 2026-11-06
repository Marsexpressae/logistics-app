// The return-request screens follow the permission rules of the spec and the project rules (read from the source, like celebrations-screens.test.mts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const card = () => read("src/components/bookings/ReturnRequestCard.tsx");

test("the Return card needs returns.request, uses the two request functions and the parcel list function (never a direct read of parcels)", () => {
  const code = card();
  assert.ok(code.includes('can("returns.request")'));
  for (const needle of ["request_return", "cancel_return_request", "parcels_for_return_request", "return_requests"]) assert.ok(code.includes(needle), `the card should use ${needle}`);
  assert.equal(/from\("parcels"\)/.test(code), false, "people who may request do not necessarily see the warehouse tables");
  assert.ok(code.includes("limit(1)"), "only the latest request of the booking is loaded");
});

test("the Return card follows the project rules: shared date control, no browser dialogs, 44px buttons, readable text, named layers", () => {
  const code = card();
  assert.ok(code.includes("DateField"));
  assert.equal(/type="date"/.test(code), false);
  assert.ok(code.includes("confirmAction") && code.includes("danger: true"));
  assert.equal(/\b(window\.)?(confirm|alert|prompt)\(/.test(code), false);
  assert.equal(/\bz-\d/.test(code), false);
  assert.equal(/text-xs/.test(code), false);
  assert.match(code, /disabled=\{[^}]*ticked/, "Send request is off while no parcel is ticked");
  assert.ok(code.includes("Request return") && code.includes("Send request") && code.includes("Cancel request") && code.includes("Prepared as"));
  assert.ok(code.includes("/warehouse-inventory/returns/"), "a prepared request links to its return form");
});

test("the booking page shows the Return card, and the history knows the two new kinds", () => {
  const page = read("src/app/bookings/[id]/page.tsx");
  assert.ok(page.includes("ReturnRequestCard"));
  const history = read("src/components/bookings/ScheduleHistory.tsx");
  assert.ok(history.includes("return_requested") && history.includes("return_request_cancelled"));
  assert.ok(read("src/lib/types.ts").includes('"return_request_cancelled"'));
});

test("the shared date control can allow a day still to come (needed by)", () => {
  const code = read("src/components/ui/DateField.tsx");
  assert.ok(code.includes("future"));
  assert.ok(card().includes("future"), "the Return card asks for a day that is still to come");
});
