import test from "node:test";
import assert from "node:assert/strict";
// Pure functions only; the pool is created lazily and never connects in this test.
process.env.DATABASE_URL ||= "postgres://unused:unused@127.0.0.1:1/unused";
const { buildMetaCustomerRows, countryFromPhone } = await import("../metaCustomerList");

test("meta customer list: one row per normalized phone, value summed in PKR, invalid phones skipped", () => {
  const rows = buildMetaCustomerRows([
    { client_phone: "0300-1234567", client_email: "A@X.com", client_name: "Ali Khan", paid: "250000", last_at: new Date("2026-01-01") },
    { client_phone: "+92 300 1234567", client_email: null, client_name: "Ali Raza Khan", paid: "100000", last_at: new Date("2026-02-01") },
    { client_phone: "abc", client_email: "z@z.com", client_name: "No Phone", paid: "500000", last_at: new Date() },
    { client_phone: "+971501234567", client_email: "", client_name: "Sara", paid: "300000", last_at: new Date() },
  ]);
  assert.equal(rows.length, 2);
  const ali = rows.find(r => r.phone === "923001234567")!;
  assert.equal(ali.value, 3500);
  assert.equal(ali.email, "a@x.com");
  assert.equal(ali.fn, "ali");
  assert.equal(ali.ln, "khan");
  assert.equal(ali.country, "pk");
  assert.equal(rows.find(r => r.phone === "971501234567")!.country, "ae");
});

test("country from phone prefix", () => {
  assert.equal(countryFromPhone("966500000000"), "sa");
  assert.equal(countryFromPhone("447700900000"), "gb");
  assert.equal(countryFromPhone("12025550123"), "us");
  assert.equal(countryFromPhone("491701234567"), "");
});
