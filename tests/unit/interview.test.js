import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";
import {
  INTERVIEW_KEY_LIMIT, INTERVIEW_NOTE_LIMIT, cleanChanges, cleanInterview, normalize, sanitizeImportedEntry
} from "../../src/main/resources/public/js/domain.js";
import {
  QUESTION_BANK, QUESTION_GROUPS, questionById, questionsByGroup, questionsFor, roleTags,
  interviewProgress, interviewSummary, withQuestionStatus, withQuestionNote
} from "../../src/main/resources/public/js/interview.js";
import { browserApi, setBrowserWriteListener } from "../../src/main/resources/public/js/api.js";

class MemoryStorage {
  #map = new Map();
  getItem(key) { return this.#map.get(key) ?? null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
}
beforeEach(() => { globalThis.localStorage = new MemoryStorage(); setBrowserWriteListener(null); });

/* ---------- the bank ---------- */

test("the bank has at least 60 questions with unique, storable ids in the four groups", () => {
  assert.ok(QUESTION_BANK.length >= 60, `${QUESTION_BANK.length}`);
  const ids = QUESTION_BANK.map(question => question.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const question of QUESTION_BANK) {
    assert.match(question.id, /^[a-z0-9][a-z0-9-]{0,47}$/, "the same id pattern cleanInterview accepts");
    assert.ok(QUESTION_GROUPS.some(group => group.id === question.group), question.id);
    assert.ok(question.text.length > 10 && question.text.length < 120, question.id);
    assert.deepEqual(cleanInterview({ [question.id]: { status: "practiced" } }), { [question.id]: { status: "practiced" } });
  }
  for (const group of QUESTION_GROUPS) assert.ok(QUESTION_BANK.filter(question => question.group === group.id).length >= 10, group.id);
  assert.ok(Object.isFrozen(QUESTION_BANK) && Object.isFrozen(QUESTION_BANK[0]), "callers cannot edit the bank");
  assert.equal(questionById("b-about-you").text, "Tell me about yourself.");
  assert.equal(questionById("nope"), null);
});

test("ids are stable: these saved ids must keep meaning the same question", () => {
  // If this fails, an id was renamed or removed and people's saved progress would point nowhere.
  const pinned = { "b-about-you": "Tell me about yourself.", "t-sw-debug": "How do you debug a problem you can't reproduce?",
    "t-data-joins": "What's the difference between an inner join and a left join?", "l-dates": "Which dates are you available, and for how long?",
    "a-next": "What are the next steps, and when should I expect to hear back?" };
  for (const [id, text] of Object.entries(pinned)) assert.equal(questionById(id)?.text, text, id);
});

/* ---------- selection ---------- */

test("role keywords pick the technical tracks", () => {
  assert.deepEqual(roleTags("Software Engineering Intern"), ["software"]);
  assert.deepEqual(roleTags("Data Engineering Co-op"), ["software", "data"]);
  assert.deepEqual(roleTags("Product Design Intern"), ["design"]);
  assert.deepEqual(roleTags("Associate Product Manager"), ["product"]);
  assert.deepEqual(roleTags("Machine Learning Intern"), ["data"]);
  assert.deepEqual(roleTags("Marketing Intern"), []);
  assert.deepEqual(roleTags(undefined), []);
});

test("technical questions match the role, with the any-field ones always included", () => {
  const tech = role => questionsByGroup(role).technical.map(question => question.id);
  assert.ok(tech("Software Intern").every(id => id.startsWith("t-sw-") || id.startsWith("t-gen-")));
  assert.ok(tech("Software Intern").includes("t-gen-tools"));
  assert.equal(tech("Software Intern")[0].startsWith("t-sw-"), true, "the role's own track comes first");
  assert.ok(tech("Data Analyst").some(id => id.startsWith("t-data-")) && !tech("Data Analyst").some(id => id.startsWith("t-sw-")));
  assert.deepEqual(tech("Marketing Intern"), ["t-gen-tools", "t-gen-explain", "t-gen-new"]);
  assert.equal(questionsByGroup("Marketing Intern").behavioral.length, 16, "every role gets every behavioral question");
});

test("the stage decides which groups lead, and short lists stay mixed", () => {
  const groups = (status, limit = 4) => questionsFor({ role: "Software Intern", status }, { limit }).map(question => question.group);
  assert.deepEqual(groups("INTERVIEW"), ["technical", "behavioral", "ask", "logistics"]);
  assert.deepEqual(groups("OFFER"), ["logistics", "ask", "behavioral", "technical"]);
  assert.deepEqual(groups("SAVED", 2), ["behavioral", "logistics"]);
  assert.deepEqual(groups("UNKNOWN", 2), ["behavioral", "technical"], "an unknown stage falls back to Applied");
  assert.equal(questionsFor({ role: "Software Intern", status: "INTERVIEW" })[0].id, "t-sw-walkthrough");
  const all = questionsFor({ role: "Software Intern", status: "APPLIED" });
  assert.equal(new Set(all.map(question => question.id)).size, all.length, "no question twice");
  assert.equal(all.length, 16 + 10 + 10 + 12, "all behavioral, software + any-field technical, logistics, and ask questions");
  assert.equal(questionsFor({}, { limit: 0 }).length, 0);
});

test("practice mode skips practiced questions and puts stuck ones first", () => {
  const interview = { "t-sw-walkthrough": { status: "practiced" }, "b-about-you": { status: "practiced" }, "a-mentor": { status: "stuck" } };
  const next = questionsFor({ role: "Software Intern", status: "INTERVIEW", interview }, { limit: 3, toPractice: true });
  assert.deepEqual(next.map(question => question.id), ["a-mentor", "t-sw-debug", "b-why-company"]);
  assert.ok(!questionsFor({ role: "Software Intern", status: "INTERVIEW", interview }, { toPractice: true }).some(question => question.id === "b-about-you"));
});

/* ---------- progress ---------- */

test("progress counts practiced, stuck, and new, treating missing records as new", () => {
  assert.deepEqual(interviewProgress([{ status: "practiced" }, { status: "stuck" }, { status: "new" }, {}, null, { status: "weird" }]),
    { total: 6, practiced: 1, stuck: 1, fresh: 4, toPractice: 5, percent: 17 });
  assert.deepEqual(interviewProgress([]), { total: 0, practiced: 0, stuck: 0, fresh: 0, toPractice: 0, percent: 0 });
  assert.deepEqual(interviewProgress(undefined).total, 0);
});

test("the summary describes one page's prep and names the next question", () => {
  const application = { role: "Data Analyst", status: "INTERVIEW", interview: { "t-data-joins": { status: "practiced" }, "t-data-messy": { status: "stuck", note: "Talk about the survey project" } } };
  const summary = interviewSummary(application);
  assert.equal(summary.total, questionsFor(application).length);
  assert.equal(summary.practiced, 1);
  assert.equal(summary.stuck, 1);
  assert.equal(summary.notes, 1);
  assert.equal(summary.next.id, "t-data-messy");
  assert.equal(summary.text, `1 of ${summary.total} practiced, 1 stuck`);
  assert.equal(interviewSummary({ role: "Intern", status: "SAVED" }).text, `0 of ${interviewSummary({ role: "Intern", status: "SAVED" }).total} practiced`);
  assert.equal(interviewSummary(undefined).practiced, 0);
});

test("marking toggles, notes attach and clear, and unknown ids or statuses change nothing", () => {
  let map = withQuestionStatus({}, "b-about-you", "practiced");
  assert.deepEqual(map, { "b-about-you": { status: "practiced" } });
  map = withQuestionStatus(map, "b-about-you", "practiced");
  assert.deepEqual(map, {}, "pressing the same status again clears it back to new");
  map = withQuestionNote(withQuestionStatus({}, "a-mentor", "stuck"), "a-mentor", "  Ask about pairing  ");
  assert.deepEqual(map, { "a-mentor": { status: "stuck", note: "Ask about pairing" } });
  assert.deepEqual(withQuestionStatus(map, "a-mentor", "stuck"), { "a-mentor": { status: "new", note: "Ask about pairing" } }, "the note survives");
  assert.deepEqual(withQuestionNote(map, "a-mentor", ""), { "a-mentor": { status: "stuck" } });
  assert.deepEqual(withQuestionStatus(map, "not-a-question", "practiced"), map);
  assert.deepEqual(withQuestionStatus(map, "a-mentor", "done"), map);
  const before = JSON.stringify(map);
  withQuestionStatus(map, "a-mentor", "practiced");
  assert.equal(JSON.stringify(map), before, "inputs are not mutated");
});

/* ---------- storage shape ---------- */

test("cleanInterview keeps the stored shape small and safe", () => {
  assert.deepEqual(cleanInterview(null), {});
  assert.deepEqual(cleanInterview([{ status: "practiced" }]), {});
  assert.deepEqual(cleanInterview("x"), {});
  const dirty = JSON.parse('{"__proto__":{"status":"practiced"},"Bad Id":{"status":"stuck"},"b-about-you":{"status":"practiced","extra":1},"b-why-role":{"status":"bogus"},"a-next":{"status":"new"},"a-mentor":{"status":"new","note":"keep"}}');
  assert.deepEqual(cleanInterview(dirty), { "b-about-you": { status: "practiced" }, "a-mentor": { status: "new", note: "keep" } });
  assert.equal(cleanInterview({ "b-about-you": { status: "stuck", note: "x".repeat(1000) } })["b-about-you"].note.length, INTERVIEW_NOTE_LIMIT);
  const many = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`q-${index}`, { status: "practiced" }]));
  assert.equal(Object.keys(cleanInterview(many)).length, INTERVIEW_KEY_LIMIT);
});

test("pages without the field, old pages, and edits that don't touch it are unchanged", () => {
  const old = normalize({ id: 1, company: "Acme", role: "Intern" });
  assert.equal("interview" in old, false, "no empty field is added to older pages");
  assert.equal("interview" in normalize({ id: 1, company: "Acme", role: "Intern", interview: {} }), false);
  assert.deepEqual(normalize({ id: 1, company: "Acme", role: "Intern", interview: { "b-about-you": { status: "practiced" } } }).interview, { "b-about-you": { status: "practiced" } });
  assert.equal("interview" in cleanChanges({ notes: "hi" }), false);
  assert.deepEqual(cleanChanges({ interview: { "a-next": { status: "stuck" }, "Bad Id": {} } }), { interview: { "a-next": { status: "stuck" } } });
});

test("progress saves through the real backend and survives a backup export and import", async () => {
  const created = await browserApi.create({ company: "Harbor & Co.", role: "Design Intern" });
  const interview = withQuestionNote(withQuestionStatus({}, "t-design-process", "practiced"), "t-design-process", "Use the campus app case study");
  await browserApi.update(created.id, { interview });
  assert.deepEqual(browserApi.read().applications[0].interview, interview);
  // Clearing every question removes the field rather than storing an empty map.
  await browserApi.update(created.id, { interview: {} });
  assert.equal("interview" in browserApi.read().applications[0], false);
  await browserApi.update(created.id, { interview });
  // A backup made now and restored into an empty notebook keeps the progress.
  const backup = JSON.parse(JSON.stringify({ applications: browserApi.read().applications }));
  globalThis.localStorage = new MemoryStorage();
  await browserApi.importBackup(backup.applications, []);
  assert.deepEqual(browserApi.read().applications[0].interview, interview);
  // An older backup without the field still imports.
  await browserApi.importBackup([{ company: "Lumen", role: "Data Intern", status: "APPLIED" }], []);
  assert.equal(browserApi.read().applications.length, 2);
  assert.equal("interview" in browserApi.read().applications[1], false);
  // A tampered backup is cleaned on the way in.
  assert.deepEqual(sanitizeImportedEntry({ company: "X", role: "Y", interview: { "b-about-you": { status: "practiced", note: "n".repeat(900) }, "<script>": { status: "stuck" } } }).entry.interview,
    { "b-about-you": { status: "practiced", note: "n".repeat(INTERVIEW_NOTE_LIMIT) } });
});

test("the module is pure: only domain.js, no storage, DOM, or network", async () => {
  const source = await readFile(new URL("../../src/main/resources/public/js/interview.js", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/^import .* from "(.+)";$/gm)].map(match => match[1]), ["./domain.js"]);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.|window\.|fetch\(/);
});
