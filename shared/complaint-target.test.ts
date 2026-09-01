import assert from "node:assert/strict";
import test from "node:test";
import { api } from "./routes";

const validComplaint = {
  orderId: 42,
  category: "communication_issue",
  description: "The assigned order needs review.",
};

test("complaint creation accepts the normal designer target", () => {
  assert.equal(api.complaints.create.input.safeParse(validComplaint).success, true);
  assert.equal(api.complaints.create.input.safeParse({ ...validComplaint, complaintTargetType: "designer" }).success, true);
});

test("complaint creation rejects client target aliases", () => {
  for (const field of ["complaintTargetType", "complaint_target_type", "target_type", "targetType"]) {
    assert.equal(
      api.complaints.create.input.safeParse({ ...validComplaint, [field]: "client" }).success,
      false,
      `expected ${field}=client to be rejected`,
    );
  }
});