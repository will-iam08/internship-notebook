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

const { KEYS, StorageCorruptedError, quarantine, readJsonRecord, storage, readDrafts, writeDraft, clearDraft, clearConfirmedDraft } =
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

test("writeDraft reports failure honestly instead of pretending the edit was captured", () => {
  const real = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new DOMException("QuotaExceededError simulated", "QuotaExceededError"); };
  try {
    const ok = writeDraft(99, { notes: "this can't actually be written" });
    assert.equal(ok, false, "writeDraft must report the failure so callers don't claim 'Saved locally'");
  } finally {
    globalThis.localStorage.setItem = real;
  }
});

test("clearConfirmedDraft: a plain edit is cleared once its save is confirmed", () => {
  clearDraft(3);
  writeDraft(3, { notes: "hello" });
  clearConfirmedDraft(3, { notes: "hello" });
  assert.equal(readDrafts()[3], undefined);
});

test("clearConfirmedDraft: only clears the fields the confirmed save actually covered", () => {
  clearDraft(4);
  writeDraft(4, { notes: "hello", location: "Remote" });
  // The save only went out for "notes"; "location" was never part of it and must stay queued.
  clearConfirmedDraft(4, { notes: "hello" });
  assert.deepEqual(readDrafts()[4].changes, { location: "Remote" });
});

test("clearConfirmedDraft: regression - an edit made while the save was in flight is never lost", () => {
  // Reproduces the original autosave race: flushEntrySave() snapshots the draft ({notes: "A"})
  // before its `await api.update(...)`. While that request is pending, the person keeps typing,
  // and queueChange()/writeDraft() merges "AB" into the *current* on-disk draft - a different
  // object than the snapshot the in-flight request is about to confirm.
  clearDraft(5);
  writeDraft(5, { notes: "A" });
  const snapshot = { ...readDrafts()[5].changes }; // what flushEntrySave() captured before awaiting
  writeDraft(5, { notes: "AB" }); // typed while the request for "A" is still in flight
  // The request for the snapshot now resolves and the app clears what it confirmed.
  clearConfirmedDraft(5, snapshot);
  assert.deepEqual(
    readDrafts()[5]?.changes,
    { notes: "AB" },
    "the edit made during the in-flight save must still be queued, not silently discarded"
  );
});

test("clearConfirmedDraft: array-valued fields (skills) compare by content, not identity", () => {
  clearDraft(6);
  writeDraft(6, { skills: ["Java", "SQL"] });
  const snapshot = { skills: [...readDrafts()[6].changes.skills] }; // a different array, same content
  clearConfirmedDraft(6, snapshot);
  assert.equal(readDrafts()[6], undefined, "an unchanged array value must still be recognized as confirmed");
});
