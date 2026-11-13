import assert from "node:assert/strict";
import { test } from "node:test";
import { canShowWelcome, shouldLandOnWelcome } from "../../src/main/resources/public/js/onboarding.js";

const newcomer = { browserMode: true, newVisitor: true, demoActive: true, launchIntent: false };

test("a new website visitor arriving at the front door lands on the welcome page", () => {
  for (const hash of ["", "#", "#/", "#/welcome"]) {
    assert.equal(shouldLandOnWelcome({ ...newcomer, hash }), true, `hash=${JSON.stringify(hash)}`);
  }
});

test("deep links are respected, so a new visitor following #/board or #/entry/3 is not redirected", () => {
  for (const hash of ["#/today", "#/board", "#/notebook", "#/insights", "#/entry/3", "#/settings", "#/setup", "#/signup"]) {
    assert.equal(shouldLandOnWelcome({ ...newcomer, hash }), false, hash);
  }
});

test("returning visitors, the Server Edition, a failed demo, and launch intents never land on welcome", () => {
  assert.equal(shouldLandOnWelcome({ ...newcomer, hash: "", newVisitor: false }), false);
  assert.equal(shouldLandOnWelcome({ ...newcomer, hash: "", browserMode: false }), false);
  assert.equal(shouldLandOnWelcome({ ...newcomer, hash: "", demoActive: false }), false);
  assert.equal(shouldLandOnWelcome({ ...newcomer, hash: "", launchIntent: true }), false);
});

test("missing or odd inputs fail closed (no welcome redirect)", () => {
  assert.equal(shouldLandOnWelcome({}), false);
  assert.equal(shouldLandOnWelcome({ ...newcomer, hash: undefined }), true, "no hash at all is the front door");
  assert.equal(shouldLandOnWelcome({ ...newcomer, hash: 42 }), true, "a non-string hash is treated as no hash");
  assert.equal(shouldLandOnWelcome({ ...newcomer, newVisitor: "yes", hash: "" }), false);
});

test("the welcome page renders only in the website edition while the demo is active", () => {
  assert.equal(canShowWelcome({ browserMode: true, demoActive: true }), true);
  assert.equal(canShowWelcome({ browserMode: true, demoActive: false }), false);
  assert.equal(canShowWelcome({ browserMode: false, demoActive: true }), false);
  assert.equal(canShowWelcome({ browserMode: false, demoActive: false }), false);
});
