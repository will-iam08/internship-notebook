import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDemoDataset, DEMO_SEED } from "../../src/main/resources/public/js/demo.js";
import { STAGES, agendaItems, daysUntil } from "../../src/main/resources/public/js/domain.js";

test("the demo dataset has exactly six fictional applications, one per board stage", () => {
  const { applications } = buildDemoDataset();
  assert.equal(applications.length, 6);
  for (const stage of STAGES) {
    assert.ok(applications.some(entry => entry.status === stage), `expected at least one ${stage} application`);
  }
});

test("the demo dataset has exactly two upcoming interviews within the next seven days", () => {
  const { applications } = buildDemoDataset();
  const interviews = applications.filter(entry => entry.status === "INTERVIEW");
  assert.equal(interviews.length, 2);
  for (const entry of interviews) {
    const days = daysUntil(entry.nextStepDate);
    assert.ok(days >= 0 && days <= 7, `interview next-step date ${entry.nextStepDate} should be within 0..7 days, was ${days}`);
  }
});

test("the agenda shows exactly the two interviews and nothing else", () => {
  const { applications } = buildDemoDataset();
  const agenda = agendaItems(applications);
  assert.equal(agenda.length, 2);
  assert.ok(agenda.every(item => item.kind === "next"));
  assert.ok(agenda.every(item => item.entry.status === "INTERVIEW"));
});

test("every demo application has at least one note, a contact, and a skill tag", () => {
  const { applications } = buildDemoDataset();
  for (const entry of applications) {
    assert.ok(entry.notes.trim().length > 0, `${entry.company} should have a note`);
    assert.ok(entry.contact.trim().length > 0, `${entry.company} should have a contact`);
    assert.ok(entry.skills.length >= 1, `${entry.company} should have a skill tag`);
  }
});

test("the returned dataset has the browserApi.read() shape", () => {
  const dataset = buildDemoDataset();
  assert.deepEqual(Object.keys(dataset).sort(), ["applications", "nextId", "recentlyDeleted"]);
  assert.ok(Array.isArray(dataset.applications));
  assert.deepEqual(dataset.recentlyDeleted, []);
  assert.ok(dataset.nextId > Math.max(...dataset.applications.map(entry => entry.id)));
});

test("buildDemoDataset returns an independent deep copy each call", () => {
  const first = buildDemoDataset();
  first.applications[0].company = "Mutated";
  first.applications.push({ id: 999 });
  const second = buildDemoDataset();
  assert.notEqual(second.applications[0].company, "Mutated");
  assert.equal(second.applications.length, 6);
  // The frozen seed is never changed by mutating a built copy.
  assert.notEqual(DEMO_SEED.applications[0].company, "Mutated");
  assert.equal(DEMO_SEED.applications.length, 6);
});
