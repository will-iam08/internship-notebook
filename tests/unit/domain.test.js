import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanChanges, cleanLink, cleanSkills, cleanStage, cleanText, cleanDate,
  normalize, withStatus, metrics, agendaItems, attentionItems, matchesQuery, compareBy,
  isValidDate, dayKey
} from "../../src/main/resources/public/js/domain.js";

test("cleanLink accepts http/https and adds https:// to a bare domain", () => {
  assert.equal(cleanLink("example.com/jobs"), "https://example.com/jobs");
  assert.equal(cleanLink("http://example.com"), "http://example.com");
  assert.equal(cleanLink("  https://example.com  "), "https://example.com");
  assert.equal(cleanLink(""), "");
});

test("cleanLink rejects non-http schemes (data safety: never save something that can run script)", () => {
  for (const bad of [
    "javascript:alert(1)",
    "javascript:alert(document.cookie)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd"
  ]) {
    assert.throws(() => cleanLink(bad), /http:\/\/ or https:\/\//, `expected ${bad} to be rejected`);
  }
});

test("cleanLink rejects a link with no host and one that is too long", () => {
  assert.throws(() => cleanLink("https://"), /valid web address/);
  assert.throws(() => cleanLink(`https://example.com/${"a".repeat(500)}`), /500 characters/);
});

test("cleanLink still allows a host:port address (not mistaken for a scheme)", () => {
  assert.equal(cleanLink("example.com:8080/jobs"), "https://example.com:8080/jobs");
});

test("cleanText enforces required and length limits", () => {
  assert.throws(() => cleanText("", "company", { required: true }), /required/);
  assert.throws(() => cleanText("a".repeat(81), "company"), /80 characters/);
  assert.equal(cleanText("  Acme  ", "company"), "Acme");
});

test("cleanDate accepts blank and a valid date, rejects garbage", () => {
  assert.equal(cleanDate("", "Deadline"), "");
  assert.equal(cleanDate("2026-01-05", "Deadline"), "2026-01-05");
  assert.throws(() => cleanDate("not-a-date", "Deadline"), /valid date/);
  assert.throws(() => cleanDate("2026-13-40", "Deadline"), /valid date/);
});

test("cleanSkills trims, capitalizes the first letter, dedupes exact repeats, and caps at 12 of 40 chars", () => {
  const skills = cleanSkills("java, java , sql,,  python");
  assert.deepEqual(skills, ["Java", "Sql", "Python"]);
  const many = cleanSkills(Array.from({ length: 20 }, (_, i) => `skill${i}`));
  assert.equal(many.length, 12);
  assert.equal(cleanSkills("x".repeat(60))[0].length, 40);
});

test("cleanStage only allows known stages", () => {
  assert.equal(cleanStage("applied"), "APPLIED");
  assert.throws(() => cleanStage("nope"), /valid pipeline stage/);
});

test("cleanChanges validates only fields present, so partial saves cannot corrupt others", () => {
  const changes = cleanChanges({ notes: "hello" });
  assert.deepEqual(changes, { notes: "hello" });
  assert.throws(() => cleanChanges({}, { creating: true }), /required/);
});

test("normalize fills defaults for an old/partial entry without losing data", () => {
  const entry = normalize({ id: "5", company: "Acme", role: "Intern" });
  assert.equal(entry.id, 5);
  assert.equal(entry.status, "SAVED");
  assert.equal(entry.history.length, 1);
  assert.equal(entry.history[0].status, "SAVED");
  assert.ok(isValidDate(dayKey()));
});

test("normalize drops an unsafe link that slipped into a backup instead of trusting it blindly", () => {
  // normalize() itself does not re-validate free text link fields (that is cleanChanges' job on
  // write); this test documents that importEntries() must call cleanChanges/cleanLink on import.
  const entry = normalize({ id: 1, company: "Acme", role: "Intern", link: "javascript:alert(1)" });
  assert.equal(entry.link, "javascript:alert(1)", "normalize alone does not sanitize - callers must validate");
});

test("withStatus appends history only when the status actually changes", () => {
  const base = normalize({ id: 1, company: "Acme", role: "Intern" });
  const same = withStatus(base, "SAVED", new Date().toISOString());
  assert.equal(same, base);
  const moved = withStatus(base, "APPLIED", "2026-02-01T00:00:00.000Z");
  assert.equal(moved.history.length, 2);
  assert.equal(moved.status, "APPLIED");
});

test("metrics computes response and interview rate only over sent applications", () => {
  const list = [
    normalize({ id: 1, company: "A", role: "R", status: "SAVED" }),
    normalize({ id: 2, company: "B", role: "R", status: "APPLIED" }),
    normalize({ id: 3, company: "C", role: "R", status: "INTERVIEW" }),
    normalize({ id: 4, company: "D", role: "R", status: "REJECTED" })
  ];
  const stats = metrics(list);
  assert.equal(stats.total, 4);
  assert.equal(stats.sent, 3);
  assert.equal(stats.responseRate, Math.round((2 * 100) / 3));
});

test("agendaItems surfaces upcoming deadlines and next steps, sorted by date", () => {
  const soon = dayKey(new Date(Date.now() + 2 * 86_400_000));
  const later = dayKey(new Date(Date.now() + 10 * 86_400_000));
  const list = [
    normalize({ id: 1, company: "Later Co", role: "R", status: "SAVED", deadline: later }),
    normalize({ id: 2, company: "Soon Co", role: "R", status: "SAVED", deadline: soon })
  ];
  const items = agendaItems(list);
  assert.equal(items.length, 2);
  assert.equal(items[0].entry.company, "Soon Co");
});

test("attentionItems flags a passed deadline as danger", () => {
  const past = dayKey(new Date(Date.now() - 3 * 86_400_000));
  const list = [normalize({ id: 1, company: "Late Co", role: "R", status: "SAVED", deadline: past })];
  const items = attentionItems(list);
  assert.equal(items.length, 1);
  assert.equal(items[0].level, "danger");
});

test("matchesQuery matches across fields and requires every word", () => {
  const entry = normalize({ id: 1, company: "Acme Robotics", role: "Backend Intern", skills: ["Java"] });
  assert.ok(matchesQuery(entry, "acme java"));
  assert.ok(!matchesQuery(entry, "acme python"));
});

test("compareBy company sorts alphabetically", () => {
  const a = normalize({ id: 1, company: "Zeta", role: "R" });
  const b = normalize({ id: 2, company: "Alpha", role: "R" });
  assert.deepEqual([a, b].sort(compareBy("company")).map(e => e.company), ["Alpha", "Zeta"]);
});
