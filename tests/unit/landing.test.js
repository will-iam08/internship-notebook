import assert from "node:assert/strict";
import test from "node:test";
import {
  HERO_HEADLINE,
  HERO_SUBHEAD,
  LANDING_FEATURES,
  MIN_SCROLL_DURATION_MS,
  MAX_SCROLL_DURATION_MS,
  REDIRECT_DELAY_MS,
  clampScrollDuration,
  clearActiveSession,
  easeInOutCubic,
  evaluatePasswordStrength,
  hashCredential,
  isValidEmail,
  readActiveSession,
  registerLocalAccount,
  authenticateLocalAccount,
  shouldGateWithLanding,
  validateLandingAuth
} from "../../src/main/resources/public/js/landing.js";

function createMemoryStore() {
  const map = new Map();
  return {
    get(key) { return map.has(key) ? map.get(key) : null; },
    set(key, value) { map.set(key, String(value)); return true; },
    remove(key) { map.delete(key); return true; }
  };
}

test("Hero copy respects strict character budgets and has no placeholder text", () => {
  assert.ok(HERO_HEADLINE.length > 0 && HERO_HEADLINE.length <= 60, `Expected H1 <= 60 chars, got ${HERO_HEADLINE.length}`);
  assert.ok(HERO_SUBHEAD.length > 0 && HERO_SUBHEAD.length <= 180, `Expected subhead <= 180 chars, got ${HERO_SUBHEAD.length}`);
  assert.ok(!/lorem ipsum/i.test(HERO_HEADLINE));
  assert.ok(!/lorem ipsum/i.test(HERO_SUBHEAD));
  assert.ok(!HERO_HEADLINE.includes("\u2014"));
  assert.ok(!HERO_SUBHEAD.includes("\u2014"));
});

test("Features section defines 6 distinct features ordered by user-perceived value", () => {
  assert.equal(LANDING_FEATURES.length, 6);
  const ranks = LANDING_FEATURES.map(feature => feature.rank);
  assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6]);

  const ids = new Set(LANDING_FEATURES.map(feature => feature.id));
  assert.equal(ids.size, 6);

  for (const feature of LANDING_FEATURES) {
    assert.ok(feature.title.length >= 10);
    assert.ok(feature.icon.length > 0);
    assert.ok(feature.visualAlt.length >= 20);
    assert.ok(!/lorem ipsum/i.test(feature.description));
    assert.ok(!feature.description.includes("\u2014"));
    const sentences = feature.description.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.ok(sentences.length >= 2 && sentences.length <= 3, `Expected 2-3 sentences for ${feature.id}, got ${sentences.length}`);
  }
});

test("isValidEmail validates standard email addresses and rejects malformed strings", () => {
  assert.equal(isValidEmail("alex@waterloo.ca"), true);
  assert.equal(isValidEmail("  maya.patel+coop@stanford.edu  "), true);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("missing-tld@domain"), false);
  assert.equal(isValidEmail("a@b.c"), false);
  assert.equal(isValidEmail("spaces in@email.com"), false);
});

test("evaluatePasswordStrength enforces minimum 8 chars, at least 1 letter, and at least 1 number", () => {
  assert.deepEqual(evaluatePasswordStrength(""), {
    score: 0,
    label: "Enter a password",
    meetsRequirements: false,
    checks: { hasMinLength: false, hasLetter: false, hasNumber: false }
  });

  const short = evaluatePasswordStrength("Abc12");
  assert.equal(short.meetsRequirements, false);
  assert.equal(short.checks.hasMinLength, false);
  assert.equal(short.checks.hasLetter, true);
  assert.equal(short.checks.hasNumber, true);

  const noNumber = evaluatePasswordStrength("NotebookOnly");
  assert.equal(noNumber.meetsRequirements, false);
  assert.equal(noNumber.checks.hasNumber, false);

  const noLetter = evaluatePasswordStrength("1234567890");
  assert.equal(noLetter.meetsRequirements, false);
  assert.equal(noLetter.checks.hasLetter, false);

  const fair = evaluatePasswordStrength("intern26");
  assert.equal(fair.meetsRequirements, true);
  assert.equal(fair.score, 2);
  assert.equal(fair.label, "Fair");

  const good = evaluatePasswordStrength("Internship26");
  assert.equal(good.meetsRequirements, true);
  assert.equal(good.score, 3);
  assert.equal(good.label, "Good");

  const strong = evaluatePasswordStrength("Internship2026!Coop");
  assert.equal(strong.meetsRequirements, true);
  assert.equal(strong.score, 4);
  assert.equal(strong.label, "Strong");
});

test("validateLandingAuth reports inline errors and preserves all entered values on failure", () => {
  const invalid = validateLandingAuth({
    fullName: "A",
    email: "invalid-email",
    password: "short"
  }, { mode: "signup" });

  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.fullName);
  assert.ok(invalid.errors.email);
  assert.ok(invalid.errors.password);
  assert.deepEqual(invalid.values, {
    fullName: "A",
    email: "invalid-email",
    password: "short"
  });

  const valid = validateLandingAuth({
    fullName: "Jordan Lee",
    email: "Jordan.Lee@University.edu",
    password: "Notebook2026"
  }, { mode: "signup" });

  assert.equal(valid.ok, true);
  assert.deepEqual(valid.errors, {});
  assert.equal(valid.cleaned.email, "jordan.lee@university.edu");
});

test("clampScrollDuration and easeInOutCubic obey 400ms-800ms smooth scroll bounds", () => {
  assert.equal(MIN_SCROLL_DURATION_MS, 400);
  assert.equal(MAX_SCROLL_DURATION_MS, 800);
  assert.equal(REDIRECT_DELAY_MS, 2000);
  assert.equal(clampScrollDuration(100), 400);
  assert.equal(clampScrollDuration(560), 560);
  assert.equal(clampScrollDuration(1500), 800);
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(1), 1);
});

test("registerLocalAccount and authenticateLocalAccount manage accounts and preserve values on failure", () => {
  const store = createMemoryStore();
  const created = registerLocalAccount(store, {
    fullName: "Jordan Lee",
    email: "jordan@waterloo.ca",
    password: "CoopSearch26"
  });

  assert.equal(created.ok, true);
  assert.equal(created.account.fullName, "Jordan Lee");
  assert.equal(created.account.email, "jordan@waterloo.ca");
  assert.equal(readActiveSession(store)?.email, "jordan@waterloo.ca");

  // Duplicate signup fails with specific error and preserves entered values
  const duplicate = registerLocalAccount(store, {
    fullName: "Jordan Lee",
    email: "JORDAN@waterloo.ca",
    password: "CoopSearch26"
  });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.message, /already exists/i);
  assert.equal(duplicate.values.email, "JORDAN@waterloo.ca");

  clearActiveSession(store);
  assert.equal(readActiveSession(store), null);

  // Wrong password preserves entered values
  const wrongPw = authenticateLocalAccount(store, {
    email: "jordan@waterloo.ca",
    password: "WrongPassword99"
  });
  assert.equal(wrongPw.ok, false);
  assert.match(wrongPw.message, /Incorrect password/i);
  assert.equal(wrongPw.values.password, "WrongPassword99");

  // Valid sign in restores active session
  const signedIn = authenticateLocalAccount(store, {
    email: "jordan@waterloo.ca",
    password: "CoopSearch26"
  });
  assert.equal(signedIn.ok, true);
  assert.equal(readActiveSession(store)?.fullName, "Jordan Lee");
  assert.equal(hashCredential("jordan@waterloo.ca", "CoopSearch26"), hashCredential("JORDAN@WATERLOO.CA", "CoopSearch26"));
});

test("shouldGateWithLanding gates unauthenticated browser visitors and allows authenticated sessions", () => {
  assert.equal(shouldGateWithLanding({
    browserMode: true,
    record: { applications: [] },
    drafts: {},
    started: false,
    session: null
  }), true);

  assert.equal(shouldGateWithLanding({
    browserMode: true,
    record: { applications: [] },
    drafts: {},
    started: false,
    session: { email: "jordan@waterloo.ca", fullName: "Jordan Lee" }
  }), false);

  assert.equal(shouldGateWithLanding({
    browserMode: false,
    record: { applications: [] },
    drafts: {},
    started: false,
    session: null
  }), false);
});

test("shouldGateWithLanding: notebook data or a started flag without a session still shows the landing page", () => {
  const work = { applications: [{ id: 1, company: "Acme", role: "Intern" }] };
  assert.equal(shouldGateWithLanding({ browserMode: true, record: work, drafts: {}, started: true, session: null }), true);
  assert.equal(shouldGateWithLanding({ browserMode: true, record: work, drafts: {}, started: true, session: { email: "  " } }), true);
  assert.equal(shouldGateWithLanding({ browserMode: true, session: { email: "jordan@waterloo.ca" } }), false);
});
