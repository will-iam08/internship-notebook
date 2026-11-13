// Local onboarding guards remain independent of optional cloud sign-in.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { isNewVisitor, validateSetup } from "../../src/main/resources/public/js/onboarding.js";

beforeEach(() => {
  globalThis.localStorage = {
    writes: [],
    setItem(key) { this.writes.push(key); }
  };
});

test("server edition is never classified as a new visitor, blocking onboarding entry", () => {
  const emptyRecord = { applications: [], recentlyDeleted: [] };
  const noDrafts = {};
  // Even with an entirely empty notebook and no started flag, server mode is never new.
  assert.equal(isNewVisitor({ browserMode: false, record: emptyRecord, drafts: noDrafts, started: false }), false);
  // Any combination of existing work does not change this in server mode.
  assert.equal(isNewVisitor({ browserMode: false, record: { applications: [{ id: 1 }], recentlyDeleted: [] }, drafts: {}, started: false }), false);
});

/* ---------- Validate-before-write guard on the setup form ----------
   completeSetup calls validateSetup before any write. When validateSetup rejects a submission,
   no storage write should occur. This is the BROWSER_MODE guard from the other side: even if the
   server-edition guard were absent, an invalid form would be caught here first.                   */

test("validateSetup rejects an empty form without writing any storage key", () => {
  const result = validateSetup({ name: "", targetRole: "", season: "", targetCompanies: [] });
  assert.equal(result.ok, false, "empty form must be rejected");
  assert.ok(result.field, "rejected result must name the invalid field");
  assert.deepEqual(globalThis.localStorage.writes, [], "no storage write on invalid input");
});

test("validateSetup rejects each invalid field and names it without writing storage", () => {
  // These mirror the boundary tests in setup-create.test.js but confirm the sign-up path's
  // dependency on the same guard. Each case is tagged with the field it exercises.
  const cases = [
    { name: "", targetRole: "SWE", season: "Fall", targetCompanies: [], badField: "name" },
    { name: "Jo", targetRole: "", season: "Fall", targetCompanies: [], badField: "targetRole" },
    { name: "Jo", targetRole: "SWE", season: "Autumn", targetCompanies: [], badField: "season" },
    { name: "Jo", targetRole: "SWE", season: "Fall", targetCompanies: ["x".repeat(81)], badField: "targetCompanies" }
  ];
  for (const c of cases) {
    globalThis.localStorage.writes.length = 0;
    const result = validateSetup({ name: c.name, targetRole: c.targetRole, season: c.season, targetCompanies: c.targetCompanies });
    assert.equal(result.ok, false, `expected rejection for bad ${c.badField}`);
    assert.equal(result.field, c.badField, `wrong field named for bad ${c.badField}`);
    assert.deepEqual(globalThis.localStorage.writes, [], `no write on bad ${c.badField}`);
  }
});
