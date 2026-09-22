/*
 * My Internship Notebook
 * A dependency-free single-page app. It talks to the Java API when it runs locally
 * ("server" mode) and keeps entries privately in this browser on the public website
 * ("browser" mode). Both modes share one interface: the `api` object below.
 */
(() => {
"use strict";

/* ==========================================================================
   1. Constants
   ========================================================================== */
const STAGES = ["SAVED", "APPLIED", "INTERVIEW", "OFFER", "REJECTED"];
const PIPELINE = ["SAVED", "APPLIED", "INTERVIEW", "OFFER"];
const OPEN_STAGES = ["SAVED", "APPLIED", "INTERVIEW"];
const LABELS = { SAVED: "Saved", APPLIED: "Applied", INTERVIEW: "Interview", OFFER: "Offer", REJECTED: "Rejected" };
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 7 * DAY_MS;
const FOLLOW_UP_DAYS = 14;
const KEYS = {
  data: "my-internship-notebook-browser-data-v1",
  goal: "my-internship-notebook-weekly-goal",
  legacyGoal: "coop-compass-weekly-goal",
  theme: "my-internship-notebook-theme",
  prefs: "my-internship-notebook-prefs-v1"
};
const LIMITS = { company: 80, role: 100, location: 80, source: 60, notes: 10000, contact: 120, nextStep: 140, link: 500 };
const BROWSER_MODE = window.NOTEBOOK_STORAGE_MODE === "browser" || window.location.hostname.endsWith(".github.io");
const SOURCE_SUGGESTIONS = ["LinkedIn", "WaterlooWorks", "Company website", "Referral", "Handshake", "Indeed", "Career fair", "Recruiter"];
const VIEWS = {
  today: { title: "Today", tab: "--tab-today" },
  board: { title: "Board", tab: "--tab-board" },
  notebook: { title: "All pages", tab: "--tab-notebook" },
  insights: { title: "Insights", tab: "--tab-insights" },
  deleted: { title: "Recently Deleted", tab: "--tab-deleted" },
  settings: { title: "Settings", tab: "--tab-settings" },
  entry: { title: "Page", tab: "--tab-notebook" }
};

/* ==========================================================================
   2. Small helpers
   ========================================================================== */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = "") => String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isValidDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseDay(value).getTime());
const isValidIso = value => typeof value === "string" && !Number.isNaN(new Date(value).getTime());

const storage = {
  get(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { window.localStorage.setItem(key, value); return true; } catch { return false; } }
};

function pad(number) { return String(number).padStart(2, "0"); }
function dayKey(date = new Date()) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function parseDay(value) { const [year, month, day] = String(value).split("-").map(Number); return new Date(year, month - 1, day, 12); }
function startOfDay(date = new Date()) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function startOfWeek(date = new Date()) {
  const start = startOfDay(date);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}
function daysUntil(value) { return Math.round((parseDay(value) - parseDay(dayKey())) / DAY_MS); }
function formatDay(value, options = {}) {
  return parseDay(value).toLocaleDateString(undefined, { month: "short", day: "numeric", ...options });
}
function relativeDay(value) {
  const days = daysUntil(value);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1 && days < 7) return `in ${days} days`;
  if (days < -1 && days > -7) return `${-days} days ago`;
  return formatDay(value);
}
function timeAgo(iso) {
  const then = new Date(iso);
  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  const days = Math.round((startOfDay() - startOfDay(then)) / DAY_MS);
  if (days <= 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric", year: then.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function debounce(fn, wait) {
  let timer;
  const debounced = (...args) => { window.clearTimeout(timer); timer = window.setTimeout(() => fn(...args), wait); };
  debounced.cancel = () => window.clearTimeout(timer);
  return debounced;
}

/* ==========================================================================
   3. Icons (inline SVG, drawn on a 24px grid)
   ========================================================================== */
const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  board: '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><path d="M8.5 7.5v8M12.5 7.5v4.5M16.5 7.5v10"/>',
  notebook: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6M9 11h4"/>',
  insights: '<path d="M3.5 3.5v17h17"/><path d="M8 16.5v-4M12.5 16.5V8M17 16.5v-6"/>',
  trash: '<path d="M3.5 6.5h17M9 6.5V4.8c0-.7.6-1.3 1.3-1.3h3.4c.7 0 1.3.6 1.3 1.3v1.7M18.5 6.5l-.8 12.6c-.1 1.3-1.1 2.4-2.4 2.4H8.7c-1.3 0-2.3-1.1-2.4-2.4L5.5 6.5M10 11v6M14 11v6"/>',
  settings: '<path d="M4 21v-6.5M4 10.5V3M12 21v-8.5M12 8.5V3M20 21v-4.5M20 12.5V3M1.5 14.5h5M9.5 8.5h5M17.5 16.5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20.5 20.5-4.9-4.9"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6.5 9.5 17 4 11.5"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V7.5A1.5 1.5 0 0 1 5.5 6H11"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  moon: '<path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.6 6.6 0 0 0 10.7 10.7Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  system: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  download: '<path d="M12 3.5v11M7 10l5 5 5-5M4 16.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2.5"/>',
  upload: '<path d="M12 15V4M7 8.5l5-5 5 5M4 16.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2.5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  more: '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>',
  move: '<path d="M16 3.5 20 7.5l-4 4M20 7.5H5M8 20.5l-4-4 4-4M4 16.5h15"/>',
  select: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12 3 3 5-6"/>',
  restore: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M19 10c0 5.2-7 11-7 11s-7-5.8-7-11a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5c.8-3.6 4-5.5 8-5.5s7.2 1.9 8 5.5"/>',
  flag: '<path d="M5 21V4.5M5 4.5c4-2.4 7 2.4 14 0v9c-7 2.4-10-2.4-14 0"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5S9.6 5.8 12 3.5Z"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3A4.5 4.5 0 0 0 13 4.6l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4"/>',
  sparkle: '<path d="M12 3.5c.6 4.3 2.2 6 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.5 5.9-2.2 6.5-6.5ZM18.5 15.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5Z"/>',
  install: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M12 7v7M9 11.5l3 3 3-3M10.5 18.5h3"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  file: '<path d="M14 3.5H7A2.5 2.5 0 0 0 4.5 6v12A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5V9L14 3.5Z"/><path d="M14 3.5V9h5.5M8.5 13h7M8.5 16.5h5"/>',
  inbox: '<path d="M3.5 13.5 6 5.5A2 2 0 0 1 8 4h8a2 2 0 0 1 2 1.5l2.5 8M3.5 13.5V18a2.5 2.5 0 0 0 2.5 2.5h12a2.5 2.5 0 0 0 2.5-2.5v-4.5M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/>'
};
const LOGO = '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="3" width="34" height="34" rx="9" fill="#1f3447"/><rect x="10" y="8.5" width="21" height="24" rx="3" fill="#fbf8f1"/><path d="M14.5 16h11M14.5 20.5h11M14.5 25h7" stroke="#9fb1bd" stroke-width="1.8" stroke-linecap="round"/><path d="M25 8.5h4.5v10l-2.25-1.8L25 18.5Z" fill="#e0663f"/><g fill="#1f3447"><circle cx="10" cy="13" r="1.4"/><circle cx="10" cy="19" r="1.4"/><circle cx="10" cy="25" r="1.4"/></g></svg>';

function icon(name, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ""}</svg>`;
}

/* ==========================================================================
   4. Validation and data shape (mirrors ApplicationRepository.java)
   ========================================================================== */
function cleanText(value, field, { required = false } = {}) {
  const text = String(value ?? "").trim();
  if (required && !text) throw new Error(`${field === "role" ? "Role" : "Company"} is required.`);
  if (text.length > LIMITS[field]) throw new Error(`${field} must be ${LIMITS[field]} characters or fewer.`);
  return text;
}

function cleanDate(value, label) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (!isValidDate(text)) throw new Error(`${label} must be a valid date.`);
  return text;
}

/** Only web links are allowed, so a saved link can never run script when it is opened. */
function cleanLink(value) {
  let link = String(value ?? "").trim();
  if (!link) return "";
  if (link.length > LIMITS.link) throw new Error("Link must be 500 characters or fewer.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(link)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(link) && !/^[^:/]+\.[^:/]+:\d+/i.test(link)) {
      throw new Error("Link must be a web address starting with http:// or https://.");
    }
    link = `https://${link}`;
  }
  if (!/^https?:\/\//i.test(link)) throw new Error("Link must be a web address starting with http:// or https://.");
  try {
    if (!new URL(link).hostname) throw new Error();
  } catch {
    throw new Error("Link must be a valid web address.");
  }
  return link;
}

function cleanSkills(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  const seen = new Set();
  const skills = [];
  for (const raw of list) {
    const skill = String(raw).trim();
    if (!skill) continue;
    const formatted = skill.charAt(0).toUpperCase() + skill.slice(1);
    if (seen.has(formatted)) continue;
    seen.add(formatted);
    skills.push(formatted.slice(0, 40));
    if (skills.length === 12) break;
  }
  return skills;
}

function cleanStage(value) {
  const stage = String(value ?? "").toUpperCase();
  if (!STAGES.includes(stage)) throw new Error("Choose a valid pipeline stage.");
  return stage;
}

/** Validates only the fields that are present, so one field can be saved at a time. */
function cleanChanges(changes, { creating = false } = {}) {
  const clean = {};
  const has = key => Object.prototype.hasOwnProperty.call(changes, key);
  if (creating || has("company")) clean.company = cleanText(changes.company, "company", { required: true });
  if (creating || has("role")) clean.role = cleanText(changes.role, "role", { required: true });
  for (const field of ["location", "source", "notes", "contact", "nextStep"]) {
    if (has(field)) clean[field] = cleanText(changes[field], field);
  }
  if (has("deadline")) clean.deadline = cleanDate(changes.deadline, "Deadline");
  if (has("nextStepDate")) clean.nextStepDate = cleanDate(changes.nextStepDate, "Next step date");
  if (has("link")) clean.link = cleanLink(changes.link);
  if (has("skills")) clean.skills = cleanSkills(changes.skills);
  if (has("starred")) clean.starred = Boolean(changes.starred);
  if (has("status")) clean.status = cleanStage(changes.status || "SAVED");
  return clean;
}

/** Fills in fields that older saved entries do not have yet, without losing anything. */
function normalize(entry) {
  const status = STAGES.includes(entry.status) ? entry.status : "SAVED";
  const createdAt = isValidIso(entry.createdAt) ? entry.createdAt : new Date().toISOString();
  const history = Array.isArray(entry.history)
    ? entry.history.filter(change => change && STAGES.includes(change.status) && isValidIso(change.at)).map(change => ({ status: change.status, at: change.at }))
    : [];
  const text = value => (value == null ? "" : String(value));
  const application = {
    id: Number(entry.id),
    company: text(entry.company),
    role: text(entry.role),
    location: text(entry.location),
    source: text(entry.source),
    status,
    deadline: isValidDate(text(entry.deadline)) ? entry.deadline : "",
    notes: text(entry.notes),
    skills: cleanSkills(entry.skills),
    createdAt,
    updatedAt: isValidIso(entry.updatedAt) ? entry.updatedAt : createdAt,
    link: text(entry.link),
    contact: text(entry.contact),
    nextStep: text(entry.nextStep),
    nextStepDate: isValidDate(text(entry.nextStepDate)) ? entry.nextStepDate : "",
    starred: entry.starred === true,
    history: history.length ? history : [{ status, at: createdAt }]
  };
  if (entry.deletedAt) application.deletedAt = entry.deletedAt;
  return application;
}

function withStatus(application, status, at) {
  if (application.status === status) return application;
  return { ...application, status, updatedAt: at, history: [...application.history, { status, at }] };
}

/* ==========================================================================
   5. Storage backends: one interface, two implementations
   ========================================================================== */
const browserApi = {
  read() {
    let saved = {};
    try { saved = JSON.parse(storage.get(KEYS.data) || "{}") || {}; } catch { saved = {}; }
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

const serverApi = {
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

const api = BROWSER_MODE ? browserApi : serverApi;

/* ==========================================================================
   6. State and preferences
   ========================================================================== */
function readPrefs() {
  let saved = {};
  try { saved = JSON.parse(storage.get(KEYS.prefs) || "{}") || {}; } catch { saved = {}; }
  const legacyGoal = Number(storage.get(KEYS.goal) ?? storage.get(KEYS.legacyGoal));
  const theme = storage.get(KEYS.theme);
  return {
    goal: clamp(Number(saved.goal) || (legacyGoal > 0 ? legacyGoal : 5), 1, 50),
    name: typeof saved.name === "string" ? saved.name.slice(0, 40) : "",
    theme: theme === "light" || theme === "dark" ? theme : "system",
    sort: ["updated", "created", "deadline", "company"].includes(saved.sort) ? saved.sort : "updated"
  };
}

const state = {
  applications: [],
  deleted: [],
  loaded: false,
  loadError: "",
  route: { view: "today", id: null },
  backRoute: "#/board",
  selecting: false,
  selectScope: "",
  selected: new Set(),
  visibleIds: [],
  boardQuery: "",
  filter: { query: "", stage: "ALL" },
  prefs: readPrefs(),
  installPrompt: null,
  dragId: null
};

function savePrefs() {
  const { goal, name, sort } = state.prefs;
  storage.set(KEYS.prefs, JSON.stringify({ goal, name, sort }));
  storage.set(KEYS.goal, String(goal));
  storage.set(KEYS.theme, state.prefs.theme);
}

const find = id => state.applications.find(entry => entry.id === id);
const findDeleted = id => state.deleted.find(entry => entry.id === id);

function replaceApplications(updated) {
  const byId = new Map(updated.map(entry => [entry.id, entry]));
  state.applications = state.applications.map(entry => byId.get(entry.id) || entry);
}

/* ==========================================================================
   7. Theme
   ========================================================================== */
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function resolvedTheme() { return state.prefs.theme === "system" ? (darkQuery.matches ? "dark" : "light") : state.prefs.theme; }
function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  $$('meta[name="theme-color"]').forEach(meta => meta.setAttribute("content", theme === "dark" ? "#111418" : "#f3eee4"));
  const iconName = state.prefs.theme === "system" ? "system" : theme === "dark" ? "moon" : "sun";
  $$("[data-theme-icon]").forEach(element => { element.innerHTML = icon(iconName); });
  $$(".cover-theme").forEach(button => button.setAttribute("title", `Theme: ${themeLabel()} (click to change)`));
}
function themeLabel() { return { system: "Match system", light: "Light", dark: "Dark" }[state.prefs.theme]; }
function setTheme(theme) {
  state.prefs.theme = theme;
  savePrefs();
  applyTheme();
  if (state.route.view === "settings") rerender();
}
darkQuery.addEventListener?.("change", () => { if (state.prefs.theme === "system") applyTheme(); });

/* ==========================================================================
   8. Derived numbers (all computed from the entries themselves)
   ========================================================================== */
const countBy = list => Object.fromEntries(STAGES.map(stage => [stage, list.filter(entry => entry.status === stage).length]));
const reached = (entry, stage) => entry.status === stage || entry.history.some(change => change.status === stage)
  || (stage === "INTERVIEW" && entry.status === "OFFER");

/** When an application was sent: the first time it left "Saved". */
function sentAt(entry) {
  const change = entry.history.find(item => item.status !== "SAVED");
  if (change) return change.at;
  return entry.status === "SAVED" ? null : entry.createdAt;
}

/** The date the stage last changed, used to spot applications waiting for a reply. */
function stageSince(entry) {
  const last = [...entry.history].reverse().find(change => change.status === entry.status);
  return last ? last.at : entry.createdAt;
}

function metrics(list = state.applications) {
  const counts = countBy(list);
  const sent = list.length - counts.SAVED;
  const responses = counts.INTERVIEW + counts.OFFER + counts.REJECTED;
  const interviews = list.filter(entry => entry.status !== "SAVED" && reached(entry, "INTERVIEW")).length;
  return {
    counts,
    total: list.length,
    open: counts.SAVED + counts.APPLIED + counts.INTERVIEW,
    sent,
    responseRate: sent ? Math.round((responses * 100) / sent) : 0,
    interviewRate: sent ? Math.round((interviews * 100) / sent) : 0,
    interviews
  };
}

function weekActivity(weekOffset = 0) {
  const start = startOfWeek();
  start.setDate(start.getDate() + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, key: dayKey(date), count: 0 };
  });
  for (const entry of state.applications) {
    const at = sentAt(entry);
    if (!at) continue;
    const key = dayKey(new Date(at));
    const day = days.find(item => item.key === key);
    if (day) day.count++;
  }
  return { start, days, total: days.reduce((sum, day) => sum + day.count, 0) };
}

/** Dated things coming up: deadlines for saved roles and next steps for everything still open. */
function agendaItems() {
  const items = [];
  for (const entry of state.applications) {
    if (entry.status === "SAVED" && entry.deadline && daysUntil(entry.deadline) >= 0) {
      items.push({ date: entry.deadline, kind: "deadline", entry });
    }
    if (entry.nextStepDate && entry.status !== "REJECTED") {
      items.push({ date: entry.nextStepDate, kind: "next", entry });
    }
  }
  return items
    .filter(item => daysUntil(item.date) <= 21 && (item.kind === "deadline" || daysUntil(item.date) >= -30))
    .sort((left, right) => left.date.localeCompare(right.date) || left.entry.company.localeCompare(right.entry.company));
}

/** Gentle nudges: roles about to close, closed deadlines, and applications waiting a long time. */
function attentionItems() {
  const items = [];
  for (const entry of state.applications) {
    if (entry.status === "SAVED" && entry.deadline) {
      const days = daysUntil(entry.deadline);
      if (days >= 0 && days <= 3) items.push({ level: "warn", rank: 1, entry, icon: "clock", title: `Due ${relativeDay(entry.deadline)}`, copy: `Apply to ${entry.company} before ${formatDay(entry.deadline, { weekday: "short" })}` });
      else if (days < 0 && days >= -30) items.push({ level: "danger", rank: 0, entry, icon: "alert", title: "Deadline passed", copy: `${entry.company}: mark it applied, or move it to Rejected` });
    }
    if (entry.status === "APPLIED") {
      const waited = Math.floor((Date.now() - new Date(stageSince(entry)).getTime()) / DAY_MS);
      const upcomingStep = entry.nextStepDate && daysUntil(entry.nextStepDate) >= 0;
      if (waited >= FOLLOW_UP_DAYS && !upcomingStep) items.push({ level: "info", rank: 2, entry, icon: "mail", title: `No reply in ${waited} days`, copy: `${entry.company}: a short follow-up email could help` });
    }
    if (entry.status === "INTERVIEW" && !entry.nextStepDate) {
      items.push({ level: "info", rank: 3, entry, icon: "calendar", title: "Interview stage", copy: `${entry.company}: add the interview date as a next step` });
    }
  }
  return items.sort((left, right) => left.rank - right.rank).slice(0, 5);
}

/* ==========================================================================
   9. Shared rendering pieces
   ========================================================================== */
const pill = stage => `<span class="pill st-${stage}">${LABELS[stage]}</span>`;

function dateChip(entry) {
  if (entry.status === "SAVED" && entry.deadline) {
    const days = daysUntil(entry.deadline);
    const tone = days < 0 ? "overdue" : days <= 3 ? "soon" : "";
    return `<span class="date-chip ${tone}" title="Application deadline">${icon("clock")}${days < 0 ? "Closed " : "Due "}${esc(formatDay(entry.deadline))}</span>`;
  }
  if (entry.nextStepDate && entry.status !== "REJECTED") {
    const days = daysUntil(entry.nextStepDate);
    const tone = days < 0 ? "overdue" : days <= 2 ? "soon" : "";
    return `<span class="date-chip ${tone}" title="${esc(entry.nextStep || "Next step")}">${icon("flag")}${esc(formatDay(entry.nextStepDate))}</span>`;
  }
  return "";
}

function appCard(entry, index = 0, { selectable = false, draggable = false, compact = false } = {}) {
  const selected = state.selected.has(entry.id);
  const skills = compact ? [] : entry.skills.slice(0, 3);
  const more = compact ? 0 : entry.skills.length - skills.length;
  const meta = [dateChip(entry), entry.location ? `<span>${icon("pin")}${esc(entry.location)}</span>` : ""].filter(Boolean).join("");
  return `
    <article class="app-card st-${entry.status}${selected ? " selected" : ""}" data-open="${entry.id}" data-id="${entry.id}" tabindex="0"
      ${draggable && !selectable ? 'draggable="true"' : ""} style="--i:${index}"
      aria-label="${esc(`${entry.company}, ${entry.role}, ${LABELS[entry.status]}`)}">
      <div class="app-card-top">
        ${selectable ? `<input type="checkbox" data-select="${entry.id}" ${selected ? "checked" : ""} aria-label="Select ${esc(entry.company)}" />` : ""}
        <span class="app-company">${esc(entry.company)}</span>
        ${entry.starred ? `<span class="star on" title="Starred">${icon("star")}</span>` : ""}
        ${compact ? pill(entry.status) : `<button class="card-mini-button" type="button" data-action="card-menu" data-id="${entry.id}" aria-label="Actions for ${esc(entry.company)}">${icon("more")}</button>`}
      </div>
      <h3 class="app-role">${esc(entry.role)}</h3>
      ${meta ? `<div class="app-meta">${meta}</div>` : ""}
      ${skills.length ? `<div class="chips">${skills.map(skill => `<span class="chip">${esc(skill)}</span>`).join("")}${more > 0 ? `<span class="chip">+${more}</span>` : ""}</div>` : ""}
    </article>`;
}

function viewHead({ eyebrow, title, sub = "", actions = "" }) {
  return `
    <header class="view-head">
      <div>
        <p class="eyebrow">${eyebrow}</p>
        <h1 class="view-title">${title}</h1>
        ${sub ? `<p class="view-sub">${sub}</p>` : ""}
      </div>
      ${actions ? `<div class="view-actions">${actions}</div>` : ""}
    </header>`;
}

function emptyState({ iconName, title, copy, action = "" }) {
  return `<div class="empty-state"><div class="empty-icon">${icon(iconName)}</div><h3>${title}</h3><p>${copy}</p>${action}</div>`;
}

const newButton = (label = "New application") => `<button class="button primary" type="button" data-action="new">${icon("plus")}<span>${label}</span></button>`;
const selectButton = scope => `<button class="button ghost" type="button" data-action="start-select" data-scope="${scope}" ${state.selecting && state.selectScope === scope ? 'aria-pressed="true"' : ""}>${icon("select")}<span>Select</span></button>`;

/* ==========================================================================
   10. Views
   ========================================================================== */
function viewToday() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 5 ? "Burning the midnight oil" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = state.prefs.name.trim();
  const dateLine = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const head = viewHead({
    eyebrow: esc(dateLine),
    title: `${greeting}${name ? `, ${esc(name)}` : ""}<span class="dot">.</span>`,
    actions: newButton()
  });

  if (!state.applications.length) {
    return `${head}
      <section class="card welcome">
        <div class="sticky-note" aria-hidden="true">Tip: press <b>N</b> anywhere to start a new page.</div>
        <p class="eyebrow">Welcome</p>
        <h2>Every internship application, one tidy notebook.</h2>
        <p>Add a role you're interested in, move it along as you apply and interview, and keep notes for each one. Your entries ${BROWSER_MODE ? "stay private in this browser. Nothing is uploaded." : "are saved on this computer by the notebook server."}</p>
        <ol class="welcome-steps">
          <li><strong>Save roles</strong>Add companies and deadlines as you find them.</li>
          <li><strong>Track each stage</strong>Drag cards from Saved to Applied, Interview, and Offer.</li>
          <li><strong>Keep your notes</strong>Each application gets its own lined page for prep and contacts.</li>
        </ol>
        <div class="welcome-actions">
          ${newButton("Add your first application")}
          <a class="button ghost" href="#/settings">${icon("install")}<span>Install as an app</span></a>
        </div>
      </section>`;
  }

  const stats = metrics();
  const segments = STAGES.filter(stage => stats.counts[stage]).map(stage =>
    `<span class="st-${stage}" style="flex-grow:${stats.counts[stage]}" title="${LABELS[stage]}: ${stats.counts[stage]}"></span>`).join("");
  const legend = STAGES.map(stage => `<li><a href="#/notebook" data-action="filter-stage" data-stage="${stage}" class="st-${stage}"><i></i>${LABELS[stage]} <b>${stats.counts[stage]}</b></a></li>`).join("");
  const strip = `
    <section class="card strip" aria-label="Pipeline summary">
      <div class="strip-top">
        <div class="strip-figure"><strong>${stats.open}</strong><span>${stats.open === 1 ? "open application" : "open applications"}</span></div>
        <p class="strip-rate">Response rate <b>${stats.responseRate}%</b> · ${plural(stats.sent, "sent", "sent")}</p>
      </div>
      <div class="stack-bar" role="img" aria-label="${STAGES.map(stage => `${LABELS[stage]} ${stats.counts[stage]}`).join(", ")}">${segments}</div>
      <ul class="legend">${legend}</ul>
    </section>`;

  const week = weekActivity();
  const goal = state.prefs.goal;
  const progress = Math.min(1, week.total / goal);
  const circumference = 2 * Math.PI * 48;
  const todayKey = dayKey();
  const goalCopy = week.total >= goal
    ? `Goal reached with ${plural(week.total, "application")} sent this week. Nice rhythm.`
    : `${plural(goal - week.total, "more application")} to reach your goal of ${goal} this week.`;
  const goalCard = `
    <section class="card goal-card" aria-labelledby="goal-title">
      <div class="card-head"><div><h2 class="card-title" id="goal-title">This week</h2><p class="card-note">Applications sent since Monday</p></div>
        <div class="goal-stepper" aria-label="Weekly goal">
          <button type="button" data-action="goal" data-delta="-1" aria-label="Lower weekly goal">−</button>
          <output aria-live="polite">${goal}</output>
          <button type="button" data-action="goal" data-delta="1" aria-label="Raise weekly goal">+</button>
        </div>
      </div>
      <div class="goal-body">
        <div class="ring${progress >= 1 ? " done" : ""}" role="img" aria-label="${week.total} of ${goal} sent this week">
          <svg viewBox="0 0 116 116"><circle class="ring-track" cx="58" cy="58" r="48"/><circle class="ring-fill" cx="58" cy="58" r="48" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${(circumference * (1 - progress)).toFixed(1)}"/></svg>
          <div class="ring-label"><strong>${week.total}</strong><span>of ${goal}</span></div>
        </div>
        <p class="goal-copy">${goalCopy}</p>
      </div>
      <div class="week-dots">
        ${week.days.map(day => `<div class="week-dot${day.count ? " has" : ""}${day.key === todayKey ? " today" : ""}${day.key > todayKey ? " future" : ""}" title="${esc(day.date.toLocaleDateString(undefined, { weekday: "long" }))}: ${plural(day.count, "sent", "sent")}">
          <i>${day.count || ""}</i><span>${esc(day.date.toLocaleDateString(undefined, { weekday: "narrow" }))}</span></div>`).join("")}
      </div>
    </section>`;

  const agenda = agendaItems();
  const groups = [];
  for (const item of agenda.slice(0, 9)) {
    const days = daysUntil(item.date);
    const key = days < 0 ? "overdue" : item.date;
    let group = groups.find(entry => entry.key === key);
    if (!group) {
      group = { key, items: [], label: days < 0 ? "Overdue" : days === 0 ? "Today" : days === 1 ? "Tomorrow" : formatDay(item.date, { weekday: "short" }), tone: days < 0 ? "overdue" : days === 0 ? "today" : "" };
      groups.push(group);
    }
    group.items.push(item);
  }
  const agendaCard = `
    <section class="card agenda-card" aria-labelledby="agenda-title">
      <div class="card-head"><div><h2 class="card-title" id="agenda-title">Coming up</h2><p class="card-note">Deadlines and next steps for the next three weeks</p></div></div>
      ${groups.length ? `<ul class="agenda">${groups.map(group => `
        <li class="agenda-day">
          <p class="agenda-date ${group.tone}">${esc(group.label)}</p>
          <div class="agenda-items">${group.items.map(item => `
            <button class="agenda-item" type="button" data-open="${item.entry.id}">
              <span class="agenda-kind st-${item.kind === "deadline" ? "SAVED" : item.entry.status}">${icon(item.kind === "deadline" ? "clock" : "flag")}</span>
              <span class="agenda-text"><strong>${esc(item.kind === "deadline" ? `Apply to ${item.entry.company}` : item.entry.nextStep || `Next step with ${item.entry.company}`)}</strong>
              <span>${esc(item.kind === "deadline" ? item.entry.role : `${item.entry.company} · ${item.entry.role}`)}</span></span>
            </button>`).join("")}</div>
        </li>`).join("")}</ul>${agenda.length > 9 ? `<p class="card-note" style="margin-top:10px">${plural(agenda.length - 9, "more item")} in <a href="#/notebook" data-action="sort-deadline">All pages</a>.</p>` : ""}`
      : `<p class="empty-note">Nothing dated yet. Add a deadline or a next step (like an interview date) to a page and it shows up here.</p>`}
    </section>`;

  const attention = attentionItems();
  const attentionCard = `
    <section class="card attention-card" aria-labelledby="attention-title">
      <div class="card-head"><div><h2 class="card-title" id="attention-title">Worth a look</h2><p class="card-note">Small nudges based on your dates and stages</p></div></div>
      ${attention.length ? `<ul class="attention-list">${attention.map(item => `
        <li><button class="attention-item" type="button" data-open="${item.entry.id}">
          <span class="attention-icon ${item.level}">${icon(item.icon)}</span>
          <span class="attention-copy"><strong>${esc(item.title)}</strong><span>${esc(item.copy)}</span></span>
          <span class="attention-go">${icon("forward")}</span>
        </button></li>`).join("")}</ul>`
      : `<p class="empty-note">${icon("check", "inline")} You're all caught up. Nothing needs attention right now.</p>`}
    </section>`;

  const recent = [...state.applications].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 4);
  const recentCard = `
    <section class="card recent-card" aria-labelledby="recent-title">
      <div class="card-head"><div><h2 class="card-title" id="recent-title">Recently edited</h2><p class="card-note">Jump back into a page</p></div><a class="text-button" href="#/notebook">All pages</a></div>
      <div class="recent-list">${recent.map((entry, index) => appCard(entry, index, { compact: true })).join("")}</div>
    </section>`;

  return `${head}<div class="today-grid">${strip}${goalCard}${agendaCard}${attentionCard}${recentCard}</div>`;
}

function matchesQuery(entry, query) {
  if (!query) return true;
  const haystack = [entry.company, entry.role, entry.location, entry.source, entry.contact, entry.nextStep, entry.notes, entry.skills.join(" ")].join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).every(word => haystack.includes(word));
}

function viewBoard() {
  const query = state.boardQuery.trim();
  const visible = state.applications.filter(entry => matchesQuery(entry, query));
  state.visibleIds = visible.map(entry => entry.id);
  const selecting = state.selecting && state.selectScope === "board";
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const columns = STAGES.map(stage => {
    const entries = visible.filter(entry => entry.status === stage).sort(compareBy(stage === "SAVED" ? "deadline" : "updated"));
    return `
      <section class="column st-${stage}" data-stage="${stage}" aria-label="${LABELS[stage]}">
        <header class="column-head"><span class="dot"></span><h2>${LABELS[stage]}</h2><span class="count">${entries.length}</span>
          <button class="card-mini-button" type="button" data-action="new" data-stage="${stage}" aria-label="Add to ${LABELS[stage]}">${icon("plus")}</button></header>
        <div class="column-cards">
          ${entries.length ? entries.map((entry, index) => appCard(entry, index, { selectable: selecting, draggable: finePointer })).join("")
            : `<p class="column-empty">${query ? "No matches" : finePointer ? "Drop a card here" : "Nothing here yet"}</p>`}
        </div>
      </section>`;
  }).join("");
  return `
    ${viewHead({ eyebrow: "Your pipeline", title: "Board", sub: `${plural(state.applications.length, "application")} across five stages.`, actions: `${selectButton("board")}${newButton()}` })}
    <div class="toolbar">
      <label class="search-box">${icon("search")}<span class="sr-only">Filter the board</span><input type="search" data-input="board-query" value="${esc(state.boardQuery)}" placeholder="Filter by company, role, or skill" /></label>
      ${finePointer ? `<p class="drag-hint">Drag cards between columns to change their stage.</p>` : ""}
    </div>
    <div class="board" id="board">${columns}</div>`;
}

function compareBy(sort) {
  return (left, right) => {
    if (sort === "company") return left.company.localeCompare(right.company) || left.role.localeCompare(right.role);
    if (sort === "deadline") {
      const leftDate = (left.status === "SAVED" && left.deadline) || left.nextStepDate || "9999-12-31";
      const rightDate = (right.status === "SAVED" && right.deadline) || right.nextStepDate || "9999-12-31";
      return leftDate.localeCompare(rightDate) || right.updatedAt.localeCompare(left.updatedAt);
    }
    if (sort === "created") return right.createdAt.localeCompare(left.createdAt);
    return right.updatedAt.localeCompare(left.updatedAt);
  };
}

function notebookList() {
  const { query, stage } = state.filter;
  return state.applications
    .filter(entry => stage === "ALL" || (stage === "OPEN" ? OPEN_STAGES.includes(entry.status) : stage === "STARRED" ? entry.starred : entry.status === stage))
    .filter(entry => matchesQuery(entry, query.trim()))
    .sort(compareBy(state.prefs.sort));
}

function viewNotebook() {
  const list = notebookList();
  state.visibleIds = list.map(entry => entry.id);
  const selecting = state.selecting && state.selectScope === "notebook";
  const counts = countBy(state.applications);
  const chips = [
    ["ALL", "All", state.applications.length],
    ["OPEN", "Open", counts.SAVED + counts.APPLIED + counts.INTERVIEW],
    ...STAGES.map(stage => [stage, LABELS[stage], counts[stage]]),
    ["STARRED", "Starred", state.applications.filter(entry => entry.starred).length]
  ];
  const rows = list.map((entry, index) => `
    <li class="toc-row st-${entry.status}${state.selected.has(entry.id) ? " selected" : ""}" data-open="${entry.id}" tabindex="0" style="--i:${index}"
      aria-label="${esc(`${entry.company}, ${entry.role}, ${LABELS[entry.status]}`)}">
      <div class="toc-lead">
        ${selecting ? `<input type="checkbox" data-select="${entry.id}" ${state.selected.has(entry.id) ? "checked" : ""} aria-label="Select ${esc(entry.company)}" />` : ""}
        <button class="card-mini-button star${entry.starred ? " on" : ""}" type="button" data-action="toggle-star" data-id="${entry.id}" aria-pressed="${entry.starred}" aria-label="${entry.starred ? "Unstar" : "Star"} ${esc(entry.company)}">${icon("star")}</button>
      </div>
      <div class="toc-main">
        <div class="toc-title"><strong>${esc(entry.company)} <span class="muted" style="font-weight:500">· ${esc(entry.role)}</span></strong></div>
        <p class="toc-sub">${esc([entry.location, entry.source, entry.skills.slice(0, 4).join(", ")].filter(Boolean).join(" · ") || "No details yet")}</p>
      </div>
      <div class="toc-end">${pill(entry.status)}${dateChip(entry)}<span class="toc-updated" title="Last edited">${esc(timeAgo(entry.updatedAt))}</span></div>
    </li>`).join("");
  const sortOptions = [["updated", "Recently edited"], ["created", "Recently added"], ["deadline", "Upcoming dates"], ["company", "Company A–Z"]];
  return `
    ${viewHead({ eyebrow: "Table of contents", title: "All pages", sub: "Every application in your notebook. Open one to edit it and keep notes.", actions: `
      <button class="button ghost" type="button" data-action="export-csv">${icon("download")}<span>CSV</span></button>${selectButton("notebook")}${newButton()}` })}
    <div class="filters" role="group" aria-label="Filter by stage">
      ${chips.map(([value, label, count]) => `<button class="filter-chip" type="button" data-action="filter-chip" data-stage="${value}" aria-pressed="${state.filter.stage === value}">${label} <b>${count}</b></button>`).join("")}
    </div>
    <div class="toolbar">
      <label class="search-box">${icon("search")}<span class="sr-only">Search pages</span><input type="search" data-input="notebook-query" value="${esc(state.filter.query)}" placeholder="Search company, role, skill, or notes" /></label>
      <label><span class="sr-only">Sort pages</span><select data-input="sort" aria-label="Sort pages">${sortOptions.map(([value, label]) => `<option value="${value}" ${state.prefs.sort === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    </div>
    ${state.applications.length === 0
      ? `<div class="card">${emptyState({ iconName: "notebook", title: "Your notebook is empty", copy: "Add your first application and it will appear here as a page.", action: newButton() })}</div>`
      : list.length
        ? `<ul class="toc" aria-label="Applications">${rows}</ul>`
        : `<div class="card">${emptyState({ iconName: "search", title: "No pages match", copy: "Try a different search or stage filter.", action: `<button class="button ghost" type="button" data-action="clear-filters">Clear filters</button>` })}</div>`}
    <div class="toc-footer">
      <span>${plural(list.length, "page")} shown</span>
      <a class="text-button" href="#/deleted">${icon("trash")} Recently Deleted${state.deleted.length ? ` (${state.deleted.length})` : ""}</a>
    </div>`;
}

/** Drawn at the container's real pixel width so labels stay 12px on every screen size. */
function weeklyChart(containerWidth = 520) {
  const width = Math.max(260, Math.round(containerWidth));
  const weeks = width < 420 ? 6 : 10;
  const data = Array.from({ length: weeks }, (_, index) => weekActivity(index - weeks + 1));
  const goal = state.prefs.goal;
  const max = Math.max(goal, ...data.map(week => week.total), 1);
  const top = Math.ceil(max / 2) * 2;
  const height = 200, left = 26, right = 6, topPad = 22, bottom = 26;
  const plotWidth = width - left - right, plotHeight = height - topPad - bottom;
  const band = plotWidth / weeks;
  const barWidth = Math.min(24, band * 0.56);
  const y = value => topPad + plotHeight - (value / top) * plotHeight;
  const ticks = [0, top / 2, top];
  const maxWeek = data.reduce((best, week, index) => (week.total > data[best].total ? index : best), 0);
  const bars = data.map((week, index) => {
    const x = left + band * index + (band - barWidth) / 2;
    const barHeight = (week.total / top) * plotHeight;
    const radius = Math.min(4, barHeight);
    const baseline = topPad + plotHeight;
    const label = `Week of ${week.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${plural(week.total, "application")} sent`;
    const path = barHeight > 0
      ? `M${x},${baseline} V${baseline - barHeight + radius} Q${x},${baseline - barHeight} ${x + radius},${baseline - barHeight} H${x + barWidth - radius} Q${x + barWidth},${baseline - barHeight} ${x + barWidth},${baseline - barHeight + radius} V${baseline} Z`
      : "";
    const showValue = week.total > 0 && (index === weeks - 1 || index === maxWeek);
    const showTick = band >= 64 || index % 2 === (weeks - 1) % 2;
    return `
      <rect class="bar-hit" x="${left + band * index}" y="${topPad}" width="${band}" height="${plotHeight}" tabindex="0" data-tip="${esc(label)}" aria-label="${esc(label)}"></rect>
      ${path ? `<path class="bar" d="${path}"></path>` : ""}
      ${showValue ? `<text class="value-label" x="${x + barWidth / 2}" y="${baseline - barHeight - 6}" text-anchor="middle">${week.total}</text>` : ""}
      ${showTick ? `<text class="axis-label" x="${x + barWidth / 2}" y="${height - 8}" text-anchor="middle">${index === weeks - 1 ? "This week" : esc(week.start.toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</text>` : ""}`;
  }).join("");
  const table = `<table class="sr-only"><caption>Applications sent per week</caption><tr><th>Week of</th><th>Sent</th></tr>${data.map(week => `<tr><td>${esc(week.start.toDateString())}</td><td>${week.total}</td></tr>`).join("")}</table>`;
  return `
    <div class="chart">
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Applications sent per week for the last ${weeks} weeks">
        ${ticks.map(tick => `<line class="gridline" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis-label" x="${left - 8}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`).join("")}
        <line class="goal-line" x1="${left}" x2="${width - right}" y1="${y(goal)}" y2="${y(goal)}"></line>
        <text class="goal-label" x="${width - right}" y="${y(goal) - 6}" text-anchor="end">Goal ${goal}</text>
        ${bars}
      </svg>
      ${table}
    </div>`;
}

function viewInsights() {
  const list = state.applications;
  const head = viewHead({ eyebrow: "How your search is going", title: "Insights", sub: "Everything here is worked out from your own pages. Nothing leaves this device." });
  if (!list.length) {
    return `${head}<div class="card">${emptyState({ iconName: "insights", title: "No data yet", copy: "Add a few applications and your response rate, weekly rhythm, and best sources will appear here.", action: newButton() })}</div>`;
  }
  const stats = metrics(list);
  const kpis = [
    ["Pages", stats.total, "in your notebook"],
    ["Sent", stats.sent, "applications submitted"],
    ["Response rate", `${stats.responseRate}%`, "heard back of those sent"],
    ["Interview rate", `${stats.interviewRate}%`, "reached an interview"],
    ["Offers", stats.counts.OFFER, stats.counts.OFFER ? "congratulations!" : "keep going"]
  ];
  const funnelSteps = [
    ["Saved", list.length],
    ["Applied", stats.sent],
    ["Interview", list.filter(entry => reached(entry, "INTERVIEW")).length],
    ["Offer", list.filter(entry => reached(entry, "OFFER")).length]
  ];
  const funnel = funnelSteps.map(([label, count], index) => {
    const previous = index ? funnelSteps[index - 1][1] : 0;
    const rate = index && previous ? Math.round((count * 100) / previous) : null;
    const width = list.length ? Math.max(0.5, (count / list.length) * 100) : 0;
    return `<div class="funnel-row"><span>${label}</span><div class="funnel-track"><i class="funnel-bar" style="width:calc(${width}% - 60px)"></i><b class="funnel-value">${count}${rate !== null ? ` <small>${rate}%</small>` : ""}</b></div></div>`;
  }).join("");

  const sources = new Map();
  for (const entry of list) {
    const key = entry.source.trim() || "Not recorded";
    const row = sources.get(key.toLowerCase()) || { name: key, pages: 0, sent: 0, interviews: 0 };
    row.pages++;
    if (entry.status !== "SAVED") row.sent++;
    if (entry.status !== "SAVED" && reached(entry, "INTERVIEW")) row.interviews++;
    sources.set(key.toLowerCase(), row);
  }
  const sourceRows = [...sources.values()].sort((left, right) => right.sent - left.sent || right.pages - left.pages).slice(0, 8);

  const skillCounts = new Map();
  list.flatMap(entry => entry.skills).forEach(skill => skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1));
  const skills = [...skillCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 8);
  const topSkill = skills.length ? skills[0][1] : 1;

  return `${head}
    <section class="kpis">${kpis.map(([label, value, note]) => `<article class="card kpi"><p>${label}</p><strong>${value}</strong><span>${note}</span></article>`).join("")}</section>
    <div class="insight-grid">
      <section class="card"><div class="card-head"><div><h2 class="card-title">Weekly rhythm</h2><p class="card-note">Applications sent each week, with your goal line</p></div></div><div data-chart="weekly" style="min-height:200px"></div></section>
      <section class="card"><div class="card-head"><div><h2 class="card-title">Pipeline funnel</h2><p class="card-note">How many pages reached each stage, and the step-to-step rate</p></div></div><div class="funnel">${funnel}</div></section>
      <section class="card"><div class="card-head"><div><h2 class="card-title">Where your replies come from</h2><p class="card-note">Interview rate by where you found the role</p></div></div>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>Source</th><th class="num">Sent</th><th class="num">Interviews</th><th>Rate</th></tr></thead><tbody>
          ${sourceRows.map(row => {
            const rate = row.sent ? Math.round((row.interviews * 100) / row.sent) : 0;
            return `<tr><td>${esc(row.name)}</td><td class="num">${row.sent}</td><td class="num">${row.interviews}</td><td><span style="display:flex;align-items:center;gap:8px"><span class="meter" aria-hidden="true"><i style="width:${rate}%"></i></span>${row.sent ? `${rate}%` : "–"}</span></td></tr>`;
          }).join("")}
        </tbody></table></div></section>
      <section class="card"><div class="card-head"><div><h2 class="card-title">Skills employers ask for</h2><p class="card-note">Most common skill tags across your pages</p></div></div>
        ${skills.length ? `<div class="skill-bars">${skills.map(([skill, count]) => `<div class="skill-bar"><span>${esc(skill)}</span><i style="width:${(count / topSkill) * 100}%"></i><b>${count}</b></div>`).join("")}</div>`
          : `<p class="empty-note">Add skill tags to your pages to spot patterns across roles.</p>`}</section>
    </div>`;
}

function daysLeft(deletedAt) {
  const remaining = new Date(deletedAt).getTime() + RETENTION_MS - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return "Expires soon";
  const days = Math.ceil(remaining / DAY_MS);
  return days === 1 ? "1 day left" : `${days} days left`;
}

function viewDeleted() {
  const list = [...state.deleted].sort((left, right) => new Date(right.deletedAt) - new Date(left.deletedAt));
  state.visibleIds = list.map(entry => entry.id);
  const selecting = state.selecting && state.selectScope === "deleted";
  return `
    ${viewHead({ eyebrow: "A small safety net", title: "Recently Deleted", sub: "Pages you remove stay here for seven days. Restore them in that window, or delete them for good.", actions: list.length ? selectButton("deleted") : "" })}
    ${list.length ? `<div class="deleted-grid">${list.map((entry, index) => `
      <article class="deleted-card${state.selected.has(entry.id) ? " selected" : ""}" style="--i:${index}">
        ${selecting ? `<input type="checkbox" data-select="${entry.id}" ${state.selected.has(entry.id) ? "checked" : ""} aria-label="Select ${esc(entry.company)}" />` : ""}
        <p class="deleted-timer">${icon("clock")}${esc(daysLeft(entry.deletedAt))}</p>
        <h3>${esc(entry.company)}</h3>
        <p class="muted" style="font-size:.86rem">${esc([entry.role, entry.location].filter(Boolean).join(" · "))}</p>
        <div class="deleted-actions">
          <button class="button small" type="button" data-action="restore" data-id="${entry.id}">${icon("restore")}Restore</button>
          <button class="button small danger-soft" type="button" data-action="purge" data-id="${entry.id}">Delete</button>
        </div>
      </article>`).join("")}</div>`
      : `<div class="card">${emptyState({ iconName: "trash", title: "Nothing here", copy: "When you remove a page, you'll have seven days to bring it back." })}</div>`}`;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function installHelp() {
  if (isStandalone()) return `<p>You're using the installed app. It opens in its own window and works offline.</p>`;
  const agent = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(agent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safariMac = /Macintosh/.test(agent) && /Safari/.test(agent) && !/Chrome|Chromium|Edg|Firefox/.test(agent);
  if (state.installPrompt) return `<p>Install it to open the notebook from your dock or home screen, even offline.</p>`;
  if (iOS) return `<p>On iPhone or iPad:</p><ol class="install-steps"><li>Tap the Share button in Safari.</li><li>Choose <b>Add to Home Screen</b>.</li></ol>`;
  if (safariMac) return `<p>In Safari on a Mac, choose <b>File → Add to Dock</b>.</p>`;
  return `<p>In Chrome or Edge, use the install icon at the right of the address bar, or the browser menu's <b>Install</b> option. On Android, choose <b>Add to Home screen</b>.</p>`;
}

function viewSettings() {
  const themeButtons = [["system", "Match system"], ["light", "Light"], ["dark", "Dark"]]
    .map(([value, label]) => `<button type="button" data-action="set-theme" data-theme-value="${value}" aria-pressed="${state.prefs.theme === value}">${label}</button>`).join("");
  return `
    ${viewHead({ eyebrow: "Make it yours", title: "Settings" })}
    <div class="settings">
      <section class="card">
        <h2 class="card-title" style="margin-bottom:10px">Personal</h2>
        <div class="setting-row"><div><strong>Your first name</strong><p>Used only for the greeting on Today. Stored on this device.</p></div>
          <input type="text" data-input="name" maxlength="40" value="${esc(state.prefs.name)}" placeholder="Optional" autocomplete="given-name" /></div>
        <div class="setting-row"><div><strong>Weekly goal</strong><p>How many applications you aim to send each week.</p></div>
          <div class="goal-stepper"><button type="button" data-action="goal" data-delta="-1" aria-label="Lower weekly goal">−</button><output>${state.prefs.goal}</output><button type="button" data-action="goal" data-delta="1" aria-label="Raise weekly goal">+</button></div></div>
        <div class="setting-row"><div><strong>Appearance</strong><p>Light paper, a dark night notebook, or follow your device.</p></div>
          <div class="segmented" role="group" aria-label="Theme">${themeButtons}</div></div>
      </section>

      <section class="card">
        <h2 class="card-title" style="margin-bottom:10px">Install the app</h2>
        <div class="setting-row"><div>${installHelp()}</div>
          ${state.installPrompt && !isStandalone() ? `<button class="button primary" type="button" data-action="install">${icon("install")}Install app</button>` : ""}</div>
      </section>

      <section class="card">
        <h2 class="card-title" style="margin-bottom:10px">Your data</h2>
        <div class="setting-row"><div><strong>${BROWSER_MODE ? "Private to this browser" : "Saved on this computer"}</strong>
          <p>${BROWSER_MODE
            ? "Pages are stored in this browser on this device. Nothing is uploaded. They don't sync between devices, so use a backup file to move your notebook to another phone or laptop."
            : "The Java server saves pages to data/applications.tsv in the project folder."}</p></div></div>
        <div class="setting-row"><div><strong>Backup</strong><p>A single file with every page, including notes and history.</p></div>
          <div class="view-actions">
            <button class="button" type="button" data-action="export-json">${icon("download")}Download backup</button>
            <button class="button ghost" type="button" data-action="import-json">${icon("upload")}Import backup</button>
          </div></div>
        <div class="setting-row"><div><strong>Spreadsheet</strong><p>Export a CSV you can open in Excel, Numbers, or Google Sheets.</p></div>
          <button class="button ghost" type="button" data-action="export-csv">${icon("file")}Export CSV</button></div>
      </section>

      <section class="card">
        <h2 class="card-title" style="margin-bottom:12px">Keyboard shortcuts</h2>
        <ul class="shortcut-list">
          <li><kbd>N</kbd></li><li>New application</li>
          <li><kbd>/</kbd> or <kbd>⌘K</kbd></li><li>Search everything</li>
          <li><kbd>1</kbd> – <kbd>4</kbd></li><li>Today, Board, All pages, Insights</li>
          <li><kbd>Esc</kbd></li><li>Close a dialog or stop selecting</li>
        </ul>
      </section>

      <p class="muted" style="font-size:.82rem">My Internship Notebook · <a href="https://github.com/will-iam08/coop-compass" target="_blank" rel="noopener">Source on GitHub</a></p>
    </div>`;
}

function viewEntry(id) {
  const entry = find(id);
  if (!entry) {
    const deleted = findDeleted(id);
    return `<div class="entry"><div class="card not-found">${deleted
      ? emptyState({ iconName: "trash", title: "This page is in Recently Deleted", copy: `${esc(deleted.company)} can be restored for ${esc(daysLeft(deleted.deletedAt).replace(" left", ""))}.`, action: `<button class="button primary" type="button" data-action="restore" data-id="${deleted.id}">${icon("restore")}Restore page</button>` })
      : emptyState({ iconName: "notebook", title: "Page not found", copy: "It may have been deleted permanently.", action: `<a class="button" href="#/notebook">Back to all pages</a>` })}</div></div>`;
  }
  const backLabel = { "#/board": "Board", "#/notebook": "All pages", "#/today": "Today", "#/insights": "Insights" }[state.backRoute] || "Back";
  const pipelineIndex = PIPELINE.indexOf(entry.status);
  const beforeRejection = [...entry.history].reverse().find(change => change.status !== "REJECTED")?.status || "APPLIED";
  const steps = PIPELINE.map((stage, index) => {
    const done = entry.status !== "REJECTED" && index < pipelineIndex;
    const current = entry.status === stage;
    return `<button class="step st-${stage}${done ? " done" : ""}${current ? " current" : ""}" type="button" data-action="set-status" data-stage="${stage}" aria-pressed="${current}">${done ? icon("check") : ""}<span>${LABELS[stage]}</span></button>`;
  }).join("");
  const field = (name, label, iconName, { type = "text", placeholder = "", extra = "", size = "" } = {}) => `
    <label class="line-field ${size}${name === "link" && entry.link ? " has-link" : ""}"><span>${icon(iconName)}${label}</span>
      <input type="${type}" data-field="${name}" value="${esc(entry[name])}" maxlength="${LIMITS[name] || ""}" placeholder="${esc(placeholder)}" ${extra} />
      ${name === "link" && entry.link ? `<a class="icon-button open-link" href="${esc(entry.link)}" target="_blank" rel="noopener noreferrer" aria-label="Open job posting">${icon("external")}</a>` : ""}
    </label>`;
  const timeline = [...entry.history].reverse().map((change, index, list) => {
    const first = index === list.length - 1;
    return `<li class="st-${change.status}"><strong>${first ? `Added as ${LABELS[change.status]}` : `Moved to ${LABELS[change.status]}`}</strong><span>${esc(formatDateTime(change.at))}</span></li>`;
  }).join("");
  return `
    <article class="entry" data-entry="${entry.id}">
      <nav class="entry-nav" aria-label="Page actions">
        <a class="back" href="${state.backRoute}">${icon("back")}${backLabel}</a>
        <span class="save-state" id="save-state" aria-live="polite">${icon("check")}Saved</span>
        <div class="entry-actions">
          <button class="icon-button star${entry.starred ? " on" : ""}" type="button" data-action="toggle-star" data-id="${entry.id}" aria-pressed="${entry.starred}" aria-label="${entry.starred ? "Unstar" : "Star"} this page" title="Star">${icon("star")}</button>
          <button class="icon-button" type="button" data-action="entry-menu" data-id="${entry.id}" aria-label="More actions" title="More">${icon("more")}</button>
        </div>
      </nav>
      <div class="sheet-page">
        <header class="entry-head">
          <label class="sr-only" for="entry-company">Company</label>
          <input class="entry-company" id="entry-company" data-field="company" value="${esc(entry.company)}" maxlength="${LIMITS.company}" required />
          <label class="sr-only" for="entry-role">Role</label>
          <input class="entry-role" id="entry-role" data-field="role" value="${esc(entry.role)}" maxlength="${LIMITS.role}" required />
        </header>
        <div class="stepper" role="group" aria-label="Stage">
          <div class="steps">${steps}</div>
          <button class="button small ghost reject-toggle" type="button" data-action="set-status" data-stage="${entry.status === "REJECTED" ? beforeRejection : "REJECTED"}" aria-pressed="${entry.status === "REJECTED"}">${entry.status === "REJECTED" ? "Rejected · undo" : "Mark rejected"}</button>
        </div>
        <div class="details">
          ${field("location", "Location", "pin", { placeholder: "City or Remote" })}
          ${field("source", "Found on", "globe", { placeholder: "LinkedIn, referral…", extra: 'list="source-options"' })}
          ${field("deadline", "Deadline", "clock", { type: "date" })}
          ${field("link", "Job posting", "link", { type: "url", placeholder: "Paste the link", extra: 'inputmode="url"', size: "wide" })}
          ${field("contact", "Contact", "user", { placeholder: "Recruiter, referral…" })}
          ${field("nextStep", "Next step", "flag", { placeholder: "e.g. Technical interview", size: "wide-lg" })}
          ${field("nextStepDate", "Next step date", "calendar", { type: "date" })}
        </div>
        <p class="section-label">Skills</p>
        <div class="skills-editor" id="skills-editor">
          ${entry.skills.map(skill => `<span class="skill-chip">${esc(skill)}<button type="button" data-action="remove-skill" data-skill="${esc(skill)}" aria-label="Remove ${esc(skill)}">${icon("x")}</button></span>`).join("")}
          <input type="text" id="skill-input" placeholder="${entry.skills.length ? "Add another…" : "Add skills, press Enter"}" aria-label="Add a skill" maxlength="40" />
        </div>
        <div class="entry-grid">
          <section>
            <p class="section-label"><label for="entry-notes">Notes</label></p>
            <textarea class="notes-area" id="entry-notes" data-field="notes" maxlength="${LIMITS.notes}" placeholder="Interview prep, questions to ask, people you met, how it went…">${esc(entry.notes)}</textarea>
          </section>
          <section>
            <p class="section-label">Timeline</p>
            <ol class="timeline">${timeline}</ol>
          </section>
        </div>
        <footer class="entry-foot">
          <span>Created ${esc(formatDateTime(entry.createdAt))} · Edited <span data-edited>${esc(timeAgo(entry.updatedAt))}</span></span>
          <button class="button small danger-soft" type="button" data-action="delete" data-id="${entry.id}">${icon("trash")}Move to Recently Deleted</button>
        </footer>
      </div>
    </article>`;
}

/* ==========================================================================
   11. Router and rendering
   ========================================================================== */
const viewRoot = $("#view");
const page = $("#page");
const renderers = { today: viewToday, board: viewBoard, notebook: viewNotebook, insights: viewInsights, deleted: viewDeleted, settings: viewSettings };

function parseRoute() {
  const [view, id] = window.location.hash.replace(/^#\/?/, "").split("/");
  if (view === "entry" && Number(id) > 0) return { view: "entry", id: Number(id) };
  return { view: renderers[view] ? view : "today", id: null };
}

function render({ animate = false, keepScroll = true } = {}) {
  const { view, id } = state.route;
  const scrollTop = page.scrollTop;
  const windowScroll = window.scrollY;
  if (!state.loaded) {
    viewRoot.innerHTML = state.loadError
      ? `<div class="card" style="margin-top:24px">${emptyState({ iconName: "alert", title: "The notebook server isn't answering", copy: `${esc(state.loadError)} Start it with the command in the README, then try again.`, action: `<button class="button primary" type="button" data-action="reload">Try again</button>` })}</div>`
      : `<p class="empty-note" style="padding:40px 0">Opening your notebook…</p>`;
    return;
  }
  viewRoot.classList.toggle("animate", animate);
  viewRoot.innerHTML = view === "entry" ? viewEntry(id) : renderers[view]();
  const entry = view === "entry" ? find(id) : null;
  const title = entry ? `${entry.company}` : VIEWS[view].title;
  document.title = `${title} · My Internship Notebook`;
  $("#mobile-title").textContent = title;
  const navKey = view === "entry" ? "" : view;
  $$("[data-nav]").forEach(link => {
    if (link.dataset.nav === navKey) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.documentElement.style.setProperty("--tab", `var(${VIEWS[view].tab})`);
  viewRoot.style.setProperty("--tab", `var(${VIEWS[view].tab})`);
  updateCounts();
  renderSelectionBar();
  if (view === "entry") setupEntry();
  drawCharts();
  if (keepScroll) { page.scrollTop = scrollTop; window.scrollTo(0, windowScroll); }
}

function rerender() { render({ animate: false, keepScroll: true }); }

function drawCharts() {
  $$('[data-chart="weekly"]').forEach(element => { element.innerHTML = weeklyChart(element.clientWidth); });
}
window.addEventListener("resize", debounce(() => { if (state.route.view === "insights") drawCharts(); }, 150));

async function navigate() {
  await flushEntrySave();
  const previous = state.route;
  state.route = parseRoute();
  if (previous.view !== state.route.view) endSelection(false);
  if (state.route.view === "entry" && previous.view !== "entry") {
    state.backRoute = `#/${previous.view === "entry" ? "board" : previous.view}`;
  }
  closeMenu();
  render({ animate: true, keepScroll: false });
  page.scrollTop = 0;
  window.scrollTo(0, 0);
  viewRoot.focus({ preventScroll: true });
}

function go(hash) {
  if (window.location.hash === hash) navigate();
  else window.location.hash = hash;
}

function updateCounts() {
  const stats = metrics();
  const values = { active: stats.open, total: stats.total, deleted: state.deleted.length };
  $$("[data-count]").forEach(element => { element.textContent = values[element.dataset.count] || ""; });
}

/* ==========================================================================
   12. Toasts, confirm dialog, popover menu
   ========================================================================== */
const toasts = $("#toasts");
function toast(message, { action, run, error = false, duration = 5200 } = {}) {
  const element = document.createElement("div");
  element.className = `toast${error ? " error" : ""}`;
  element.innerHTML = `<span>${esc(message)}</span>`;
  const dismiss = () => {
    if (!element.isConnected) return;
    element.classList.add("leaving");
    window.setTimeout(() => element.remove(), 240);
  };
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action;
    button.addEventListener("click", () => { dismiss(); run?.(); });
    element.append(button);
  }
  toasts.append(element);
  while (toasts.children.length > 3) toasts.firstElementChild.remove();
  window.setTimeout(dismiss, error ? 7000 : duration);
}
const fail = error => toast(error?.message || "Something went wrong.", { error: true });

const confirmElement = $("#confirm-dialog");
let confirmResolve = null;
function confirmDialog({ eyebrow = "A small safety net", title, copy, yes = "Continue", no = "Keep it", iconName = "trash", danger = true }) {
  $("#confirm-eyebrow").textContent = eyebrow;
  $("#confirm-title").textContent = title;
  $("#confirm-copy").textContent = copy;
  $("#confirm-yes").textContent = yes;
  $("#confirm-yes").className = `button ${danger ? "danger" : "primary"}`;
  $("#confirm-no").textContent = no;
  $("#confirm-mark").innerHTML = icon(iconName);
  confirmElement.showModal();
  $("#confirm-no").focus();
  return new Promise(resolve => { confirmResolve = resolve; });
}
function closeConfirm(result) {
  if (!confirmElement.open) return;
  confirmElement.close();
  confirmResolve?.(result);
  confirmResolve = null;
}
confirmElement.addEventListener("click", event => {
  if (event.target === confirmElement) closeConfirm(false);
  const choice = event.target.closest("[data-confirm]");
  if (choice) closeConfirm(choice.dataset.confirm === "yes");
});
confirmElement.addEventListener("cancel", event => { event.preventDefault(); closeConfirm(false); });

const menu = $("#menu");
let menuItems = [];
let menuAnchor = null;
function openMenu(anchor, items) {
  if (!menu.hidden && menuAnchor === anchor) { closeMenu(); return; }
  menuItems = items;
  menuAnchor = anchor;
  menu.innerHTML = items.map((item, index) => {
    if (item.separator) return "<hr />";
    if (item.header) return `<p class="menu-label">${esc(item.header)}</p>`;
    return `<button type="button" role="menuitem" data-menu-index="${index}" class="${item.danger ? "danger" : ""} ${item.stage ? `st-${item.stage}` : ""}" ${item.checked ? 'aria-checked="true"' : ""}>
      ${item.stage ? '<i class="menu-dot"></i>' : icon(item.icon || "forward")}<span>${esc(item.label)}</span></button>`;
  }).join("");
  menu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const top = rect.bottom + 6 + menuRect.height > window.innerHeight - 8 ? Math.max(8, rect.top - menuRect.height - 6) : rect.bottom + 6;
  const left = clamp(rect.right - menuRect.width, 8, window.innerWidth - menuRect.width - 8);
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.querySelector("button")?.focus({ preventScroll: true });
}
function closeMenu() {
  if (menu.hidden) return;
  menu.hidden = true;
  menuAnchor = null;
}
menu.addEventListener("click", event => {
  const button = event.target.closest("[data-menu-index]");
  if (!button) return;
  const item = menuItems[Number(button.dataset.menuIndex)];
  const anchor = menuAnchor;
  closeMenu();
  anchor?.focus?.({ preventScroll: true });
  item?.run?.();
});
menu.addEventListener("keydown", event => {
  const buttons = $$("button", menu);
  const index = buttons.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  if (event.key === "Escape") { const anchor = menuAnchor; closeMenu(); anchor?.focus(); }
  if (event.key === "Tab") closeMenu();
});
document.addEventListener("pointerdown", event => {
  if (!menu.hidden && !menu.contains(event.target) && !menuAnchor?.contains(event.target)) closeMenu();
});
window.addEventListener("resize", closeMenu);

function cardMenu(anchor, entry) {
  openMenu(anchor, [
    { label: "Open page", icon: "notebook", run: () => go(`#/entry/${entry.id}`) },
    { separator: true },
    { header: "Move to" },
    ...STAGES.map(stage => ({ label: LABELS[stage], stage, checked: entry.status === stage, run: () => entry.status !== stage && changeStatus([entry.id], stage) })),
    { separator: true },
    { label: entry.starred ? "Remove star" : "Star", icon: "star", run: () => toggleStar(entry.id) },
    ...(entry.link ? [{ label: "Open job posting", icon: "external", run: () => window.open(entry.link, "_blank", "noopener") }] : []),
    { label: "Move to Recently Deleted", icon: "trash", danger: true, run: () => removeApplications([entry.id]) }
  ]);
}

/* ==========================================================================
   13. Actions (every change goes through the api, then updates local state)
   ========================================================================== */
async function changeStatus(ids, stage, { undoable = true } = {}) {
  const previous = ids.map(id => [id, find(id)?.status]);
  try {
    const updated = await api.setStatus(ids, stage);
    replaceApplications(updated);
    rerender();
    const subject = ids.length === 1 ? find(ids[0])?.company || "Application" : plural(ids.length, "application");
    toast(`${subject} moved to ${LABELS[stage]}`, undoable ? { action: "Undo", run: () => undoStatus(previous) } : {});
  } catch (error) { fail(error); }
}

async function undoStatus(previous) {
  try {
    const groups = new Map();
    previous.forEach(([id, stage]) => { if (stage && find(id)) groups.set(stage, [...(groups.get(stage) || []), id]); });
    for (const [stage, ids] of groups) replaceApplications(await api.setStatus(ids, stage));
    rerender();
    toast("Change undone");
  } catch (error) { fail(error); }
}

async function toggleStar(id) {
  await flushEntrySave();
  const entry = find(id);
  if (!entry) return;
  try {
    replaceApplications([await api.update(id, { starred: !entry.starred })]);
    rerender();
  } catch (error) { fail(error); }
}

async function removeApplications(ids, { confirmFirst = ids.length > 1 } = {}) {
  const entries = ids.map(find).filter(Boolean);
  if (!entries.length) return;
  if (confirmFirst) {
    const ok = await confirmDialog({
      title: entries.length === 1 ? "Move this to Recently Deleted?" : `Move ${entries.length} applications to Recently Deleted?`,
      copy: "They stay recoverable in Recently Deleted for seven days.",
      yes: entries.length === 1 ? "Move it" : "Move them"
    });
    if (!ok) return;
  }
  try {
    if (state.route.view === "entry" && ids.includes(state.route.id)) { entrySave.cancel(); pendingChanges = {}; }
    const removed = await api.remove(ids);
    state.applications = state.applications.filter(entry => !ids.includes(entry.id));
    state.deleted.push(...removed);
    ids.forEach(id => state.selected.delete(id));
    if (state.route.view === "entry" && ids.includes(state.route.id)) go(state.backRoute);
    else rerender();
    toast(entries.length === 1 ? `${entries[0].company} moved to Recently Deleted` : `${plural(entries.length, "application")} moved to Recently Deleted`,
      { action: "Undo", run: () => restoreApplications(ids, { quiet: true }) });
  } catch (error) { fail(error); }
}

async function restoreApplications(ids, { quiet = false } = {}) {
  try {
    const restored = await api.restore(ids);
    state.deleted = state.deleted.filter(entry => !ids.includes(entry.id));
    state.applications.push(...restored);
    ids.forEach(id => state.selected.delete(id));
    if (state.route.view === "deleted" && !state.deleted.length) endSelection(false);
    rerender();
    toast(quiet ? "Restored" : restored.length === 1 ? `${restored[0].company} is back in your notebook` : `${plural(restored.length, "application")} restored`,
      !quiet && restored.length === 1 ? { action: "Open", run: () => go(`#/entry/${restored[0].id}`) } : {});
  } catch (error) { fail(error); }
}

async function purgeApplications(ids) {
  const entries = ids.map(findDeleted).filter(Boolean);
  if (!entries.length) return;
  const ok = await confirmDialog({
    eyebrow: "This can't be undone",
    title: entries.length === 1 ? `Delete ${entries[0].company} permanently?` : `Delete ${entries.length} applications permanently?`,
    copy: entries.length === 1 ? "This page will be removed right away and cannot be restored." : "These pages will be removed right away and cannot be restored.",
    yes: "Delete permanently",
    iconName: "alert"
  });
  if (!ok) return;
  try {
    await api.purge(ids);
    state.deleted = state.deleted.filter(entry => !ids.includes(entry.id));
    ids.forEach(id => state.selected.delete(id));
    if (!state.deleted.length) endSelection(false);
    rerender();
    toast(entries.length === 1 ? "Deleted permanently" : `${plural(entries.length, "application")} deleted permanently`);
  } catch (error) { fail(error); }
}

async function createApplication(fields) {
  const created = await api.create(fields);
  state.applications.push(created);
  if (state.route.view !== "entry") rerender();
  else updateCounts();
  toast(`${created.company} added to your notebook`, { action: "Open page", run: () => go(`#/entry/${created.id}`) });
  return created;
}

/* ==========================================================================
   14. Selection mode (batch actions)
   ========================================================================== */
const selectionBar = $("#selection-bar");
function startSelection(scope) {
  if (state.selecting && state.selectScope === scope) { endSelection(); return; }
  state.selecting = true;
  state.selectScope = scope;
  state.selected.clear();
  rerender();
}
function endSelection(shouldRender = true) {
  if (!state.selecting) return;
  state.selecting = false;
  state.selectScope = "";
  state.selected.clear();
  if (shouldRender) rerender();
  else renderSelectionBar();
}
function renderSelectionBar() {
  const active = state.selecting && state.route.view !== "entry";
  selectionBar.hidden = !active;
  document.body.classList.toggle("selecting", active);
  if (!active) return;
  const count = state.selected.size;
  const allSelected = state.visibleIds.length > 0 && state.visibleIds.every(id => state.selected.has(id));
  const disabled = count ? "" : "disabled";
  const actions = state.selectScope === "deleted"
    ? `<button class="button primary small" type="button" data-action="batch-restore" ${disabled}>${icon("restore")}Restore</button>
       <button class="button danger-soft small" type="button" data-action="batch-purge" ${disabled}>Delete<span class="hide-sm">&nbsp;permanently</span></button>`
    : `<label class="move-label"><span class="sr-only">Move selected to</span><select id="batch-status" aria-label="Move selected to" ${disabled}>${STAGES.map(stage => `<option value="${stage}">${LABELS[stage]}</option>`).join("")}</select></label>
       <button class="button primary small" type="button" data-action="batch-move" ${disabled}>Move</button>
       <button class="button danger-soft small" type="button" data-action="batch-delete" ${disabled} aria-label="Move selected to Recently Deleted">${icon("trash")}<span class="hide-sm">Delete</span></button>`;
  selectionBar.innerHTML = `
    <p><strong>${count} selected</strong></p>
    <div class="selection-bar-actions">
      <button class="text-button" type="button" data-action="select-all">${allSelected ? "Clear" : "Select all"}</button>
      ${actions}
      <button class="icon-button" type="button" data-action="end-select" aria-label="Done selecting" title="Done">${icon("x")}</button>
    </div>`;
}
function toggleSelected(id, checked) {
  if (checked) state.selected.add(id);
  else state.selected.delete(id);
  $$(`[data-select="${id}"]`).forEach(input => {
    input.checked = checked;
    input.closest(".app-card, .toc-row, .deleted-card")?.classList.toggle("selected", checked);
  });
  renderSelectionBar();
}

/* ==========================================================================
   15. New application sheet
   ========================================================================== */
const newDialog = $("#new-dialog");
const newForm = $("#new-form");
let newStage = "SAVED";
function renderStagePicker() {
  $("#new-stage").innerHTML = STAGES.map(stage => `<button class="stage-option st-${stage}" type="button" role="radio" aria-checked="${stage === newStage}" data-action="pick-stage" data-stage="${stage}">${LABELS[stage]}</button>`).join("");
  $("#new-stage").setAttribute("role", "radiogroup");
  $("#new-stage").setAttribute("aria-label", "Stage");
}
function updateSourceOptions() {
  const used = [...new Set(state.applications.map(entry => entry.source.trim()).filter(Boolean))];
  const options = [...used, ...SOURCE_SUGGESTIONS.filter(source => !used.some(item => item.toLowerCase() === source.toLowerCase()))];
  $("#source-options").innerHTML = options.map(source => `<option value="${esc(source)}"></option>`).join("");
}
function openNew(stage = "SAVED") {
  closeMenu();
  if ($("#palette").open) $("#palette").close();
  newForm.reset();
  newStage = STAGES.includes(stage) ? stage : "SAVED";
  renderStagePicker();
  updateSourceOptions();
  $("#new-error").hidden = true;
  newDialog.showModal();
  newForm.elements.company.focus();
}
newForm.addEventListener("submit", async event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(newForm).entries());
  fields.status = newStage;
  const submit = newForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await createApplication(fields);
    newDialog.close();
  } catch (error) {
    $("#new-error").textContent = error.message;
    $("#new-error").hidden = false;
    (error.message.startsWith("Company") ? newForm.elements.company : error.message.startsWith("Role") ? newForm.elements.role : null)?.focus();
  } finally {
    submit.disabled = false;
  }
});
newDialog.addEventListener("click", event => {
  if (event.target === newDialog) newDialog.close();
  if (event.target.closest('[data-action="close-new"]')) newDialog.close();
  const option = event.target.closest('[data-action="pick-stage"]');
  if (option) { newStage = option.dataset.stage; renderStagePicker(); $(`[data-stage="${newStage}"]`, $("#new-stage")).focus(); }
});

/* ==========================================================================
   16. Search palette (⌘K)
   ========================================================================== */
const palette = $("#palette");
const paletteInput = $("#palette-input");
const paletteResults = $("#palette-results");
let paletteEntries = [];
let paletteIndex = 0;
function paletteCommands() {
  return [
    { label: "New application", hint: "N", icon: "plus", run: () => openNew() },
    { label: "Go to Today", icon: "today", run: () => go("#/today") },
    { label: "Go to Board", icon: "board", run: () => go("#/board") },
    { label: "Go to All pages", icon: "notebook", run: () => go("#/notebook") },
    { label: "Go to Insights", icon: "insights", run: () => go("#/insights") },
    { label: "Go to Recently Deleted", icon: "trash", run: () => go("#/deleted") },
    { label: "Open Settings", icon: "settings", run: () => go("#/settings") },
    { label: `Switch to ${resolvedTheme() === "dark" ? "light" : "dark"} theme`, icon: resolvedTheme() === "dark" ? "sun" : "moon", run: () => setTheme(resolvedTheme() === "dark" ? "light" : "dark") },
    { label: "Export CSV", icon: "file", run: exportCsv },
    { label: "Download backup", icon: "download", run: exportJson },
    ...(state.installPrompt ? [{ label: "Install app", icon: "install", run: promptInstall }] : [])
  ];
}
function renderPalette() {
  const query = paletteInput.value.trim().toLowerCase();
  const pages = state.applications
    .map(entry => {
      const company = entry.company.toLowerCase();
      const role = entry.role.toLowerCase();
      let score = 0;
      if (!query) score = 1;
      else if (company.startsWith(query)) score = 4;
      else if (company.includes(query) || role.includes(query)) score = 3;
      else if (matchesQuery(entry, query)) score = 1;
      return { entry, score };
    })
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || right.entry.updatedAt.localeCompare(left.entry.updatedAt))
    .slice(0, query ? 8 : 5)
    .map(({ entry }) => ({ label: entry.company, sub: `${entry.role} · ${LABELS[entry.status]}`, icon: "notebook", run: () => go(`#/entry/${entry.id}`) }));
  const commands = paletteCommands().filter(command => !query || command.label.toLowerCase().includes(query));
  paletteEntries = [...pages, ...commands];
  paletteIndex = clamp(paletteIndex, 0, Math.max(0, paletteEntries.length - 1));
  const item = (entry, index) => `<li class="palette-item" role="option" id="palette-option-${index}" data-palette-index="${index}" aria-selected="${index === paletteIndex}">
      ${icon(entry.icon)}<div><strong>${esc(entry.label)}</strong>${entry.sub ? `<span>${esc(entry.sub)}</span>` : ""}</div>${entry.hint ? `<kbd>${entry.hint}</kbd>` : ""}</li>`;
  paletteResults.innerHTML = paletteEntries.length
    ? `${pages.length ? `<li class="palette-group" role="presentation">${query ? "Pages" : "Recent pages"}</li>${pages.map(item).join("")}` : ""}
       ${commands.length ? `<li class="palette-group" role="presentation">Actions</li>${commands.map((entry, index) => item(entry, index + pages.length)).join("")}` : ""}`
    : `<li class="palette-empty">No pages or actions match “${esc(paletteInput.value)}”.</li>`;
  paletteInput.setAttribute("aria-activedescendant", paletteEntries.length ? `palette-option-${paletteIndex}` : "");
  $(`#palette-option-${paletteIndex}`)?.scrollIntoView({ block: "nearest" });
}
function openPalette() {
  closeMenu();
  paletteInput.value = "";
  paletteIndex = 0;
  renderPalette();
  palette.showModal();
  paletteInput.focus();
}
function runPalette(index) {
  const entry = paletteEntries[index];
  if (!entry) return;
  palette.close();
  entry.run();
}
paletteInput.addEventListener("input", () => { paletteIndex = 0; renderPalette(); });
paletteInput.addEventListener("keydown", event => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const count = paletteEntries.length || 1;
    paletteIndex = (paletteIndex + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
    renderPalette();
  }
  if (event.key === "Enter") { event.preventDefault(); runPalette(paletteIndex); }
  // A search field would only clear itself on Escape; close the whole palette instead.
  if (event.key === "Escape") { event.preventDefault(); paletteInput.blur(); palette.close(); }
});
paletteResults.addEventListener("click", event => {
  const option = event.target.closest("[data-palette-index]");
  if (option) runPalette(Number(option.dataset.paletteIndex));
});
palette.addEventListener("click", event => { if (event.target === palette) palette.close(); });
// When a dialog closes, don't leave keyboard focus stranded inside it (shortcuts would think you're typing).
$$("dialog").forEach(dialog => dialog.addEventListener("close", () => {
  if (dialog.contains(document.activeElement)) document.activeElement.blur();
}));

/* ==========================================================================
   17. Notebook page editing (autosave)
   ========================================================================== */
let pendingChanges = {};
let saveChain = Promise.resolve();

function setSaveState(mode, message = "") {
  const element = $("#save-state");
  if (!element) return;
  element.className = `save-state ${mode}`;
  element.innerHTML = mode === "saving" ? `${icon("clock")}Saving…`
    : mode === "error" ? `${icon("alert")}${esc(message || "Not saved")}`
    : `${icon("check")}Saved`;
}

function flushEntrySave() {
  entrySave.cancel();
  const id = state.route.id;
  const changes = pendingChanges;
  pendingChanges = {};
  if (!Object.keys(changes).length || !id) return saveChain;
  saveChain = saveChain.then(async () => {
    if (!find(id)) return;
    try {
      const updated = await api.update(id, changes);
      replaceApplications([updated]);
      updateCounts();
      if (state.route.view === "entry" && state.route.id === id) {
        setSaveState("saved");
        const edited = $("[data-edited]");
        if (edited) edited.textContent = timeAgo(updated.updatedAt);
        if ("link" in changes) refreshLinkButton(updated);
        if ("company" in changes) { $("#mobile-title").textContent = updated.company; document.title = `${updated.company} · My Internship Notebook`; }
      }
    } catch (error) {
      setSaveState("error", error.message);
      toast(error.message, { error: true });
    }
  });
  return saveChain;
}
const entrySave = debounce(flushEntrySave, 650);

function queueChange(field, value, { immediate = false } = {}) {
  if ((field === "company" || field === "role") && !String(value).trim()) {
    setSaveState("error", `${field === "company" ? "Company" : "Role"} can't be empty`);
    delete pendingChanges[field];
    return;
  }
  pendingChanges[field] = value;
  setSaveState("saving");
  if (immediate) flushEntrySave();
  else entrySave();
}

function refreshLinkButton(entry) {
  const input = $('[data-field="link"]');
  if (!input) return;
  if (input !== document.activeElement) input.value = entry.link;
  const label = input.closest(".line-field");
  label.classList.toggle("has-link", Boolean(entry.link));
  label.querySelector(".open-link")?.remove();
  if (entry.link) label.insertAdjacentHTML("beforeend", `<a class="icon-button open-link" href="${esc(entry.link)}" target="_blank" rel="noopener noreferrer" aria-label="Open job posting">${icon("external")}</a>`);
}

function autosize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight + 2}px`;
}

function setupEntry() {
  const notes = $("#entry-notes");
  if (notes) autosize(notes);
}

/** Skill edits run in order on the save queue, each one starting from the latest saved list. */
function saveSkills(update) {
  const id = state.route.id;
  flushEntrySave();
  saveChain = saveChain.then(async () => {
    const entry = find(id);
    if (!entry) return;
    try {
      replaceApplications([await api.update(id, { skills: cleanSkills(update(entry.skills)) })]);
      if (state.route.view === "entry" && state.route.id === id) { setSaveState("saved"); renderSkillChips(); }
    } catch (error) { fail(error); }
  });
  return saveChain;
}

function renderSkillChips() {
  const entry = find(state.route.id);
  const editor = $("#skills-editor");
  if (!entry || !editor) return;
  const input = $("#skill-input");
  const value = input.value;
  editor.querySelectorAll(".skill-chip").forEach(chip => chip.remove());
  input.insertAdjacentHTML("beforebegin", entry.skills.map(skill => `<span class="skill-chip">${esc(skill)}<button type="button" data-action="remove-skill" data-skill="${esc(skill)}" aria-label="Remove ${esc(skill)}">${icon("x")}</button></span>`).join(""));
  input.value = value;
  input.placeholder = entry.skills.length ? "Add another…" : "Add skills, press Enter";
}

viewRoot.addEventListener("input", event => {
  const target = event.target;
  if (target.dataset.field && state.route.view === "entry") {
    if (target.tagName === "TEXTAREA") autosize(target);
    if (target.type !== "date") queueChange(target.dataset.field, target.value);
    return;
  }
  const input = target.dataset.input;
  if (input === "board-query") { state.boardQuery = target.value; refreshList(target); }
  if (input === "notebook-query") { state.filter.query = target.value; refreshList(target); }
  if (input === "name") { state.prefs.name = target.value.slice(0, 40); savePrefs(); }
});

/** Re-renders a list view while keeping the search box focused. */
function refreshList(input) {
  const selector = `[data-input="${input.dataset.input}"]`;
  const { selectionStart, selectionEnd } = input;
  rerender();
  const next = $(selector);
  if (next) { next.focus(); next.setSelectionRange(selectionStart, selectionEnd); }
}

viewRoot.addEventListener("change", event => {
  const target = event.target;
  if (target.dataset.field && state.route.view === "entry") {
    const entry = find(state.route.id);
    if ((target.dataset.field === "company" || target.dataset.field === "role") && !target.value.trim() && entry) {
      target.value = entry[target.dataset.field];
      setSaveState("saved");
      return;
    }
    queueChange(target.dataset.field, target.value, { immediate: true });
    return;
  }
  if (target.dataset.select) { toggleSelected(Number(target.dataset.select), target.checked); return; }
  if (target.dataset.input === "sort") { state.prefs.sort = target.value; savePrefs(); rerender(); }
});

viewRoot.addEventListener("keydown", event => {
  const target = event.target;
  if (target.id === "skill-input") {
    const entry = find(state.route.id);
    if (!entry) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      const value = target.value.trim();
      if (!value) return;
      target.value = "";
      saveSkills(skills => [...skills, ...value.split(",")]);
    } else if (event.key === "Backspace" && !target.value && entry.skills.length) {
      saveSkills(skills => skills.slice(0, -1));
    }
    return;
  }
  if (target.matches?.(".entry-company, .entry-role") && event.key === "Enter") { event.preventDefault(); target.blur(); return; }
  if ((event.key === "Enter" || event.key === " ") && target.matches?.("[data-open]") && !event.target.closest("button, input, a")) {
    event.preventDefault();
    go(`#/entry/${target.dataset.open}`);
  }
});

viewRoot.addEventListener("focusout", event => {
  if (event.target.id === "skill-input" && event.target.value.trim()) {
    const value = event.target.value;
    event.target.value = "";
    saveSkills(skills => [...skills, ...value.split(",")]);
  }
});

/* ==========================================================================
   18. Click handling (one delegated listener for the whole app)
   ========================================================================== */
const endSelectionIfEmpty = () => { if (state.selecting && !state.selected.size) endSelection(); };
const actions = {
  new: target => openNew(target.dataset.stage),
  palette: () => openPalette(),
  "cycle-theme": () => {
    const order = ["system", "light", "dark"];
    setTheme(order[(order.indexOf(state.prefs.theme) + 1) % order.length]);
    toast(`Theme: ${themeLabel()}`);
  },
  "set-theme": target => setTheme(target.dataset.themeValue),
  goal: target => {
    state.prefs.goal = clamp(state.prefs.goal + Number(target.dataset.delta), 1, 50);
    savePrefs();
    rerender();
  },
  "card-menu": target => { const entry = find(Number(target.dataset.id)); if (entry) cardMenu(target, entry); },
  "entry-menu": target => {
    const entry = find(Number(target.dataset.id));
    if (!entry) return;
    openMenu(target, [
      ...(entry.link ? [{ label: "Open job posting", icon: "external", run: () => window.open(entry.link, "_blank", "noopener") }] : []),
      { label: "Duplicate page", icon: "copy", run: () => duplicate(entry) },
      { label: "Copy as text", icon: "file", run: () => copySummary(entry) },
      { separator: true },
      { label: "Move to Recently Deleted", icon: "trash", danger: true, run: () => removeApplications([entry.id]) }
    ]);
  },
  "toggle-star": target => toggleStar(Number(target.dataset.id)),
  "set-status": async target => {
    await flushEntrySave();
    const id = state.route.id;
    const entry = find(id);
    if (!entry || entry.status === target.dataset.stage) return;
    try {
      replaceApplications([await api.update(id, { status: target.dataset.stage })]);
      rerender();
      toast(`Moved to ${LABELS[target.dataset.stage]}`, { action: "Undo", run: () => undoStatus([[id, entry.status]]) });
    } catch (error) { fail(error); }
  },
  "remove-skill": target => saveSkills(skills => skills.filter(skill => skill !== target.dataset.skill)),
  delete: target => removeApplications([Number(target.dataset.id)]),
  restore: target => restoreApplications([Number(target.dataset.id)]),
  purge: target => purgeApplications([Number(target.dataset.id)]),
  "start-select": target => startSelection(target.dataset.scope),
  "end-select": () => endSelection(),
  "select-all": () => {
    const allSelected = state.visibleIds.length > 0 && state.visibleIds.every(id => state.selected.has(id));
    state.visibleIds.forEach(id => (allSelected ? state.selected.delete(id) : state.selected.add(id)));
    rerender();
  },
  "batch-move": () => changeStatus([...state.selected], $("#batch-status").value).then(() => endSelection()),
  "batch-delete": () => removeApplications([...state.selected], { confirmFirst: true }).then(endSelectionIfEmpty),
  "batch-restore": () => restoreApplications([...state.selected]).then(endSelectionIfEmpty),
  "batch-purge": () => purgeApplications([...state.selected]).then(endSelectionIfEmpty),
  "filter-chip": target => { state.filter.stage = target.dataset.stage; rerender(); },
  "filter-stage": target => { state.filter = { query: "", stage: target.dataset.stage }; },
  "sort-deadline": () => { state.prefs.sort = "deadline"; state.filter = { query: "", stage: "OPEN" }; savePrefs(); },
  "clear-filters": () => { state.filter = { query: "", stage: "ALL" }; rerender(); },
  "export-csv": () => exportCsv(),
  "export-json": () => exportJson(),
  "import-json": () => $("#import-file").click(),
  install: () => promptInstall(),
  reload: () => load()
};

document.addEventListener("click", event => {
  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget && !actionTarget.closest("#new-dialog")) {
    const handler = actions[actionTarget.dataset.action];
    if (handler) {
      if (actionTarget.tagName !== "A") event.preventDefault();
      handler(actionTarget, event);
      return;
    }
  }
  const opener = event.target.closest("[data-open]");
  if (opener && viewRoot.contains(opener) && !event.target.closest("a, input, button:not([data-open]), label")) {
    const id = Number(opener.dataset.open);
    if (state.selecting && state.selectScope !== "deleted" && opener.matches(".app-card, .toc-row")) {
      toggleSelected(id, !state.selected.has(id));
      return;
    }
    go(`#/entry/${id}`);
  }
});

/* ==========================================================================
   19. Drag and drop on the board (mouse and trackpad)
   ========================================================================== */
viewRoot.addEventListener("dragstart", event => {
  const card = event.target.closest?.(".app-card[draggable]");
  if (!card) return;
  state.dragId = Number(card.dataset.id);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(state.dragId));
  window.requestAnimationFrame(() => card.classList.add("dragging"));
});
viewRoot.addEventListener("dragend", () => {
  state.dragId = null;
  $$(".dragging").forEach(element => element.classList.remove("dragging"));
  $$(".column.drop").forEach(element => element.classList.remove("drop"));
});
viewRoot.addEventListener("dragover", event => {
  const column = event.target.closest?.(".column");
  if (!column || state.dragId == null) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  if (!column.classList.contains("drop")) {
    $$(".column.drop").forEach(element => element.classList.remove("drop"));
    column.classList.add("drop");
  }
});
viewRoot.addEventListener("dragleave", event => {
  const column = event.target.closest?.(".column");
  if (column && !column.contains(event.relatedTarget)) column.classList.remove("drop");
});
viewRoot.addEventListener("drop", event => {
  const column = event.target.closest?.(".column");
  if (!column || state.dragId == null) return;
  event.preventDefault();
  const id = state.dragId;
  const stage = column.dataset.stage;
  column.classList.remove("drop");
  state.dragId = null;
  if (find(id)?.status !== stage) changeStatus([id], stage);
});

/* ==========================================================================
   20. Chart tooltips (hover and keyboard focus)
   ========================================================================== */
const chartTip = $("#chart-tip");
function showTip(target) {
  const rect = target.getBoundingClientRect();
  chartTip.textContent = target.dataset.tip;
  chartTip.hidden = false;
  const half = chartTip.offsetWidth / 2 + 8;
  chartTip.style.left = `${clamp(rect.left + rect.width / 2, half, window.innerWidth - half)}px`;
  chartTip.style.top = `${rect.top + rect.height * 0.35}px`;
}
viewRoot.addEventListener("pointerover", event => { if (event.target.dataset?.tip) showTip(event.target); });
viewRoot.addEventListener("pointerout", event => { if (event.target.dataset?.tip) chartTip.hidden = true; });
viewRoot.addEventListener("focusin", event => { if (event.target.dataset?.tip) showTip(event.target); });
viewRoot.addEventListener("focusout", event => { if (event.target.dataset?.tip) chartTip.hidden = true; });
page.addEventListener("scroll", () => { chartTip.hidden = true; }, { passive: true });

/* ==========================================================================
   21. Keyboard shortcuts
   ========================================================================== */
document.addEventListener("keydown", event => {
  const typing = event.target.closest?.("input, textarea, select, [contenteditable]");
  const dialogOpen = $$("dialog").some(dialog => dialog.open);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (palette.open) palette.close(); else if (!dialogOpen) openPalette();
    return;
  }
  if (event.key === "Escape" && !dialogOpen) {
    if (!menu.hidden) closeMenu();
    else if (state.selecting) endSelection();
    return;
  }
  if (typing || dialogOpen || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "/") { event.preventDefault(); openPalette(); }
  else if (event.key.toLowerCase() === "n") { event.preventDefault(); openNew(); }
  else if (["1", "2", "3", "4"].includes(event.key)) go(["#/today", "#/board", "#/notebook", "#/insights"][Number(event.key) - 1]);
});

/* ==========================================================================
   22. Export, backup, and import
   ========================================================================== */
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  if (!state.applications.length) { toast("Nothing to export yet"); return; }
  const columns = ["Company", "Role", "Stage", "Deadline", "Location", "Source", "Link", "Contact", "Next step", "Next step date", "Skills", "Notes", "Starred", "Created", "Last edited"];
  // Leading = + - @ would make spreadsheet apps treat a cell as a formula.
  const cell = value => { let text = String(value ?? ""); if (/^[=+\-@]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
  const rows = [...state.applications].sort(compareBy("company")).map(entry => [entry.company, entry.role, LABELS[entry.status], entry.deadline, entry.location, entry.source, entry.link, entry.contact, entry.nextStep, entry.nextStepDate, entry.skills.join(", "), entry.notes, entry.starred ? "Yes" : "", entry.createdAt, entry.updatedAt].map(cell).join(","));
  download(`internship-notebook-${dayKey()}.csv`, `﻿${[columns.join(","), ...rows].join("\r\n")}`, "text/csv;charset=utf-8");
  toast("CSV exported");
}

function exportJson() {
  const backup = { format: "my-internship-notebook-backup", version: 2, exportedAt: new Date().toISOString(), applications: state.applications, recentlyDeleted: state.deleted };
  download(`internship-notebook-backup-${dayKey()}.json`, JSON.stringify(backup, null, 2), "application/json");
  toast("Backup downloaded. Keep it somewhere safe.");
}

$("#import-file").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("That file is too large to be a notebook backup.");
    const parsed = JSON.parse(await file.text());
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.applications) ? parsed.applications : null;
    if (!entries) throw new Error("That file isn't a My Internship Notebook backup.");
    const valid = entries.filter(entry => entry && typeof entry === "object" && String(entry.company || "").trim() && String(entry.role || "").trim());
    if (!valid.length) throw new Error("No applications were found in that backup.");
    const ok = await confirmDialog({
      eyebrow: "Import backup",
      title: `Add ${plural(valid.length, "page")} to your notebook?`,
      copy: "Your current pages stay as they are. Pages that are already in your notebook are skipped.",
      yes: "Import",
      no: "Cancel",
      iconName: "upload",
      danger: false
    });
    if (!ok) return;
    const added = await api.importEntries(valid);
    state.applications.push(...added);
    rerender();
    toast(added.length ? `Imported ${plural(added.length, "page")}` : "Everything in that backup is already in your notebook");
  } catch (error) {
    fail(error instanceof SyntaxError ? new Error("That file couldn't be read as a backup.") : error);
  }
});

async function duplicate(entry) {
  try {
    const { id, createdAt, updatedAt, history, status, ...fields } = entry;
    const created = await createApplication({ ...fields, status: "SAVED", company: entry.company, role: `${entry.role} (copy)`.slice(0, LIMITS.role) });
    go(`#/entry/${created.id}`);
  } catch (error) { fail(error); }
}

async function copySummary(entry) {
  const lines = [
    `${entry.company} · ${entry.role}`,
    `Stage: ${LABELS[entry.status]}`,
    entry.deadline && `Deadline: ${entry.deadline}`,
    entry.location && `Location: ${entry.location}`,
    entry.link && `Link: ${entry.link}`,
    entry.contact && `Contact: ${entry.contact}`,
    entry.nextStep && `Next step: ${entry.nextStep}${entry.nextStepDate ? ` (${entry.nextStepDate})` : ""}`,
    entry.skills.length && `Skills: ${entry.skills.join(", ")}`,
    entry.notes && `\n${entry.notes}`
  ].filter(Boolean);
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    toast("Copied to clipboard");
  } catch {
    toast("Your browser blocked copying to the clipboard", { error: true });
  }
}

/* ==========================================================================
   23. Install as an app (PWA) and offline support
   ========================================================================== */
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  state.installPrompt = event;
  if (state.route.view === "settings") rerender();
});
window.addEventListener("appinstalled", () => {
  state.installPrompt = null;
  toast("Installed. You can open the notebook from your apps now.");
  if (state.route.view === "settings") rerender();
});
async function promptInstall() {
  if (!state.installPrompt) { go("#/settings"); return; }
  state.installPrompt.prompt();
  await state.installPrompt.userChoice.catch(() => null);
  state.installPrompt = null;
  rerender();
}
if ("serviceWorker" in navigator && (window.location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(window.location.hostname))) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is optional */ }));
}

/* ==========================================================================
   24. Start up
   ========================================================================== */
async function load() {
  state.loadError = "";
  render();
  try {
    const { applications, deleted } = await api.load();
    state.applications = applications;
    state.deleted = deleted;
    state.loaded = true;
  } catch (error) {
    state.loadError = error.message;
  }
  render({ animate: true, keepScroll: false });
}

function hydrateStaticIcons() {
  $$("[data-icon]").forEach(element => { element.innerHTML = icon(element.dataset.icon); });
  $$(".cover-logo").forEach(element => { element.innerHTML = LOGO; });
  $("[data-storage-label]").textContent = BROWSER_MODE ? "Private to this browser" : "Saved on this computer";
  $("[data-storage-chip]").title = BROWSER_MODE ? "Your pages are stored only in this browser on this device." : "Your pages are saved by the local Java server.";
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  $$(".shortcut-key").forEach(element => { element.textContent = isMac ? "⌘K" : "Ctrl K"; });
}

window.addEventListener("hashchange", navigate);
window.addEventListener("pagehide", () => { flushEntrySave(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushEntrySave(); });
// Keep relative times ("2 min ago", "3 days left") fresh while the app stays open.
window.setInterval(() => {
  const typing = document.activeElement?.closest?.("#view input, #view textarea, #view select");
  if (state.loaded && state.route.view !== "entry" && !typing && !$$("dialog").some(dialog => dialog.open) && menu.hidden) rerender();
}, 60000);

hydrateStaticIcons();
applyTheme();
// The installed app's "New application" shortcut opens #/new.
const openNewOnStart = window.location.hash === "#/new";
if (openNewOnStart) window.history.replaceState(null, "", "#/today");
state.route = parseRoute();
load().then(() => { if (openNewOnStart && state.loaded) openNew(); });
})();
