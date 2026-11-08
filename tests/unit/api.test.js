import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { browserApi, serverApi, setBrowserWriteListener } from "../../src/main/resources/public/js/api.js";
import { normalize, RETENTION_MS } from "../../src/main/resources/public/js/domain.js";
import { KEYS } from "../../src/main/resources/public/js/storage.js";

class MemoryStorage {
  #map = new Map();
  writes = 0;
  failWrites = false;
  getItem(key) { return this.#map.get(key) ?? null; }
  setItem(key, value) {
    this.writes++;
    if (this.failWrites) throw new Error("Storage full");
    this.#map.set(key, String(value));
  }
  removeItem(key) { this.#map.delete(key); }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
  setBrowserWriteListener(null);
});

const application = (changes = {}) => normalize({
  id: 99, company: "Acme", role: "Intern", status: "APPLIED",
  createdAt: "2026-01-01T12:00:00.000Z", updatedAt: "2026-01-03T12:00:00.000Z",
  history: [{ status: "SAVED", at: "2026-01-01T12:00:00.000Z" }, { status: "APPLIED", at: "2026-01-03T12:00:00.000Z" }],
  ...changes
});

function seed(data) {
  localStorage.setItem(KEYS.data, JSON.stringify(data));
  localStorage.writes = 0;
}

test("an all-deleted backup stays recoverable with its original dates and history", async () => {
  const deleted = application({ deletedAt: new Date().toISOString() });
  const added = await browserApi.importBackup([], [deleted]);
  assert.deepEqual(added.applications, []);
  assert.deepEqual(added.recentlyDeleted, [{ ...deleted, id: 1 }]);
  assert.deepEqual(browserApi.read().recentlyDeleted, added.recentlyDeleted);
  assert.equal(browserApi.read().nextId, 2);
  assert.equal(localStorage.writes, 1);
});

test("a mixed backup remaps IDs and imports both lists in one write", async () => {
  const existing = application({ id: 7, company: "Existing" });
  const active = application({ company: "Active", deletedAt: new Date().toISOString() });
  const deleted = application({ company: "Deleted", deletedAt: new Date().toISOString() });
  seed({ nextId: 8, applications: [existing], recentlyDeleted: [] });
  const added = await browserApi.importBackup([active], [deleted]);
  assert.equal(added.applications[0].id, 8);
  assert.equal(added.applications[0].deletedAt, undefined);
  assert.equal(added.applications[0].createdAt, active.createdAt);
  assert.deepEqual(added.applications[0].history, active.history);
  assert.deepEqual(added.recentlyDeleted, [{ ...deleted, id: 9 }]);
  assert.equal(browserApi.read().applications.length, 2);
  assert.equal(browserApi.read().nextId, 10);
  assert.equal(localStorage.writes, 1);
});

test("backup duplicates are skipped across both lists and repeated imports", async () => {
  const active = application();
  const deletedDuplicate = application({ company: "ACME", deletedAt: new Date().toISOString() });
  const added = await browserApi.importBackup([active, active], [deletedDuplicate]);
  assert.equal(added.applications.length, 1);
  assert.equal(added.recentlyDeleted.length, 0);
  assert.deepEqual(await browserApi.importBackup([active], [deletedDuplicate]), { applications: [], recentlyDeleted: [] });
  assert.equal(browserApi.read().applications.length, 1);
  assert.equal(localStorage.writes, 1);
  seed({ nextId: 5, applications: [], recentlyDeleted: [{ ...deletedDuplicate, id: 4 }] });
  assert.deepEqual(await browserApi.importBackup([active]), { applications: [], recentlyDeleted: [] });
  assert.equal(localStorage.writes, 0);
});

test("distinct backup pages containing fingerprint delimiters are both retained", async () => {
  const active = application({ company: "A|B", role: "C" });
  const deleted = application({ company: "A", role: "B|C", deletedAt: new Date().toISOString() });
  const added = await browserApi.importBackup([active], [deleted]);
  assert.equal(added.applications.length, 1);
  assert.equal(added.recentlyDeleted.length, 1);
  assert.equal(browserApi.read().applications[0].company, "A|B");
  assert.equal(browserApi.read().recentlyDeleted[0].company, "A");
  assert.deepEqual(await browserApi.importBackup([active], [deleted]), { applications: [], recentlyDeleted: [] });
});

test("equivalent creation timestamps deduplicate without rewriting the original timestamp", async () => {
  const original = application({ createdAt: "2026-01-01T07:00:00-05:00" });
  const added = await browserApi.importBackup([original]);
  assert.equal(added.applications[0].createdAt, original.createdAt);
  assert.deepEqual(await browserApi.importBackup([
    application({ createdAt: "2026-01-01T12:00:00Z" }),
    application({ createdAt: "2026-01-01T12:00:00.000Z" })
  ]), { applications: [], recentlyDeleted: [] });
  assert.equal(browserApi.read().applications.length, 1);
  assert.equal(browserApi.read().applications[0].createdAt, original.createdAt);
});

test("expired or undated deleted backup pages are not restored", async () => {
  const expired = application({ deletedAt: new Date(Date.now() - RETENTION_MS - 1000).toISOString() });
  const undated = application({ company: "Undated" });
  assert.deepEqual(await browserApi.importBackup([], [expired, undated]), { applications: [], recentlyDeleted: [] });
  assert.equal(localStorage.writes, 0);
});

test("a failed backup write leaves the entire existing notebook and IDs untouched", async () => {
  const existing = application({ id: 7, company: "Existing" });
  seed({ nextId: 8, applications: [existing], recentlyDeleted: [] });
  const original = localStorage.getItem(KEYS.data);
  let notifications = 0;
  setBrowserWriteListener(() => notifications++);
  localStorage.failWrites = true;
  await assert.rejects(browserApi.importBackup([application()], [application({ company: "Deleted", deletedAt: new Date().toISOString() })]), /would not save/);
  assert.equal(localStorage.getItem(KEYS.data), original);
  assert.deepEqual(browserApi.read(), { nextId: 8, applications: [existing], recentlyDeleted: [] });
  assert.equal(localStorage.writes, 1);
  assert.equal(notifications, 0);
});

test("importEntries keeps its array result and validates imported fields", async () => {
  const added = await browserApi.importEntries([application({ link: "javascript:alert(1)" }), { company: "", role: "Intern" }]);
  assert.equal(added.length, 1);
  assert.equal(added[0].link, "");
  assert.equal(browserApi.read().applications.length, 1);
});

test("server backup import sends one batch with original timestamps and serialized history", async t => {
  const active = application({ skills: ["Java", "SQL"] });
  const deleted = application({ company: "Deleted", deletedAt: new Date().toISOString() });
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    applications: [{ ...active, id: 10 }], recentlyDeleted: [{ ...deleted, id: 11 }]
  }), { status: 200 }));
  const added = await serverApi.importBackup([active], [deleted]);
  assert.equal(fetch.mock.callCount(), 1);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, "/api/applications/import");
  assert.equal(options.method, "POST");
  const body = JSON.parse(options.body);
  assert.equal(body.applications[0].skills, "Java, SQL");
  assert.equal(body.applications[0].history, "SAVED@2026-01-01T12:00:00.000Z;APPLIED@2026-01-03T12:00:00.000Z");
  assert.equal(body.applications[0].createdAt, active.createdAt);
  assert.equal(body.applications[0].updatedAt, active.updatedAt);
  assert.equal(body.recentlyDeleted[0].deletedAt, deleted.deletedAt);
  assert.deepEqual(added, { applications: [{ ...active, id: 10 }], recentlyDeleted: [{ ...deleted, id: 11 }] });
});
