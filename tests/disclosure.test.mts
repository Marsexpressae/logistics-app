// Settings and Roles open and close their sections with the one shared Disclosure, not their own copies.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Settings and Roles use the shared Disclosure", () => {
  for (const f of ["src/app/settings/roles/page.tsx", "src/components/ui/CollapsibleCard.tsx"]) {
    const code = readFileSync(f, "utf8");
    assert.equal(code.includes("aria-expanded"), false, `${f} builds its own open/close button`);
    assert.equal(code.includes("ChevronRight"), false, `${f} draws its own chevron`);
    assert.ok(code.includes("components/ui/Disclosure"), `${f} should use Disclosure`);
  }
});
