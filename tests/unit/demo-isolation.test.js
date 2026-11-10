import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { browserApi, setBrowserWriteListener } from "../../src/main/resources/public/js/api.js";
import { KEYS } from "../../src/main/resources/public/js/storage.js";
import { buildDemoDataset } from "../../src/main/resources/public/js/demo.js";

// A MemoryStorage that records every setItem key, mirroring the demo isolation contract: in demo
// mode a backend built over browserApi must never write KEYS.data or KEYS.drafts.
class RecordingStorage {
  #map = new Map();
  writes = [];
  getItem(key) { return this.#map.get(key) ?? null; }
  setItem(key, value) { this.writes.push(key); this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
}

// Reconstruct the demo backend exactly as app.js builds it: reuse browserApi methods but override
// read()/write() to operate on an in-memory record and never call storage.set / the write listener.
function makeDemoApi(initial) {
  let data = initial;
  return {
    ...browserApi,
    read() { return { nextId: data.nextId, applications: data.applications, recentlyDeleted: data.recentlyDeleted }; },
    write(next) { data = { nextId: next.nextId, applications: next.applications, recentlyDeleted: next.recentlyDeleted }; },
    snapshot() { return data; }
  };
}

beforeEach(() => {
  globalThis.localStorage = new RecordingStorage();
  setBrowserWriteListener(null);
});

test("a full sequence of demo mutations never writes to real storage", async () => {
  // Seed a real notebook so we can prove it is left byte-for-byte unchanged.
  const realBefore = JSON.stringify({ applications: [], recentlyDeleted: [], nextId: 1 });
  localStorage.setItem(KEYS.data, realBefore);
  localStorage.writes.length = 0;

  const demo = makeDemoApi(buildDemoDataset());
  const created = await demo.create({ company: "In-Memory Co", role: "Intern" });
  await demo.update(created.id, { notes: "edited in demo" });
  await demo.setStatus([created.id], "APPLIED");
  await demo.remove([created.id]);
  await demo.restore([created.id]);
  await demo.importBackup([{ company: "Imported", role: "Intern" }], []);

  // No demo mutation touched real storage at all.
  assert.deepEqual(localStorage.writes, [], "demo mutations must not write any storage key");
  assert.equal(localStorage.getItem(KEYS.data), realBefore, "real notebook must be byte-for-byte unchanged");
  assert.equal(localStorage.getItem(KEYS.drafts), null, "no draft key may be created in demo mode");
});

test("the demo backend reads only its in-memory dataset, not real storage", () => {
  localStorage.setItem(KEYS.data, JSON.stringify({ applications: [{ id: 42, company: "Real", role: "R", status: "SAVED" }], recentlyDeleted: [], nextId: 43 }));
  const demo = makeDemoApi(buildDemoDataset());
  assert.equal(demo.read().applications.length, 6);
  assert.ok(!demo.read().applications.some(a => a.company === "Real"));
  // Replacing real storage mid-session does not change what the demo shows.
  localStorage.setItem(KEYS.data, JSON.stringify({ applications: [], recentlyDeleted: [], nextId: 1 }));
  assert.equal(demo.read().applications.length, 6);
});

// The app's handlers do: const x = await api.<op>(...); then update the VISIBLE arrays once
// (state.applications.push(x) / filter). This only yields correct counts if the backend keeps its
// own record detached from the visible arrays (the aliasing bug duplicated entries). These tests
// reproduce that exact handler pattern against the detached demo adapter and assert counts.
function detachedDemoApi(initial) {
  let store = initial;
  const copy = list => list.map(entry => ({ ...entry }));
  return {
    ...browserApi,
    read() { return { nextId: store.nextId, applications: copy(store.applications), recentlyDeleted: copy(store.recentlyDeleted) }; },
    write(next) { store = { nextId: next.nextId, applications: copy(next.applications), recentlyDeleted: copy(next.recentlyDeleted) }; }
  };
}

test("demo create/delete/restore/import update visible counts exactly once (no duplication)", async () => {
  const demo = detachedDemoApi(buildDemoDataset());
  // Visible arrays, as the app keeps them, seeded from a detached read (as enterDemoMode does).
  let visibleApps = demo.read().applications;
  let visibleDeleted = demo.read().recentlyDeleted;
  const startCount = visibleApps.length; // 6

  // create: handler pushes the returned entry once.
  const created = await demo.create({ company: "New Co", role: "Intern" });
  visibleApps.push(created);
  assert.equal(visibleApps.length, startCount + 1, "create must add exactly one visible entry");

  // delete: handler filters visible apps and pushes removed into deleted once.
  const removed = await demo.remove([created.id]);
  visibleApps = visibleApps.filter(e => e.id !== created.id);
  visibleDeleted.push(...removed);
  assert.equal(visibleApps.length, startCount, "delete must remove exactly one visible entry");
  assert.equal(visibleDeleted.length, 1, "delete must add exactly one deleted entry");

  // restore: handler filters deleted and pushes restored into apps once.
  const restored = await demo.restore([created.id]);
  visibleDeleted = visibleDeleted.filter(e => e.id !== created.id);
  visibleApps.push(...restored);
  assert.equal(visibleApps.length, startCount + 1, "restore must add exactly one visible entry back");
  assert.equal(visibleDeleted.length, 0, "restore must empty the deleted list");

  // import: handler pushes added.applications once.
  const added = await demo.importBackup([{ company: "Imported Co", role: "Intern" }], []);
  visibleApps.push(...added.applications);
  assert.equal(added.applications.length, 1);
  assert.equal(visibleApps.length, startCount + 2, "import must add exactly the imported entries once");
});
