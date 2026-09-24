/*
 * Storage backends: one interface, two implementations.
 * - browserApi keeps entries in this browser (the public website).
 * - serverApi talks to the Java server (the full-stack local project).
 */
import { RETENTION_MS, cleanChanges, cleanStage, normalize, withStatus } from "./domain.js";
import { KEYS, StorageCorruptedError, quarantine, readJsonRecord, storage } from "./storage.js";

let browserWriteListener = null;
export function setBrowserWriteListener(listener) {
  browserWriteListener = typeof listener === "function" ? listener : null;
}

export const BROWSER_MODE = globalThis.NOTEBOOK_STORAGE_MODE === "browser"
  || Boolean(globalThis.location?.hostname.endsWith(".github.io"));

export const browserApi = {
  read() {
    // A key that exists but cannot be parsed is never treated as "empty": that is exactly how a
    // damaged notebook gets silently replaced by a blank one on the next save. Instead the raw
    // bytes are copied to a separate key (never touched again) and the caller is told to show a
    // recovery screen instead of the notebook.
    const result = readJsonRecord(KEYS.data);
    if (result.status === "corrupted") {
      throw new StorageCorruptedError(KEYS.data, result.raw, quarantine(KEYS.data, result.raw));
    }
    const saved = result.data || {};
    const cutoff = Date.now() - RETENTION_MS;
    const applications = (Array.isArray(saved.applications) ? saved.applications : []).map(normalize).filter(entry => entry.id > 0);
    const recentlyDeleted = (Array.isArray(saved.recentlyDeleted) ? saved.recentlyDeleted : [])
      .map(normalize)
      .filter(entry => entry.id > 0 && new Date(entry.deletedAt).getTime() > cutoff);
    const largestId = Math.max(0, ...applications.map(entry => entry.id), ...recentlyDeleted.map(entry => entry.id));
    return {
      nextId: Number.isInteger(saved.nextId) && saved.nextId > largestId ? saved.nextId : largestId + 1,
      applications,
      recentlyDeleted
    };
  },
  write(data) {
    if (!storage.set(KEYS.data, JSON.stringify(data))) {
      throw new Error("This browser would not save your change. Storage may be full or blocked (for example in a private window).");
    }
    browserWriteListener?.(structuredClone(data));
  },
  byIds(list, ids, message) {
    const found = ids.map(id => list.find(entry => entry.id === id));
    if (!ids.length || found.some(entry => !entry)) throw new Error(message);
    return found;
  },
  async load() {
    const data = this.read();
    return { applications: data.applications, deleted: data.recentlyDeleted };
  },
  async create(fields) {
    const data = this.read();
    const clean = cleanChanges(fields, { creating: true });
    const now = new Date().toISOString();
    const status = clean.status || "SAVED";
    const application = normalize({ ...clean, id: data.nextId++, status, createdAt: now, updatedAt: now, history: [{ status, at: now }] });
    data.applications.push(application);
    this.write(data);
    return application;
  },
  async update(id, changes) {
    const data = this.read();
    const index = data.applications.findIndex(entry => entry.id === id);
    if (index < 0) throw new Error("This page is no longer in your notebook.");
    const { status, ...fields } = cleanChanges(changes);
    if (!Object.keys(fields).length && !status) throw new Error("Nothing to update.");
    const now = new Date().toISOString();
    let updated = { ...data.applications[index], ...fields, updatedAt: now };
    if (status) updated = withStatus(updated, status, now);
    data.applications[index] = updated;
    this.write(data);
    return updated;
  },
  async setStatus(ids, status) {
    const data = this.read();
    const stage = cleanStage(status);
    const now = new Date().toISOString();
    const updated = this.byIds(data.applications, ids, "One or more applications could not be found.").map(entry => withStatus(entry, stage, now));
    data.applications = data.applications.map(entry => updated.find(changed => changed.id === entry.id) || entry);
    this.write(data);
    return updated;
  },
  async remove(ids) {
    const data = this.read();
    const deletedAt = new Date().toISOString();
    const removed = this.byIds(data.applications, ids, "One or more applications could not be found.").map(entry => ({ ...entry, deletedAt }));
    data.applications = data.applications.filter(entry => !ids.includes(entry.id));
    data.recentlyDeleted.push(...removed);
    this.write(data);
    return removed;
  },
  async restore(ids) {
    const data = this.read();
    const restored = this.byIds(data.recentlyDeleted, ids, "One or more deleted applications could not be found.").map(({ deletedAt, ...entry }) => entry);
    data.recentlyDeleted = data.recentlyDeleted.filter(entry => !ids.includes(entry.id));
    data.applications.push(...restored);
    this.write(data);
    return restored;
  },
  async purge(ids) {
    const data = this.read();
    const purged = this.byIds(data.recentlyDeleted, ids, "One or more deleted applications could not be found.");
    data.recentlyDeleted = data.recentlyDeleted.filter(entry => !ids.includes(entry.id));
    this.write(data);
    return purged;
  },
  async importEntries(entries) {
    const data = this.read();
    const fingerprint = entry => `${entry.company.toLowerCase()}|${entry.role.toLowerCase()}|${entry.createdAt}`;
    const existing = new Set([...data.applications, ...data.recentlyDeleted].map(fingerprint));
    const added = [];
    for (const raw of entries) {
      const entry = normalize({ ...raw, id: 1 });
      delete entry.deletedAt;
      if (!entry.company.trim() || !entry.role.trim() || existing.has(fingerprint(entry))) continue;
      entry.id = data.nextId++;
      existing.add(fingerprint(entry));
      added.push(entry);
    }
    data.applications.push(...added);
    this.write(data);
    return added;
  }
};

export const serverApi = {
  async request(url, options = {}) {
    let response;
    try {
      response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
    } catch {
      throw new Error("Could not reach the notebook server. Is it still running?");
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Could not save your change.");
    }
    return response.status === 204 ? null : response.json();
  },
  body(fields) {
    const payload = { ...fields };
    if (Array.isArray(payload.skills)) payload.skills = payload.skills.join(", ");
    return JSON.stringify(payload);
  },
  async load() {
    const [applications, deleted] = await Promise.all([this.request("/api/applications"), this.request("/api/recently-deleted")]);
    return { applications: applications.map(normalize), deleted: deleted.map(normalize) };
  },
  async create(fields) {
    return normalize(await this.request("/api/applications", { method: "POST", body: this.body(cleanChanges(fields, { creating: true })) }));
  },
  async update(id, changes) {
    return normalize(await this.request(`/api/applications/${id}`, { method: "PATCH", body: this.body(cleanChanges(changes)) }));
  },
  async setStatus(ids, status) {
    const updated = await this.request("/api/applications/bulk-status", { method: "POST", body: JSON.stringify({ ids, status: cleanStage(status) }) });
    return updated.map(normalize);
  },
  async remove(ids) {
    return (await this.request("/api/applications/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) })).map(normalize);
  },
  async restore(ids) {
    return (await this.request("/api/recently-deleted/bulk-restore", { method: "POST", body: JSON.stringify({ ids }) })).map(normalize);
  },
  async purge(ids) {
    return (await this.request("/api/recently-deleted/bulk-permanent-delete", { method: "POST", body: JSON.stringify({ ids }) })).map(normalize);
  },
  async importEntries(entries) {
    const added = [];
    for (const entry of entries) {
      const { id, createdAt, updatedAt, history, deletedAt, status, ...fields } = normalize({ ...entry, id: 1 });
      added.push(await this.create({ ...fields, status }));
    }
    return added;
  }
};

export const api = BROWSER_MODE ? browserApi : serverApi;
export { StorageCorruptedError } from "./storage.js";
