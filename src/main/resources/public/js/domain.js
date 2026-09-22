/*
 * Domain rules for My Internship Notebook: stages, field limits, validation, and the numbers
 * worked out from the entries. Nothing here touches the page or storage, so it can be tested
 * on its own (see tests/unit). Validation mirrors ApplicationRepository.java.
 */

/* ---------- Constants ---------- */
export const STAGES = ["SAVED", "APPLIED", "INTERVIEW", "OFFER", "REJECTED"];
export const PIPELINE = ["SAVED", "APPLIED", "INTERVIEW", "OFFER"];
export const OPEN_STAGES = ["SAVED", "APPLIED", "INTERVIEW"];
export const LABELS = { SAVED: "Saved", APPLIED: "Applied", INTERVIEW: "Interview", OFFER: "Offer", REJECTED: "Rejected" };
export const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_MS = 7 * DAY_MS;
export const FOLLOW_UP_DAYS = 14;
export const LIMITS = { company: 80, role: 100, location: 80, source: 60, notes: 10000, contact: 120, nextStep: 140, link: 500 };
export const SKILL_LIMIT = 12;
export const SKILL_LENGTH = 40;
export const SOURCE_SUGGESTIONS = ["LinkedIn", "WaterlooWorks", "Company website", "Referral", "Handshake", "Indeed", "Career fair", "Recruiter"];
export const BACKUP_FORMAT = "my-internship-notebook-backup";
export const BACKUP_VERSION = 2;

/* ---------- Small helpers ---------- */
export const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
/**
 * True for a real calendar date in "YYYY-MM-DD" form. `new Date(y, m, d)` silently rolls
 * overflowing values (month 13, day 40) into a later date instead of failing, so a regex plus
 * a NaN check is not enough; this also confirms the date round-trips to the same y/m/d, which
 * matches the stricter java.time.LocalDate.parse used for the same field on the Java server.
 */
export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = parseDay(value);
  return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
export const isValidIso = value => typeof value === "string" && !Number.isNaN(new Date(value).getTime());

export function pad(number) { return String(number).padStart(2, "0"); }
export function dayKey(date = new Date()) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
export function parseDay(value) { const [year, month, day] = String(value).split("-").map(Number); return new Date(year, month - 1, day, 12); }
export function startOfDay(date = new Date()) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
export function startOfWeek(date = new Date()) {
  const start = startOfDay(date);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}
export function daysUntil(value) { return Math.round((parseDay(value) - parseDay(dayKey())) / DAY_MS); }
export function formatDay(value, options = {}) {
  return parseDay(value).toLocaleDateString(undefined, { month: "short", day: "numeric", ...options });
}
export function relativeDay(value) {
  const days = daysUntil(value);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1 && days < 7) return `in ${days} days`;
  if (days < -1 && days > -7) return `${-days} days ago`;
  return formatDay(value);
}
export function timeAgo(iso) {
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
export function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/* ---------- Validation and data shape ---------- */
export function cleanText(value, field, { required = false } = {}) {
  const text = String(value ?? "").trim();
  if (required && !text) throw new Error(`${field === "role" ? "Role" : "Company"} is required.`);
  if (text.length > LIMITS[field]) throw new Error(`${field} must be ${LIMITS[field]} characters or fewer.`);
  return text;
}

export function cleanDate(value, label) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (!isValidDate(text)) throw new Error(`${label} must be a valid date.`);
  return text;
}

/** Only web links are allowed, so a saved link can never run script when it is opened. */
export function cleanLink(value) {
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

export function cleanSkills(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  const seen = new Set();
  const skills = [];
  for (const raw of list) {
    const skill = String(raw).trim();
    if (!skill) continue;
    const formatted = skill.charAt(0).toUpperCase() + skill.slice(1);
    if (seen.has(formatted)) continue;
    seen.add(formatted);
    skills.push(formatted.slice(0, SKILL_LENGTH));
    if (skills.length === SKILL_LIMIT) break;
  }
  return skills;
}

export function cleanStage(value) {
  const stage = String(value ?? "").toUpperCase();
  if (!STAGES.includes(stage)) throw new Error("Choose a valid pipeline stage.");
  return stage;
}

/** Validates only the fields that are present, so one field can be saved at a time. */
export function cleanChanges(changes, { creating = false } = {}) {
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
export function normalize(entry) {
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

export function withStatus(application, status, at) {
  if (application.status === status) return application;
  return { ...application, status, updatedAt: at, history: [...application.history, { status, at }] };
}

/* ---------- Derived numbers (all computed from the entries themselves) ---------- */
export const countBy = list => Object.fromEntries(STAGES.map(stage => [stage, list.filter(entry => entry.status === stage).length]));
export const reached = (entry, stage) => entry.status === stage || entry.history.some(change => change.status === stage)
  || (stage === "INTERVIEW" && entry.status === "OFFER");

/** When an application was sent: the first time it left "Saved". */
export function sentAt(entry) {
  const change = entry.history.find(item => item.status !== "SAVED");
  if (change) return change.at;
  return entry.status === "SAVED" ? null : entry.createdAt;
}

/** The date the stage last changed, used to spot applications waiting for a reply. */
export function stageSince(entry) {
  const last = [...entry.history].reverse().find(change => change.status === entry.status);
  return last ? last.at : entry.createdAt;
}

export function metrics(list) {
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

export function weekActivity(list, weekOffset = 0) {
  const start = startOfWeek();
  start.setDate(start.getDate() + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, key: dayKey(date), count: 0 };
  });
  for (const entry of list) {
    const at = sentAt(entry);
    if (!at) continue;
    const key = dayKey(new Date(at));
    const day = days.find(item => item.key === key);
    if (day) day.count++;
  }
  return { start, days, total: days.reduce((sum, day) => sum + day.count, 0) };
}

/** Dated things coming up: deadlines for saved roles and next steps for everything still open. */
export function agendaItems(list) {
  const items = [];
  for (const entry of list) {
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
export function attentionItems(list) {
  const items = [];
  for (const entry of list) {
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

export function matchesQuery(entry, query) {
  if (!query) return true;
  const haystack = [entry.company, entry.role, entry.location, entry.source, entry.contact, entry.nextStep, entry.notes, entry.skills.join(" ")].join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).every(word => haystack.includes(word));
}

/* ---------- Backup import: the same rules a normal entry goes through, but forgiving ---------- */
const clampText = (value, limit) => String(value ?? "").trim().slice(0, limit);

/**
 * Prepares one record from an imported backup file for saving. It applies the same limits and
 * safety rules cleanChanges applies to a normal edit (see cleanLink in particular: an imported
 * link is validated exactly like a typed one, so a backup can never smuggle in a javascript: or
 * other unsafe scheme), but it is forgiving rather than throwing: the point of an import is to
 * keep as much of the person's own data as possible, so a field that cannot be made safe (an
 * unsafe link, a garbled date) is quietly dropped rather than discarding the whole entry over it.
 * Returns { entry: null } when there is no usable company or role to import.
 */
export function sanitizeImportedEntry(raw) {
  const company = clampText(raw?.company, LIMITS.company);
  const role = clampText(raw?.role, LIMITS.role);
  if (!company || !role) return { entry: null, issues: [] };
  const issues = [];
  const rawLink = String(raw?.link ?? "").trim();
  let link = "";
  try { link = cleanLink(rawLink); } catch { if (rawLink) issues.push("link"); }
  const deadline = isValidDate(String(raw?.deadline ?? "")) ? raw.deadline : "";
  const nextStepDate = isValidDate(String(raw?.nextStepDate ?? "")) ? raw.nextStepDate : "";
  const entry = normalize({
    ...raw,
    company, role, link, deadline, nextStepDate,
    location: clampText(raw?.location, LIMITS.location),
    source: clampText(raw?.source, LIMITS.source),
    notes: clampText(raw?.notes, LIMITS.notes),
    contact: clampText(raw?.contact, LIMITS.contact),
    nextStep: clampText(raw?.nextStep, LIMITS.nextStep)
  });
  return { entry, issues };
}

/** Runs every record in an imported file through sanitizeImportedEntry and totals the results,
 *  so the import dialog can tell the person what will actually happen before they confirm. */
export function previewImport(rawEntries) {
  const results = rawEntries.map(sanitizeImportedEntry);
  const usable = results.filter(result => result.entry).map(result => result.entry);
  const skipped = results.length - usable.length;
  const linksRemoved = results.filter(result => result.entry && result.issues.includes("link")).length;
  return { usable, skipped, linksRemoved };
}

export function compareBy(sort) {
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
