import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LIMITS, normalize, dayKey } from "../../src/main/resources/public/js/domain.js";
import {
  START_MODES, USE_CASES, FOCUS_AREAS, MAX_USE_CASES, FICTIONAL_COMPANIES,
  START_MODE_COPY, USE_CASE_COPY, FOCUS_COPY,
  buildNotebookPlan, validatePlan, cleanUseCases, cleanFocusAreas, weeklyGoalFor
} from "../../src/main/resources/public/js/builder.js";

const NOW = new Date(2026, 10, 11, 9, 30); // a fixed "today" so date assertions are exact
const base = { startMode: "template", useCases: ["internship-search"], focusAreas: ["deadlines"], name: "Jordan", targetRole: "Software Engineering Intern", season: "Summer", targetCompanies: [] };
const plan = (changes = {}) => buildNotebookPlan({ ...base, ...changes }, { now: NOW });
const offset = days => { const date = new Date(NOW); date.setDate(date.getDate() + days); return dayKey(date); };

// Every combination of one or two use cases with every non-empty set of focus areas.
function* everyAnswer() {
  const caseSets = [...USE_CASES.map(useCase => [useCase]), ...USE_CASES.flatMap((a, i) => USE_CASES.slice(i + 1).map(b => [a, b]))];
  const focusSets = Array.from({ length: (1 << FOCUS_AREAS.length) - 1 }, (_, mask) => FOCUS_AREAS.filter((_, bit) => (mask + 1) & (1 << bit)));
  for (const useCases of caseSets) for (const focusAreas of focusSets) yield { useCases, focusAreas };
}

test("every option has a label and a one-line hint", () => {
  for (const [values, copy] of [[START_MODES, START_MODE_COPY], [USE_CASES, USE_CASE_COPY], [FOCUS_AREAS, FOCUS_COPY]]) {
    assert.deepEqual(Object.keys(copy).sort(), [...values].sort());
    for (const value of values) {
      assert.ok(copy[value].label.length > 0 && copy[value].hint.length > 0, value);
      assert.ok(copy[value].hint.length <= 90, `${value} hint should read in one go`);
    }
  }
});

test("a template plan has 2-4 example pages for every answer combination", () => {
  for (const answer of everyAnswer()) {
    const { applications } = plan(answer);
    assert.ok(applications.length >= 2 && applications.length <= 4, `${JSON.stringify(answer)} -> ${applications.length}`);
    assert.equal(new Set(applications.map(entry => entry.company)).size, applications.length, "no repeated company");
  }
  assert.equal(plan({ focusAreas: ["minimal"] }).applications.length, 2, "minimal stays lean");
  const lean = plan({ focusAreas: ["minimal", "interviews"] }).applications;
  assert.equal(lean.length, 2);
  assert.ok(lean.some(entry => entry.status === "INTERVIEW"), "minimal still gives the stage the focus asked for");
});

test("example pages use only invented companies, never a real employer", () => {
  const real = /\b(google|alphabet|microsoft|amazon|meta|facebook|apple|netflix|ibm|shopify|tesla|nvidia|oracle|intel)\b/i;
  for (const answer of everyAnswer()) {
    for (const entry of plan(answer).applications) {
      assert.ok(FICTIONAL_COMPANIES.includes(entry.company), entry.company);
      assert.doesNotMatch(`${entry.company} ${entry.notes} ${entry.contact}`, real);
    }
  }
});

test("pages are already in saved-page shape and inside every domain limit", () => {
  const long = { targetRole: "r".repeat(LIMITS.role), targetCompanies: ["c".repeat(LIMITS.company)] };
  for (const answer of [...everyAnswer()].slice(0, 40)) {
    for (const entry of plan({ ...answer, ...long }).applications) {
      const saved = normalize({ ...entry, id: 1 });
      for (const field of ["company", "role", "location", "source", "status", "deadline", "notes", "contact", "nextStep", "nextStepDate"]) {
        if (field in entry) assert.equal(saved[field], entry[field], `${field} survives normalize unchanged`);
      }
      if (entry.skills) assert.deepEqual(saved.skills, entry.skills);
      if (entry.history) {
        assert.deepEqual(saved.history, entry.history, "history survives normalize unchanged");
        assert.equal(saved.createdAt, entry.createdAt);
      }
      for (const [field, limit] of Object.entries(LIMITS)) {
        if (typeof entry[field] === "string") assert.ok(entry[field].length <= limit, `${field} within ${limit}`);
      }
      assert.ok(entry.company && entry.role, "company and role are required on every page");
    }
  }
});

test("examples carry notes, a contact or source, skill tags, and the right dates for their stage", () => {
  for (const entry of plan({ useCases: ["co-op", "research"], focusAreas: ["interviews"] }).applications) {
    assert.ok(entry.notes.startsWith("Example page"), "labelled as an example so it is easy to spot and delete");
    assert.ok(entry.skills.length > 0);
    assert.ok(entry.contact || entry.source);
    if (entry.status === "SAVED") assert.ok(entry.deadline, "a saved example has a deadline");
    else assert.ok(entry.nextStep && entry.nextStepDate, "an applied or interview example has a next step");
  }
});

test("every date falls between today and eight weeks out, and deadlines are never in the past", () => {
  const today = dayKey(NOW);
  const limit = offset(56);
  for (const answer of everyAnswer()) {
    for (const entry of plan(answer).applications) {
      for (const date of [entry.deadline, entry.nextStepDate].filter(Boolean)) {
        assert.ok(date >= today && date <= limit, `${entry.company}: ${date}`);
      }
      if (entry.deadline) assert.ok(entry.deadline > today, "a deadline is at least a day away");
    }
  }
  // Dates follow the clock: building a week later moves every date a week later.
  const later = buildNotebookPlan(base, { now: new Date(2026, 10, 18, 9, 30) });
  assert.equal(later.applications[0].deadline, (() => { const d = new Date(2026, 10, 18); d.setDate(d.getDate() + 5); return dayKey(d); })());
});

test("example histories sit before the current week, so they never count as sent this week", () => {
  const weekStart = new Date(NOW); weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
  for (const answer of [...everyAnswer()].slice(0, 60)) {
    for (const entry of plan(answer).applications.filter(item => item.history)) {
      assert.equal(entry.history.at(-1).status, entry.status, "history ends at the page's stage");
      for (const change of entry.history) assert.ok(new Date(change.at) < weekStart, `${entry.company} ${change.status} ${change.at}`);
      assert.ok(entry.createdAt <= entry.updatedAt);
    }
  }
});

test("the deadlines focus pulls Saved deadlines closer", () => {
  const relaxed = plan({ focusAreas: ["responses"] }).applications.find(entry => entry.status === "SAVED");
  const urgent = plan({ focusAreas: ["deadlines"] }).applications.find(entry => entry.status === "SAVED");
  assert.ok(urgent.deadline < relaxed.deadline);
});

test("focus areas tailor the pages: interviews adds an Interview page, responses an Applied one", () => {
  assert.ok(plan({ focusAreas: ["interviews"] }).applications.some(entry => entry.status === "INTERVIEW"));
  assert.ok(plan({ useCases: ["exploring"], focusAreas: ["responses"] }).applications.some(entry => entry.status === "APPLIED"));
  assert.equal(plan({ focusAreas: ["deadlines"] }).applications.filter(entry => entry.status === "INTERVIEW").length, 0);
});

test("the first example uses the visitor's target role; a second use case adds its own page", () => {
  const single = plan();
  assert.equal(single.applications[0].role, "Software Engineering Intern");
  const both = plan({ useCases: ["internship-search", "research"] });
  assert.ok(both.applications.some(entry => entry.company === "Fernhill University Lab"));
});

test("target companies become Saved pages, the same as guided setup, without repeating an example", () => {
  const withCompanies = plan({ targetCompanies: ["Kitebird Systems", "Northwind Labs"] });
  const companies = withCompanies.applications.map(entry => entry.company);
  assert.ok(companies.includes("Kitebird Systems"));
  assert.equal(companies.filter(company => company === "Northwind Labs").length, 1);
  assert.deepEqual(withCompanies.applications.at(-1), { company: "Northwind Labs", role: "Software Engineering Intern", status: "SAVED" });
  assert.ok(withCompanies.applications.filter(entry => FICTIONAL_COMPANIES.includes(entry.company) && entry.notes).length >= 2);
});

test("scratch and import give an empty notebook that is still started; only import opens the picker", () => {
  for (const startMode of ["scratch", "import"]) {
    const result = plan({ startMode, targetCompanies: ["Kitebird Systems"] });
    assert.deepEqual(result.applications, []);
    assert.equal(result.prefs.started, true);
    assert.equal(result.openImport, startMode === "import");
    assert.equal(result.startMode, startMode);
  }
  assert.equal(plan().openImport, false);
});

test("focus areas and use cases map to preferences and a weekly goal", () => {
  const result = plan({ useCases: ["new-grad"], focusAreas: ["openings", "deadlines"] });
  assert.deepEqual(result.prefs, {
    name: "Jordan", targetRole: "Software Engineering Intern", season: "Summer", targetCompanies: [],
    started: true, focusAreas: ["deadlines", "openings"], weeklyGoal: 7
  });
  assert.equal(weeklyGoalFor(["research"], ["responses"]), 3);
  assert.equal(weeklyGoalFor(["exploring", "co-op"], ["interviews"]), 5, "the busier use case sets the pace");
  assert.equal(weeklyGoalFor(["new-grad"], ["minimal", "deadlines"]), 3, "minimal caps the goal");
  assert.equal(weeklyGoalFor([], []), 5, "defaults to an internship search");
});

test("unknown or missing choices fall back to the defaults instead of throwing", () => {
  const result = buildNotebookPlan({ startMode: "nope", useCases: ["astronaut"], focusAreas: "deadlines" }, { now: NOW });
  assert.equal(result.startMode, "template");
  assert.deepEqual(result.prefs.focusAreas, ["deadlines"]);
  assert.ok(result.applications.length >= 2);
  assert.deepEqual(cleanUseCases(["co-op", "co-op", "research", "exploring"]), ["co-op", "research"]);
  assert.deepEqual(cleanFocusAreas(["minimal", "deadlines", "bogus", "minimal"]), ["deadlines", "minimal"]);
});

test("the summary names what the visitor will get", () => {
  const result = plan({ targetCompanies: ["Kitebird Systems"], focusAreas: ["deadlines", "interviews"] });
  assert.equal(result.summary.headline, "Jordan's notebook for Summer Software Engineering Intern roles.");
  const text = result.summary.bullets.join(" ");
  assert.match(text, /example pages to edit or delete: Northwind Labs/);
  assert.match(text, /1 page for your target companies/);
  assert.match(text, /Today leads with what's due next/);
  assert.match(text, /interview-stage pages/);
  assert.match(text, /Weekly goal: 6 applications/);
  assert.match(plan({ startMode: "scratch", name: "" }).summary.headline, /^Your notebook, starting empty\.$/);
  assert.match(plan({ startMode: "import" }).summary.bullets[0], /choose your backup file/);
});

test("plans never share objects: mutating one call's result leaves the next untouched", () => {
  const first = plan({ targetCompanies: ["Kitebird Systems"] });
  first.applications[0].company = "Changed";
  first.applications[0].skills.push("Mutated");
  first.prefs.focusAreas.push("minimal");
  first.prefs.targetCompanies.push("Changed");
  const second = plan({ targetCompanies: ["Kitebird Systems"] });
  assert.equal(second.applications[0].company, "Northwind Labs");
  assert.ok(!second.applications[0].skills.includes("Mutated"));
  assert.deepEqual(second.prefs.focusAreas, ["deadlines"]);
  assert.deepEqual(second.prefs.targetCompanies, ["Kitebird Systems"]);
  const input = { ...base, targetCompanies: ["Kitebird Systems"], useCases: ["co-op"] };
  const frozen = JSON.stringify(input);
  buildNotebookPlan(input, { now: NOW }).prefs.targetCompanies.push("x");
  assert.equal(JSON.stringify(input), frozen, "the answers passed in are not mutated");
});

test("validatePlan reports every invalid field using the guided-setup rules", () => {
  assert.deepEqual(validatePlan(base), { ok: true, errors: {} });
  const result = validatePlan({ startMode: "later", useCases: [], focusAreas: [], name: "", targetRole: "  ", season: "Autumn", targetCompanies: ["c".repeat(81)] });
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ["focusAreas", "name", "season", "startMode", "targetCompanies", "targetRole", "useCases"]);
  assert.equal(result.errors.targetRole, "Enter the role you're targeting.");
  assert.equal(validatePlan({ ...base, targetRole: "r".repeat(101) }).errors.targetRole, "Target role must be 100 characters or fewer.");
  assert.equal(validatePlan({ ...base, useCases: ["co-op", "research", "exploring"] }).errors.useCases, `Pick up to ${MAX_USE_CASES}.`);
  assert.equal(validatePlan({ ...base, targetCompanies: Array.from({ length: 51 }, (_, i) => `C${i}`) }).errors.targetCompanies, "Add at most 50 target companies.");
  assert.equal(validatePlan({ ...base, targetCompanies: Array.from({ length: 50 }, (_, i) => `C${i}`) }).ok, true);
});

test("the builder is pure: it imports no storage or network module and touches no storage", async () => {
  const source = await readFile(new URL("../../src/main/resources/public/js/builder.js", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import .* from "(.+)";$/gm)].map(match => match[1]);
  assert.deepEqual(imports.sort(), ["./domain.js", "./onboarding.js"]);
  const touched = [];
  const trap = new Proxy({}, { get: (_, key) => { touched.push(String(key)); return () => null; } });
  const saved = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  globalThis.localStorage = trap;
  globalThis.sessionStorage = trap;
  try {
    for (const startMode of START_MODES) buildNotebookPlan({ ...base, startMode });
    validatePlan(base);
  } finally {
    globalThis.localStorage = saved.localStorage;
    globalThis.sessionStorage = saved.sessionStorage;
  }
  assert.deepEqual(touched, []);
});
