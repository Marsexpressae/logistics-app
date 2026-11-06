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

const list = () => read("src/components/warehouse/ToPrepareList.tsx");

test("the To prepare list shows the pick list with places, gates Prepare and Cancel, and says when parcels changed or are gone", () => {
  const code = list();
  for (const needle of ["pickList", "changedCount", "requestLine", "position", "prepare_return", "cancel_return_request", "To prepare", "Nothing left to return", "Some requested parcels have changed", "Prepare return", "Cancel request"]) {
    assert.ok(code.includes(needle), `the list should use ${needle}`);
  }
  assert.match(code, /canPrepare &&/);
  assert.match(code, /canCancel &&/);
  assert.ok(code.includes("confirmAction") && code.includes("danger: true"));
  assert.equal(/\b(window\.)?(confirm|alert|prompt)\(/.test(code), false);
  assert.ok(code.includes("min-h-16") && code.includes("<Button"), "the row is 64px tall and the actions are the shared 44px buttons");
  assert.ok(code.includes("aria-expanded"));
  assert.equal(/text-xs/.test(code), false);
  assert.equal(/\bz-\d/.test(code), false);
});

test("the warehouse page loads open requests, shows the list on the Returns tab and counts them", () => {
  const page = read("src/app/warehouse-inventory/page.tsx");
  assert.ok(page.includes("ToPrepareList") && page.includes("return_requests"));
  assert.ok(page.includes('can("returns.prepare")'));
  assert.match(page, /openReturnCount \+/, "the Returns tab count includes the waiting requests");
  const badges = read("src/lib/badges.tsx");
  assert.ok(badges.includes("return_requests"), "the Warehouse menu badge counts waiting requests too");
});

test("notifications: the three new kinds have icons and the right link; the audit log labels the table", () => {
  const page = read("src/app/notifications/page.tsx");
  for (const kind of ["return_requested", "return_request_cancelled", "return_prepared"]) assert.ok(page.includes(kind), kind);
  assert.ok(page.includes("notificationHref"));
  assert.ok(read("src/components/notifications/NotificationToast.tsx").includes("notificationHref"));
  assert.ok(read("src/components/audit/AuditList.tsx").includes("return_requests"));
});
