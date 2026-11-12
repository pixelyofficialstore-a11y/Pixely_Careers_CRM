import { test } from "node:test";
import assert from "node:assert/strict";
import { pkPhoneKey, waLink } from "./phone";

test("pkPhoneKey normalises Pakistani formats to one key", () => {
  for (const p of ["0300 1234567", "+92 300 1234567", "92-300-1234567", "300 1234567", "0092 300 1234567", "+92 (300) 123-4567"]) {
    assert.equal(pkPhoneKey(p), "923001234567", p);
  }
});

test("pkPhoneKey keeps other countries and handles empties", () => {
  assert.equal(pkPhoneKey("+971 50 123 4567"), "971501234567");
  assert.equal(pkPhoneKey("00971501234567"), "971501234567");
  assert.equal(pkPhoneKey(""), null);
  assert.equal(pkPhoneKey(null), null);
  assert.equal(pkPhoneKey("--"), null);
});

test("waLink builds a wa.me URL with encoded text", () => {
  assert.equal(waLink("0300 1234567", "Hi Ali & co"), "https://wa.me/923001234567?text=Hi%20Ali%20%26%20co");
  assert.equal(waLink("123"), null);
});
