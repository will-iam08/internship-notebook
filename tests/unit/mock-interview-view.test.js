import assert from "node:assert/strict";
import { test } from "node:test";
import { countdownLabel, savedSummaryDetails } from "../../src/main/resources/public/js/mock-interview-view.js";
import { questionById } from "../../src/main/resources/public/js/interview.js";

test("advisory countdown formats target minutes and clamps negative elapsed time", () => {
  assert.equal(countdownLabel(45, 0), "0:45 remaining");
  assert.equal(countdownLabel(90, 0), "1:30 remaining");
  assert.equal(countdownLabel(120, -1000), "2:00 remaining");
  assert.equal(countdownLabel(90, 1000), "1:29 remaining");
});

test("advisory countdown changes only after each whole elapsed second", () => {
  assert.equal(countdownLabel(90, 999.9), "1:30 remaining");
  assert.equal(countdownLabel(90, 1000.1), "1:29 remaining");
  assert.equal(countdownLabel(90, 89_999), "0:01 remaining");
});

test("reaching or exceeding the target shows a calm overrun with no negative clock", () => {
  assert.equal(countdownLabel(90, 90_000), "Target reached · 0:00 over. Take your time.");
  assert.equal(countdownLabel(90, 90_999.9), "Target reached · 0:00 over. Take your time.");
  assert.equal(countdownLabel(90, 91_000), "Target reached · 0:01 over. Take your time.");
  assert.equal(countdownLabel(90, 155_000), "Target reached · 1:05 over. Take your time.");
});

const application = { role: "Data Analyst", status: "INTERVIEW" };
const saved = groupScores => ({ at: "2026-11-13T12:00:00.000Z", mode: "quick", score: 50, groupScores });

test("saved summary practice questions match the application and only its scored groups", () => {
  const details = savedSummaryDetails(application, saved({ technical: 20 }));
  assert.deepEqual(details.nextPractice, ["t-data-joins", "t-data-messy", "t-data-metric"]);
  assert.ok(details.nextPractice.every(id => questionById(id).group === "technical"));
  assert.deepEqual(savedSummaryDetails(application, saved({})), { strengths: [], toImprove: [], nextPractice: [] });
});

test("saved summary prioritizes the lowest-scoring group and keeps ties in session selection order", () => {
  const details = savedSummaryDetails(application, saved({ behavioral: 75, technical: 25, logistics: 5, ask: 50 }));
  assert.deepEqual(details.nextPractice, ["l-dates", "l-start", "l-place"]);
  const tied = savedSummaryDetails(application, saved({ behavioral: 50, technical: 50 }));
  assert.deepEqual(tied.nextPractice, ["t-data-joins", "b-about-you", "t-data-messy"]);
});

test("saved summary strengths include the 70-point boundary and improvement suggestions stay below it", () => {
  const details = savedSummaryDetails(application, saved({ behavioral: 69, technical: 70, logistics: 100, ask: 0 }));
  assert.equal(details.strengths.length, 2);
  assert.match(details.strengths[0], /^Technical /);
  assert.match(details.strengths[1], /^Internship logistics /);
  assert.equal(details.toImprove.length, 2);
  assert.match(details.toImprove[0], /behavioral/);
  assert.match(details.toImprove[1], /questions to ask them/);
});

test("saved summary gives at most three strengths, improvements, and next questions without changing records", () => {
  const entry = Object.freeze({ ...application, interview: Object.freeze({ "t-data-messy": Object.freeze({ status: "stuck" }) }) });
  for (const score of [20, 80]) {
    const record = Object.freeze(saved(Object.freeze({ behavioral: score, technical: score, logistics: score, ask: score })));
    const before = JSON.stringify({ entry, record });
    const details = savedSummaryDetails(entry, record);
    for (const list of Object.values(details)) assert.ok(list.length <= 3);
    assert.equal(details.nextPractice.length, 3);
    assert.equal(JSON.stringify({ entry, record }), before);
  }
});
