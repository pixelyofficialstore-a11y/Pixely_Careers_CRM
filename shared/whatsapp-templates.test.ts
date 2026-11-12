import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WHATSAPP_TEMPLATES, fillTemplate } from "./whatsapp-templates";

test("fillTemplate fills placeholders and tidies empty ones", () => {
  assert.equal(fillTemplate("Hi {name}, order {order} is ready. {link}", { name: "Ali", order: "PX-1" }), "Hi Ali, order PX-1 is ready.");
  assert.equal(fillTemplate("Paid {amount}, balance {balance}.", { amount: "Rs 500", balance: "Rs 0" }), "Paid Rs 500, balance Rs 0.");
  assert.equal(fillTemplate("Hi {name} !", {}), "Hi!");
});

test("default templates cover the five quick replies", () => {
  assert.deepEqual(DEFAULT_WHATSAPP_TEMPLATES.map(t => t.kind), ["payment_received", "draft_ready", "revision_done", "delivered", "review_request"]);
});
