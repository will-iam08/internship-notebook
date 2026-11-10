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
