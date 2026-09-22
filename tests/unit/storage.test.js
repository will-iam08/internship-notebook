import assert from "node:assert/strict";
import { test } from "node:test";

// A minimal in-memory localStorage so storage.js (written for the browser) runs under `node --test`.
class MemoryStorage {
  #map = new Map();
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
}
globalThis.localStorage = new MemoryStorage();

const { KEYS, StorageCorruptedError, quarantine, readJsonRecord, storage, readDrafts, writeDraft, clearDraft } =
  await import("../../src/main/resources/public/js/storage.js");

test("readJsonRecord distinguishes empty, corrupted, and ok", () => {
  assert.equal(readJsonRecord("missing-key").status, "empty");
  storage.set("bad-key", "{not json");
  assert.equal(readJsonRecord("bad-key").status, "corrupted");
  storage.set("array-key", "[1,2,3]"); // parses fine but is not a record object
  assert.equal(readJsonRecord("array-key").status, "corrupted");
  storage.set("ok-key", JSON.stringify({ applications: [] }));
  const ok = readJsonRecord("ok-key");
  assert.equal(ok.status, "ok");
  assert.deepEqual(ok.data, { applications: [] });
});

test("quarantine preserves the original bytes under a separate key and never touches the original", () => {
  storage.set(KEYS.data, "{ this is not valid json at all");
  const before = storage.get(KEYS.data);
  const quarantineKey = quarantine(KEYS.data, before);
  assert.notEqual(quarantineKey, KEYS.data);
  assert.equal(storage.get(quarantineKey), before);
  assert.equal(storage.get(KEYS.data), before, "the original corrupted key must be left exactly as found");
});

test("StorageCorruptedError carries the raw text so it can be downloaded", () => {
  const error = new StorageCorruptedError(KEYS.data, "garbage", "quarantine-key");
  assert.equal(error.raw, "garbage");
  assert.equal(error.name, "StorageCorruptedError");
});

test("drafts: writeDraft merges fields, readDrafts reflects it, clearDraft removes only that entry", () => {
  writeDraft(1, { notes: "first" });
  writeDraft(1, { company: "Acme" });
  assert.deepEqual(readDrafts()[1].changes, { notes: "first", company: "Acme" });
  writeDraft(2, { role: "Intern" });
  clearDraft(1);
  assert.equal(readDrafts()[1], undefined);
  assert.deepEqual(readDrafts()[2].changes, { role: "Intern" });
});
