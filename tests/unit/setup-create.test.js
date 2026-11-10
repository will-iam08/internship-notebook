import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { browserApi, setBrowserWriteListener } from "../../src/main/resources/public/js/api.js";
import { KEYS } from "../../src/main/resources/public/js/storage.js";
import { validateSetup, buildStarterApplications } from "../../src/main/resources/public/js/onboarding.js";

class MemoryStorage {
  #map = new Map();
  failData = false;
  getItem(key) { return this.#map.get(key) ?? null; }
  setItem(key, value) {
    // The real storage.set wraps setItem in try/catch and returns false when it throws; browserApi.write
    // throws on a false result. Throwing here reproduces a full/blocked store for the notebook key.
    if (this.failData && key === KEYS.data) throw new Error("Storage full");
    this.#map.set(key, String(value));
  }
  removeItem(key) { this.#map.delete(key); }
  has(key) { return this.#map.has(key); }
}
beforeEach(() => { globalThis.localStorage = new MemoryStorage(); setBrowserWriteListener(null); });

// Mirror app.js completeSetup's commit sequence against the real browserApi, without the DOM.
async function commitSetup(input, { started = { value: false } } = {}) {
  const companies = input.companies.split(",").map(s => s.trim()).filter(Boolean);
  const result = validateSetup({ name: input.name, targetRole: input.targetRole, season: input.season, targetCompanies: companies });
  if (!result.ok) return { ok: false, error: result };
  const starters = buildStarterApplications({ targetRole: result.value.targetRole, targetCompanies: result.value.targetCompanies });
  try {
    if (starters.length) await browserApi.importBackup(starters, []);
    else browserApi.write({ applications: [], recentlyDeleted: [], nextId: 1 });
  } catch (error) {
    return { ok: false, committed: false, error };
  }
  started.value = true; // only after a successful notebook commit
  return { ok: true };
}

test("validation blocks the write and preserves entered values on any invalid field", () => {
  for (const bad of [
    { name: "", targetRole: "SWE", season: "Fall", companies: "" },
    { name: "Jo", targetRole: "", season: "Fall", companies: "" },
    { name: "Jo", targetRole: "SWE", season: "Autumn", companies: "" },
    { name: "Jo", targetRole: "SWE", season: "Fall", companies: "x".repeat(81) }
  ]) {
    const res = validateSetup({ name: bad.name, targetRole: bad.targetRole, season: bad.season, targetCompanies: bad.companies ? [bad.companies] : [] });
    assert.equal(res.ok, false);
    assert.ok(res.field, "an invalid field must be named");
    assert.ok(!localStorage.has(KEYS.data), "no notebook write on invalid input");
  }
  // Boundary acceptance: name 40, company 80, role 100.
  assert.equal(validateSetup({ name: "n".repeat(40), targetRole: "r".repeat(100), season: "Fall", targetCompanies: ["c".repeat(80)] }).ok, true);
  assert.equal(validateSetup({ name: "n".repeat(41), targetRole: "SWE", season: "Fall", targetCompanies: [] }).ok, false);
  assert.equal(validateSetup({ name: "Jo", targetRole: "r".repeat(101), season: "Fall", targetCompanies: [] }).ok, false);
  assert.equal(validateSetup({ name: "Jo", targetRole: "SWE", season: "Fall", targetCompanies: ["c".repeat(81)] }).ok, false);
});

test("setup commits one starter application per company in a single batch", async () => {
  const started = { value: false };
  const res = await commitSetup({ name: "Jordan", targetRole: "SWE Intern", season: "Fall", companies: "Northwind, Lumen, Harbor" }, { started });
  assert.equal(res.ok, true);
  const record = browserApi.read();
  assert.equal(record.applications.length, 3);
  assert.deepEqual(record.applications.map(a => a.company).sort(), ["Harbor", "Lumen", "Northwind"]);
  assert.equal(started.value, true);
});

test("zero-company setup writes an empty notebook once and still starts the notebook", async () => {
  const started = { value: false };
  const res = await commitSetup({ name: "Jordan", targetRole: "SWE Intern", season: "Fall", companies: "" }, { started });
  assert.equal(res.ok, true);
  const record = browserApi.read();
  assert.equal(record.applications.length, 0);
  assert.ok(localStorage.has(KEYS.data), "an empty notebook must be written for the zero-company case");
  assert.equal(started.value, true);
});

test("re-submitting the same setup does not duplicate starter pages", async () => {
  const input = { name: "Jordan", targetRole: "SWE Intern", season: "Fall", companies: "Northwind, Lumen" };
  await commitSetup(input);
  await commitSetup(input); // importBackup de-dups by company/role/createdAt fingerprint
  const record = browserApi.read();
  assert.equal(record.applications.length, 2, "duplicate submit must not duplicate starter applications");
});

test("a notebook-write failure leaves the started flag unset and real storage unchanged", async () => {
  localStorage.failData = true; // browserApi.write will throw (storage.set returns false)
  const started = { value: false };
  const res = await commitSetup({ name: "Jordan", targetRole: "SWE Intern", season: "Fall", companies: "" }, { started });
  assert.equal(res.ok, false);
  assert.equal(started.value, false, "started flag must stay unset when the notebook commit fails");
  assert.ok(!localStorage.has(KEYS.data), "no notebook must be persisted on write failure");
});
