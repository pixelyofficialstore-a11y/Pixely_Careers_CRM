import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessComplaintCase,
  canAccessOrderCase,
  projectCaseActivity,
} from "./case-access";

test("standalone complaints enforce the same role ownership used by nested cases", () => {
  assert.equal(canAccessComplaintCase("admin", 1, 2, 3), true);
  assert.equal(canAccessComplaintCase("support", 2, 2, 3), true);
  assert.equal(canAccessComplaintCase("support", 4, 2, 3), false);
  assert.equal(canAccessComplaintCase("designer", 3, 2, 3), true);
  assert.equal(canAccessComplaintCase("designer", 5, 2, 3), false);
});

test("client-target complaints are visible to their filer but never to an unrelated designer", () => {
  assert.equal(canAccessComplaintCase("designer", 7, 7, null, "client"), true);
  assert.equal(canAccessComplaintCase("designer", 8, 7, null, "client"), false);
  assert.equal(canAccessComplaintCase("support", 7, 7, null, "client"), true);
  assert.equal(canAccessComplaintCase("admin", 8, 7, null, "client"), true);
});

test("designer-target complaints remain visible to the assigned designer", () => {
  assert.equal(canAccessComplaintCase("designer", 8, 7, 8, "designer"), true);
  assert.equal(canAccessComplaintCase("designer", 9, 7, 8, "designer"), false);
  assert.equal(canAccessComplaintCase("designer", 8, 7, 8, "client"), false);
});

test("nested review, suggestion, complaint, and report entry points reject another designer's order", () => {
  assert.equal(canAccessOrderCase("admin", 1, 3), true);
  assert.equal(canAccessOrderCase("support", 2, 3), true);
  assert.equal(canAccessOrderCase("designer", 3, 3), true);
  assert.equal(canAccessOrderCase("designer", 5, 3), false);
  assert.equal(canAccessOrderCase("designer", 3, null), false);
});

test("support and designers never receive private suggestion note activity", () => {
  const activity = [{
    activityType: "suggestion_updated",
    actor: { id: 1, name: "Admin" },
    details: { event: "admin_note_added", suggestionId: 8 },
  }];

  assert.equal(projectCaseActivity(activity, "admin").length, 1);
  assert.deepEqual(projectCaseActivity(activity, "support"), []);
  assert.deepEqual(projectCaseActivity(activity, "designer"), []);
});

test("complaint note authors and values are redacted outside Admin across Order and report timelines", () => {
  const activity = [{
    activityType: "complaint_note",
    actor: { id: 1, name: "Admin" },
    previousValue: "private before",
    newValue: "private note",
    details: { complaintId: 7 },
  }];

  const admin = projectCaseActivity(activity, "admin")[0];
  assert.deepEqual(admin.actor, { id: 1, name: "Admin" });
  assert.equal(admin.newValue, "private note");

  for (const role of ["support", "designer"] as const) {
    const projected = projectCaseActivity(activity, role)[0];
    assert.equal(projected.actor, null);
    assert.equal(projected.previousValue, null);
    assert.equal(projected.newValue, null);
  }
});

test("non-private review, suggestion decision, upload, and notification history remains visible", () => {
  const activity = [
    { activityType: "review_updated", actor: { id: 2 }, details: { fields: ["rating", "screenshotUrl"] } },
    { activityType: "suggestion_status", actor: { id: 1 }, newValue: "implemented", details: { implementationScreenshotUrl: "https://res.cloudinary.com/demo/image/upload/evidence.png" } },
    { activityType: "complaint_status", actor: { id: 1 }, newValue: "resolved", details: { notification: "designer" } },
  ];

  const support = projectCaseActivity(activity, "support");
  assert.equal(support.length, 3);
  assert.deepEqual(support[0].details, { fields: ["rating", "screenshotUrl"] });
  assert.equal(support[1].newValue, "implemented");
  assert.equal(support[2].newValue, "resolved");
  assert.equal(support[2].actor, null);
});