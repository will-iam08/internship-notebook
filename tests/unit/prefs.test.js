import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SEASONS, NAME_LIMIT, MAX_TARGET_COMPANIES,
  sanitizeTargetRole, sanitizeSeason, sanitizeTargetCompanies
} from "../../src/main/resources/public/js/onboarding.js";
import { LIMITS } from "../../src/main/resources/public/js/domain.js";

test("target role is kept as a string and capped at the role limit", () => {
  assert.equal(sanitizeTargetRole("Software Engineer"), "Software Engineer");
  assert.equal(sanitizeTargetRole(undefined), "");
  assert.equal(sanitizeTargetRole(123), "");
  assert.equal(sanitizeTargetRole("x".repeat(LIMITS.role + 10)).length, LIMITS.role);
});

test("season accepts only the known values", () => {
  for (const season of SEASONS) assert.equal(sanitizeSeason(season), season);
  assert.equal(sanitizeSeason("Autumn"), "");
  assert.equal(sanitizeSeason(""), "");
  assert.equal(sanitizeSeason(null), "");
});

test("target companies are trimmed, de-blanked, capped per-item and in count", () => {
  assert.deepEqual(sanitizeTargetCompanies(["  Acme  ", "", "   ", "Globex"]), ["Acme", "Globex"]);
  assert.deepEqual(sanitizeTargetCompanies("not an array"), []);
  const long = sanitizeTargetCompanies(["y".repeat(LIMITS.company + 5)]);
  assert.equal(long[0].length, LIMITS.company);
  const many = sanitizeTargetCompanies(Array.from({ length: MAX_TARGET_COMPANIES + 10 }, (_, i) => `C${i}`));
  assert.equal(many.length, MAX_TARGET_COMPANIES);
});

test("name limit matches the existing 40-char cap used across the app", () => {
  assert.equal(NAME_LIMIT, 40);
});
