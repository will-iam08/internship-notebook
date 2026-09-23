/*
 * Browser storage keys and a small wrapper around localStorage that never throws
 * (private windows and blocked storage make localStorage calls fail).
 */
export const KEYS = {
  data: "my-internship-notebook-browser-data-v1",
  drafts: "my-internship-notebook-drafts-v1",
  goal: "my-internship-notebook-weekly-goal",
  legacyGoal: "coop-compass-weekly-goal",
  theme: "my-internship-notebook-theme",
  prefs: "my-internship-notebook-prefs-v1"
};

export const storage = {
  get(key) { try { return globalThis.localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { globalThis.localStorage.setItem(key, value); return true; } catch { return false; } },
  remove(key) { try { globalThis.localStorage.removeItem(key); return true; } catch { return false; } }
};

/** Thrown when a storage key holds data that cannot be understood, so callers never mistake it for "empty". */
export class StorageCorruptedError extends Error {
  constructor(key, raw, quarantineKey) {
    super("Your saved notebook could not be read. Nothing has been deleted.");
    this.name = "StorageCorruptedError";
    this.key = key;
    this.raw = raw;
    this.quarantineKey = quarantineKey;
  }
}

/**
 * Reads and parses a JSON object out of a storage key, distinguishing three cases that a plain
 * `JSON.parse(raw || "{}")` cannot: no key yet ("empty", a fresh browser), a key whose value
 * cannot be parsed as an object at all ("corrupted", e.g. truncated by a full write, or garbage),
 * and a normal parsed object ("ok"). Callers must not treat "corrupted" the same as "empty":
 * doing so is how a damaged notebook gets silently overwritten with a blank one on the next save.
 */
export function readJsonRecord(key) {
  const raw = storage.get(key);
  if (raw == null || raw === "") return { status: "empty", data: null };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { status: "corrupted", raw }; }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "corrupted", raw };
  return { status: "ok", data: parsed };
}

/** Copies unreadable raw text to a separate key so it is never lost, and returns that key. */
export function quarantine(key, raw) {
  const quarantineKey = `${key}-recovery-${Date.now()}`;
  storage.set(quarantineKey, raw);
  return quarantineKey;
}

/* ---------- Local drafts: a safety net independent of whether a save has been confirmed ---------- */
export function readDrafts() {
  const result = readJsonRecord(KEYS.drafts);
  return result.status === "ok" ? result.data : {};
}

/** Merges `changes` into entry `id`'s on-disk draft. Called on every keystroke: cheap, and it
 *  means an edit survives a refresh, a lost connection, or the tab closing before autosave runs.
 *  Returns whether the write actually landed on disk - callers must check this and say so
 *  honestly (storage.set never throws, but a full or blocked store means nothing was captured,
 *  which is not the same thing as "captured but not yet confirmed"). */
export function writeDraft(id, changes) {
  const drafts = readDrafts();
  const existing = drafts[id]?.changes || {};
  drafts[id] = { changes: { ...existing, ...changes }, updatedAt: new Date().toISOString() };
  return storage.set(KEYS.drafts, JSON.stringify(drafts));
}

export function clearDraft(id) {
  const drafts = readDrafts();
  if (!(id in drafts)) return;
  delete drafts[id];
  storage.set(KEYS.drafts, JSON.stringify(drafts));
}

/**
 * Clears only the part of entry `id`'s draft that a just-confirmed save actually accounted for.
 *
 * flushEntrySave() takes a snapshot of the draft before the (async) save request goes out; if the
 * person keeps typing while that request is in flight, writeDraft() merges the new keystrokes into
 * the *current* on-disk draft, which is no longer the same object as the snapshot. Deleting the
 * whole draft once the snapshot's save is confirmed - which is what a plain clearDraft() does -
 * would silently throw those newer, never-sent keystrokes away. Comparing each field's *current*
 * value against what the snapshot actually sent (JSON.stringify, since values can be arrays, e.g.
 * skills) tells the two cases apart: unchanged since the snapshot -> safe to clear; changed since
 * -> a real edit that still needs to be saved, so it stays queued for the next flush.
 */
export function clearConfirmedDraft(id, confirmedChanges) {
  const drafts = readDrafts();
  const entry = drafts[id];
  if (!entry) return;
  const remaining = {};
  for (const [field, value] of Object.entries(entry.changes)) {
    const wasJustSaved = field in confirmedChanges && JSON.stringify(value) === JSON.stringify(confirmedChanges[field]);
    if (!wasJustSaved) remaining[field] = value;
  }
  if (Object.keys(remaining).length) {
    drafts[id] = { changes: remaining, updatedAt: new Date().toISOString() };
  } else {
    delete drafts[id];
  }
  storage.set(KEYS.drafts, JSON.stringify(drafts));
}
