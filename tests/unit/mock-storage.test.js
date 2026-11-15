import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { cleanChanges, cleanMock, MOCK_SESSION_LIMIT, normalize, sanitizeImportedEntry } from "../../src/main/resources/public/js/domain.js";
import { browserApi, serverApi, setBrowserWriteListener } from "../../src/main/resources/public/js/api.js";
import { QUESTION_GROUPS } from "../../src/main/resources/public/js/interview.js";
import { SESSION_MODES } from "../../src/main/resources/public/js/mock-interview.js";
import { KEYS } from "../../src/main/resources/public/js/storage.js";
import { createCloudClient } from "../../src/main/resources/public/js/cloud.js";

class MemoryStorage {
  #map = new Map();
  getItem(key) { return this.#map.get(key) ?? null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
}
beforeEach(() => { globalThis.localStorage = new MemoryStorage(); setBrowserWriteListener(null); });

const summary = (changes = {}) => ({
  at: "2026-11-13T12:00:00.000Z", mode: "quick", score: 72, groupScores: { behavioral: 80, technical: 64 }, ...changes
});

test("mock history accepts every core mode and group, stores only compact rounded records", () => {
  for (const mode of Object.values(SESSION_MODES)) {
    const groupScores = Object.fromEntries(QUESTION_GROUPS.map(group => [group.id, 64.6]));
    groupScores.unknown = 100;
    const raw = summary({ mode, at: "2026-11-13T07:00:00-05:00", score: 71.6, groupScores, answers: ["private answer"], text: "private transcript" });
    assert.deepEqual(cleanMock([raw]), [summary({ mode, groupScores: Object.fromEntries(QUESTION_GROUPS.map(group => [group.id, 65])) })]);
    assert.equal(raw.score, 71.6, "the source is not changed");
    assert.equal(raw.groupScores.unknown, 100);
  }
});

test("mock history drops malformed records and invalid group scores without trusting coercion", () => {
  for (const value of [null, undefined, {}, "history", 1]) assert.deepEqual(cleanMock(value), []);
  const bad = [null, {}, summary({ mode: "unknown" }), summary({ at: ["2026-11-13T12:00:00Z"] }), summary({ at: "not-a-date" }), summary({ at: "123" }),
    summary({ at: "2026-02-30T12:00:00Z" }), summary({ at: "2026-11-13T24:00:00Z" }),
    ...[NaN, Infinity, -1, 101, "72", null].map(score => summary({ score })),
    summary({ groupScores: {} }), summary({ groupScores: { unknown: 100 } })];
  assert.deepEqual(cleanMock(bad), []);
  assert.deepEqual(cleanMock([summary({ groupScores: { behavioral: 0, technical: 100, logistics: -1, ask: "50", extra: 10 } })]),
    [summary({ groupScores: { behavioral: 0, technical: 100 } })]);
});

test("mock history retains only the latest five sessions in chronological order", () => {
  const records = Array.from({ length: 9 }, (_, index) => summary({ at: `2026-11-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`, score: index }));
  assert.deepEqual(cleanMock([...records].reverse()), records.slice(-MOCK_SESSION_LIMIT));
  assert.deepEqual(cleanMock(cleanMock(records)), records.slice(-MOCK_SESSION_LIMIT));
});

test("old pages omit mock history; normalization, partial updates and imports sanitize it", () => {
  const old = { id: 1, company: "Acme", role: "Intern" };
  assert.equal("mock" in normalize(old), false);
  assert.equal("mock" in normalize({ ...old, mock: [] }), false);
  assert.equal("mock" in normalize({ ...old, mock: [summary({ score: -1 })] }), false);
  assert.deepEqual(cleanChanges({ notes: "hello" }), { notes: "hello" });
  assert.deepEqual(cleanChanges({ mock: null }), { mock: [] });
  const dirty = [summary({ text: "not stored" }), summary({ mode: "unknown" })];
  assert.deepEqual(cleanChanges({ mock: dirty }), { mock: [summary()] });
  assert.deepEqual(normalize({ ...old, mock: dirty }).mock, [summary()]);
  assert.deepEqual(sanitizeImportedEntry({ ...old, mock: dirty }).entry.mock, [summary()]);
});

test("mock history saves, survives backup import and delete/restore, and clears without an empty field", async () => {
  const created = await browserApi.create({ company: "Acme", role: "Intern" });
  await browserApi.update(created.id, { mock: [summary()] });
  assert.deepEqual(browserApi.read().applications[0].mock, [summary()]);
  await browserApi.remove([created.id]);
  assert.deepEqual(browserApi.read().recentlyDeleted[0].mock, [summary()]);
  await browserApi.restore([created.id]);
  const backup = JSON.parse(localStorage.getItem(KEYS.data));
  globalThis.localStorage = new MemoryStorage();
  await browserApi.importBackup(backup.applications);
  assert.deepEqual(browserApi.read().applications[0].mock, [summary()]);
  await browserApi.importBackup([{ company: "Old notebook", role: "Intern" }]);
  assert.equal("mock" in browserApi.read().applications[1], false);
  await browserApi.update(1, { notes: "Keep the session" });
  assert.deepEqual(browserApi.read().applications[0].mock, [summary()]);
  await browserApi.update(1, { mock: [] });
  assert.equal("mock" in browserApi.read().applications[0], false);
  assert.equal("mock" in JSON.parse(localStorage.getItem(KEYS.data)).applications[0], false);
});

test("mock history and interview prep never reach Java server edit or backup payloads", async t => {
  const entry = normalize({ id: 1, company: "Acme", role: "Intern", mock: [summary()], interview: { "b-about-you": { status: "practiced" } } });
  const body = JSON.parse(serverApi.body(entry));
  assert.equal("mock" in body, false);
  assert.equal("interview" in body, false);
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ applications: [], recentlyDeleted: [] }), { status: 200 }));
  await serverApi.importBackup([entry], [{ ...entry, deletedAt: new Date().toISOString() }]);
  const payload = JSON.parse(fetch.mock.calls[0].arguments[1].body);
  for (const record of [...payload.applications, ...payload.recentlyDeleted]) {
    assert.equal("mock" in record, false);
    assert.equal("interview" in record, false);
    assert.equal(record.company, "Acme");
  }
});

test("active and deleted interview prep and mock history round-trip through the write listener and cloud", async t => {
  t.after(() => setBrowserWriteListener(null));
  const interview = { "b-about-you": { status: "practiced", note: "Use the project example" }, "a-mentor": { status: "stuck" } };
  const prep = { interview, mock: [summary(), summary({ at: "2026-11-14T12:00:00.000Z", mode: "technical" })] };
  let written;
  setBrowserWriteListener(record => { written = record; });
  await browserApi.create({ company: "Active", role: "Intern", ...prep });
  await browserApi.create({ company: "Deleted", role: "Intern", ...prep });
  await browserApi.remove([2]);
  const original = browserApi.read();
  assert.deepEqual(written, original);
  written.applications[0].interview["b-about-you"].note = "changed listener copy";
  assert.deepEqual(browserApi.read(), original, "listener receives an independent copy");
  await browserApi.update(1, { notes: "Keep both practice fields" });
  const source = browserApi.read();

  let remote = null;
  const client = createCloudClient({ url: "https://test.supabase.co", anonKey: "public-key", fetch: async (url, options) => {
    if (url.includes("/auth/v1/token")) return Response.json({ access_token: "memory-token", user: { id: "owner" } });
    if (options.method === "POST") {
      remote = JSON.parse(options.body).data;
      return new Response(null, { status: 204 });
    }
    return Response.json(remote ? [{ data: remote }] : []);
  } });
  await client.signIn("owner@example.test", "password");
  assert.equal((await client.sync(source)).action, "pushed");
  assert.deepEqual(remote, source);
  const result = await client.sync({ nextId: 1, applications: [], recentlyDeleted: [], updatedAt: "1970-01-01T00:00:00.000Z" });
  assert.equal(result.action, "pulled");
  const record = result.notebook;
  browserApi.write({
    nextId: record.nextId,
    applications: record.applications.map(raw => sanitizeImportedEntry(raw).entry),
    recentlyDeleted: record.recentlyDeleted.map(raw => sanitizeImportedEntry(raw).entry)
  }, record.updatedAt);
  assert.deepEqual(browserApi.read(), source);
  assert.deepEqual(written, source);
  for (const entry of [...browserApi.read().applications, ...browserApi.read().recentlyDeleted]) {
    assert.deepEqual(entry.interview, interview);
    assert.deepEqual(entry.mock, prep.mock);
  }
});
