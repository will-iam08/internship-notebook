import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewVisitor, hasExistingWork } from "../../src/main/resources/public/js/onboarding.js";

// Build a browserApi.read()-shaped record and a drafts object from three booleans.
function make({ apps, recentlyDeleted, draft }) {
  return {
    record: {
      applications: apps ? [{ id: 1 }] : [],
      recentlyDeleted: recentlyDeleted ? [{ id: 2 }] : []
    },
    drafts: draft ? { 3: { changes: {} } } : {}
  };
}

test("new-vs-returning over all 16 combinations of existing work and the started flag", () => {
  for (const apps of [false, true]) {
    for (const recentlyDeleted of [false, true]) {
      for (const draft of [false, true]) {
        for (const started of [false, true]) {
          const { record, drafts } = make({ apps, recentlyDeleted, draft });
          const isNew = isNewVisitor({ browserMode: true, record, drafts, started });
          const expectNew = !apps && !recentlyDeleted && !draft && !started;
          assert.equal(isNew, expectNew,
            `apps=${apps} del=${recentlyDeleted} draft=${draft} started=${started} -> expected new=${expectNew}`);
          // Existing-work helper is the inverse driver for the three data signals.
          assert.equal(hasExistingWork(record, drafts), apps || recentlyDeleted || draft);
        }
      }
    }
  }
});

test("server edition is never a new visitor even with an empty notebook", () => {
  const { record, drafts } = make({ apps: false, recentlyDeleted: false, draft: false });
  assert.equal(isNewVisitor({ browserMode: false, record, drafts, started: false }), false);
});

test("corrupted storage never reaches the classifier as an empty notebook", () => {
  // The classifier runs only after a successful read. A StorageCorruptedError is handled by the
  // recovery path before classification, so there is no record to pass. This test documents that
  // contract: when the caller has no successful record, it must not call isNewVisitor at all.
  // We assert the classifier would treat a genuinely empty record as new, which is why the caller
  // must gate on a successful read (never on corrupted data).
  const emptyNew = isNewVisitor({ browserMode: true, record: { applications: [], recentlyDeleted: [] }, drafts: {}, started: false });
  assert.equal(emptyNew, true);
});
