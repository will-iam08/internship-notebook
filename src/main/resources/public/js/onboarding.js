/*
 * Pure onboarding logic for demo-first onboarding (website edition).
 *
 * This module holds the parts of onboarding that are pure functions of their inputs: the guided-
 * setup preference fields, the new-vs-returning classification, setup input validation, and the
 * starter-application builder. Keeping them here (not in the DOM-coupled app.js) means they are
 * unit-testable with node --test, the same way domain.js and storage.js are. Nothing here touches
 * the DOM, storage, or the network. The limits are bound to the real domain limits so setup never
 * accepts a value the rest of the app would reject or silently truncate.
 */
import { LIMITS } from "./domain.js";

export const SEASONS = ["Winter", "Spring", "Summer", "Fall"];
export const MAX_TARGET_COMPANIES = 50;
export const NAME_LIMIT = 40; // matches readPrefs slice(0,40), the Settings input, and the name handler

/* ---------- Preferences: read-side sanitization of the new onboarding fields ---------- */

/** Coerces a stored target role into the accepted shape (string, trimmed, <= role limit). */
export function sanitizeTargetRole(value) {
  return typeof value === "string" ? value.slice(0, LIMITS.role) : "";
}

/** Coerces a stored season into one of the allowed values, or "" when unknown. */
export function sanitizeSeason(value) {
  return SEASONS.includes(value) ? value : "";
}

/** Coerces a stored target-companies value into a clean string[] (trimmed, capped, de-blanked). */
export function sanitizeTargetCompanies(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => typeof item === "string" && item.trim())
    .map(item => item.trim().slice(0, LIMITS.company))
    .slice(0, MAX_TARGET_COMPANIES);
}

/* ---------- First-run classification ---------- */

/**
 * True when the visitor has real work worth protecting: an active page, a recoverable Recently
 * Deleted page, or a pending draft. `record` is the object returned by browserApi.read()
 * ({ applications, recentlyDeleted }); `drafts` is the object returned by readDrafts().
 */
export function hasExistingWork(record, drafts) {
  const applications = Array.isArray(record?.applications) ? record.applications : [];
  const recentlyDeleted = Array.isArray(record?.recentlyDeleted) ? record.recentlyDeleted : [];
  const draftKeys = drafts && typeof drafts === "object" ? Object.keys(drafts) : [];
  return applications.length > 0 || recentlyDeleted.length > 0 || draftKeys.length > 0;
}

/**
 * True when the visitor should land in the demo. A visitor is "new" only in the browser edition,
 * with no existing work and without the started flag set. Every other non-corrupted combination is
 * a returning visitor. Corrupted storage is handled by the caller's recovery path before this runs,
 * so it is never classified here.
 */
export function isNewVisitor({ browserMode, record, drafts, started }) {
  if (!browserMode) return false;
  if (started === true) return false;
  return !hasExistingWork(record, drafts);
}

/* ---------- Welcome page routing ---------- */

/** Hashes that count as "arriving at the front door" rather than following a deep link. */
const FRONT_DOOR_HASHES = new Set(["", "#", "#/", "#/welcome"]);

/**
 * True when the welcome page may render at all. It is a website-edition page that sits in front of
 * the demo, so it needs the demo to be active: a returning visitor (whose demo is never entered) or
 * the Server Edition always falls through to Today instead.
 */
export function canShowWelcome({ browserMode, demoActive }) {
  return browserMode === true && demoActive === true;
}

/**
 * True when a first load should be routed to #/welcome. Only a new visitor arriving at the front
 * door (no hash, or #/welcome itself) is redirected. A deep link such as #/board or #/entry/3, or a
 * launch intent from the installed app (#/new, a share target), is respected so those links keep
 * doing what they say.
 */
export function shouldLandOnWelcome({ browserMode, newVisitor, demoActive, hash, launchIntent }) {
  if (!canShowWelcome({ browserMode, demoActive })) return false;
  if (newVisitor !== true || launchIntent === true) return false;
  return FRONT_DOOR_HASHES.has(typeof hash === "string" ? hash : "");
}

/**
 * True when the welcome tour video may start on its own. Reduced-motion users get the poster and a
 * play button instead, and so do visitors who asked the browser to save data (the clip is ~2.7 MB).
 */
export function shouldAutoplayTour({ reducedMotion, saveData }) {
  return reducedMotion !== true && saveData !== true;
}

/* ---------- Guided-setup validation ---------- */

/** Trims and type-checks raw setup input into the shape the validators and the commit expect. */
function cleanSetupInput(input) {
  return {
    name: typeof input?.name === "string" ? input.name.trim() : "",
    targetRole: typeof input?.targetRole === "string" ? input.targetRole.trim() : "",
    season: typeof input?.season === "string" ? input.season : "",
    targetCompanies: Array.isArray(input?.targetCompanies)
      ? input.targetCompanies.map(item => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
      : []
  };
}

/**
 * Every invalid guided-setup field at once, as { field: message } in form order (name, targetRole,
 * season, targetCompanies). Empty when the input is valid. The notebook builder shows all of these
 * next to their fields; validateSetup below reports only the first. Limits are the real domain
 * limits: name 1..40, target role 1..100, each company 1..80, up to 50 companies.
 */
export function setupFieldErrors(input) {
  const raw = cleanSetupInput(input);
  const errors = {};
  if (!raw.name) errors.name = "Enter your name.";
  else if (raw.name.length > NAME_LIMIT) errors.name = `Name must be ${NAME_LIMIT} characters or fewer.`;
  if (!raw.targetRole) errors.targetRole = "Enter the role you're targeting.";
  else if (raw.targetRole.length > LIMITS.role) errors.targetRole = `Target role must be ${LIMITS.role} characters or fewer.`;
  if (!SEASONS.includes(raw.season)) errors.season = "Choose a season.";
  if (raw.targetCompanies.length > MAX_TARGET_COMPANIES) {
    errors.targetCompanies = `Add at most ${MAX_TARGET_COMPANIES} target companies.`;
  } else if (raw.targetCompanies.some(company => company.length > LIMITS.company)) {
    errors.targetCompanies = `Each company must be ${LIMITS.company} characters or fewer.`;
  }
  return errors;
}

/**
 * Validates every guided-setup input before any write. Returns { ok: true, value } with the
 * cleaned fields, or { ok: false, field, message, value } naming the first invalid field while
 * preserving what the visitor entered (so the form can keep their input).
 */
export function validateSetup(input) {
  const raw = cleanSetupInput(input);
  const [first] = Object.entries(setupFieldErrors(raw));
  if (first) return { ok: false, field: first[0], message: first[1], value: raw };
  return { ok: true, value: raw };
}

/**
 * Builds the starter application records for the validated target companies, one per company, as
 * plain field objects (company + the target role) suitable for browserApi.importBackup. The role
 * falls back to the target role so each starter page is a valid, editable entry. Returns [] for no
 * companies, which the caller handles with a single empty-notebook write.
 */
export function buildStarterApplications({ targetRole, targetCompanies }) {
  const role = typeof targetRole === "string" && targetRole.trim() ? targetRole.trim() : "Intern";
  return (Array.isArray(targetCompanies) ? targetCompanies : []).map(company => ({
    company,
    role,
    status: "SAVED"
  }));
}

/**
 * The stable identity of a starter page: its company and role, trimmed and case-folded. Setup and
 * the builder create pages from what the visitor typed, so "the same page" means the same company
 * and role. (Backup import keys on createdAt as well, which is right for restoring a backup but
 * makes every fresh starter look new, because its createdAt is "now".)
 */
export function starterKey(entry) {
  const fold = value => (typeof value === "string" ? value.trim().toLowerCase() : "");
  return `${fold(entry?.company)}\u0000${fold(entry?.role)}`;
}

/**
 * Drops starters already in the notebook (active or Recently Deleted) and repeats within the list
 * itself, so re-submitting setup, or typing "Northwind, northwind", never creates duplicate pages.
 * Returns new objects in their original order; inputs are not mutated.
 */
export function withoutExistingStarters(starters, record) {
  const seen = new Set([
    ...(Array.isArray(record?.applications) ? record.applications : []),
    ...(Array.isArray(record?.recentlyDeleted) ? record.recentlyDeleted : [])
  ].map(starterKey));
  const fresh = [];
  for (const starter of Array.isArray(starters) ? starters : []) {
    const key = starterKey(starter);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push({ ...starter });
  }
  return fresh;
}
