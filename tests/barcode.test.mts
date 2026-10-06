// What a scanned or typed parcel barcode may look like.
import test from "node:test";
import assert from "node:assert/strict";
import { bookingCodeOf, parseParcelCode } from "../src/lib/barcode.ts";

test("real parcel barcodes are accepted, whatever the case or spacing", () => {
  assert.equal(parseParcelCode("BK-1004-P1"), "BK-1004-P1");
  assert.equal(parseParcelCode("  bk-1004-p2 "), "BK-1004-P2");
  assert.equal(parseParcelCode("BK-802-R2-P1"), "BK-802-R2-P1"); // a repacked parcel
  assert.equal(parseParcelCode("bk 1004 p1".replace(/ /g, "-")), "BK-1004-P1");
});

test("anything else a camera might read is ignored", () => {
  for (const junk of ["", "INV-3603", "BK-1004", "P1", "5901234123457", "https://example.com", "BK-1004-PX", "BK--P1"]) {
    assert.equal(parseParcelCode(junk), null, junk);
  }
});

test("the booking code is taken out of a parcel barcode", () => {
  assert.equal(bookingCodeOf("BK-1004-P1"), "BK-1004");
  assert.equal(bookingCodeOf("BK-802-R2-P1"), "BK-802");
  assert.equal(bookingCodeOf("38-P3"), "38");
});
