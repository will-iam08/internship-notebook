/*
 * Pure marketing landing page, authentication validation, password strength,
 * and local account gating logic for My Internship Notebook.
 *
 * This module has zero DOM or network dependencies so every validation rule,
 * copy length constraint, feature ordering, smooth-scroll easing helper, and
 * local account store operation is unit-testable with node --test.
 */
import { LIMITS } from "./domain.js";
import { hasExistingWork } from "./onboarding.js";

export const ACCOUNT_STORAGE_KEY = "my-internship-notebook-accounts-v1";
export const SESSION_STORAGE_KEY = "my-internship-notebook-session-v1";

export const REDIRECT_DELAY_MS = 2000;
export const MIN_SCROLL_DURATION_MS = 400;
export const MAX_SCROLL_DURATION_MS = 800;
export const FULL_NAME_MAX = 80;
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/**
 * Standard email validation pattern requiring local part, @, domain, and TLD of at least 2 chars.
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Hero copy constrained by specification:
 * - H1 headline: max 60 characters (48 characters)
 * - Value proposition paragraph: max 180 characters (154 characters), stating primary benefit,
 *   target user, and key differentiator.
 */
export const HERO_HEADLINE = "Every internship application, one calm notebook.";
export const HERO_SUBHEAD = "Built for students and co-op applicants to track deadlines, stages, and interview prep in a private, offline-ready workspace with one-click job clipping.";

/**
 * Six distinct product features ordered by user-perceived value (strongest first).
 * Each feature includes a title, a 2-3 sentence description, an icon identifier,
 * and an annotated visual preview configuration.
 */
export const LANDING_FEATURES = Object.freeze([
  Object.freeze({
    id: "clipper",
    rank: 1,
    badge: "Fastest daily capture",
    title: "One-Click Job Clipper and Paste Autofill",
    description: "Save openings from Greenhouse, Lever, Ashby, Workday, LinkedIn, and Simplify in a single click. Paste any job URL or posting snippet to fill company, role, location, source, and technical skills automatically. Spend your energy tailoring resumes instead of copying fields by hand.",
    icon: "sparkle",
    visualAlt: "Annotated preview of the Quick Fill job clipper extracting Stripe, Software Engineer Intern, Seattle, and Python from a pasted Greenhouse URL.",
    annotations: Object.freeze(["Auto-detects ATS & job board URLs", "Extracts skills & location instantaneously"])
  }),
  Object.freeze({
    id: "pipeline",
    rank: 2,
    badge: "Visual stage tracking",
    title: "Kanban Pipeline and Dated Stage History",
    description: "Move applications across Saved, Applied, Interview, Offer, and Rejected columns as your search progresses. Every stage change is stamped automatically on a dated timeline so you always know when you applied and when a recruiter replied. Filter by company, skill, or stage in real time on desktop or phone.",
    icon: "board",
    visualAlt: "Annotated preview of the five-stage Kanban pipeline board with color-vision-checked stage badges and dated history stamps.",
    annotations: Object.freeze(["5 color-vision-safe pipeline stages", "Automatic dated move history"])
  }),
  Object.freeze({
    id: "import",
    rank: 3,
    badge: "Zero switching cost",
    title: "Universal Spreadsheet and Backup Import",
    description: "Bring your existing tracker from Google Sheets, Notion, Simplify, Excel, or WaterlooWorks without retyping a single row. Smart header detection maps columns, normalizes stages, and validates links automatically before anything is added. Full JSON and CSV exports ensure your records are always portable.",
    icon: "upload",
    visualAlt: "Annotated preview of universal CSV and TSV spreadsheet import mapping columns from Google Sheets, Notion, and Simplify.",
    annotations: Object.freeze(["RFC 4180 CSV, TSV & JSON support", "Lossless round-trip export & undo"])
  }),
  Object.freeze({
    id: "interview",
    rank: 4,
    badge: "Walk in prepared",
    title: "Role-Matched Interview Prep and Timed Mock Sessions",
    description: "Practice from a curated bank of 62 behavioral and technical questions matched to each application's role and stage. Run timed mock interviews with live STAR structure checks, filler-word detection, and speaking-pace feedback. Review your score trends and weakest areas before walking into the real call.",
    icon: "check",
    visualAlt: "Annotated preview of the timed mock interview workspace showing STAR structure coverage, speaking pace, and 88/100 readiness score.",
    annotations: Object.freeze(["62 role-aware practice questions", "Live STAR & pacing feedback"])
  }),
  Object.freeze({
    id: "reminders",
    rank: 5,
    badge: "Never miss a deadline",
    title: "Deadline Radar and Calendar Reminders",
    description: "See overdue items, upcoming application deadlines, and quiet applications that need a follow-up nudge on your Today page. Export a standard calendar file (.ics) to put every deadline and interview onto Google Calendar, Apple Calendar, or Outlook with two-stage alerts. Generate a self-addressed weekly email digest in one click.",
    icon: "calendar",
    visualAlt: "Annotated preview of the Today deadline radar and .ics calendar reminder export with 24-hour and 2-hour alerts.",
    annotations: Object.freeze(["One-click .ics calendar alerts", "7-day quiet application follow-up nudges"])
  }),
  Object.freeze({
    id: "insights",
    rank: 6,
    badge: "Private by design",
    title: "Offline-First Notebook and Search Analytics",
    description: "Your application records live locally in your browser with an automatic draft retry queue that works on subway commutes and campus Wi-Fi. Spot patterns across your search with response-rate funnels, weekly application rhythm charts, and top employer skill bars. Optional end-to-end user-owned cloud sync keeps your devices in step when you choose.",
    icon: "insights",
    visualAlt: "Annotated preview of the Insights dashboard displaying response-rate funnel, weekly application goal chart, and top requested skills.",
    annotations: Object.freeze(["100% offline-capable PWA storage", "Response funnel & skill frequency charts"])
  })
]);

/**
 * Checks whether an email address matches standard email format and length bounds.
 */
export function isValidEmail(email) {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > EMAIL_MAX) return false;
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Evaluates password rules and returns a strength breakdown for the live strength indicator.
 * Requirements: minimum 8 characters, at least one letter, and at least one number.
 */
export function evaluatePasswordStrength(password) {
  const raw = typeof password === "string" ? password : "";
  const hasMinLength = raw.length >= PASSWORD_MIN;
  const hasLetter = /[A-Za-z]/.test(raw);
  const hasNumber = /\d/.test(raw);
  const hasLongLength = raw.length >= 12;
  const hasVariety = /[^A-Za-z0-9]/.test(raw) && /[a-z]/.test(raw) && /[A-Z]/.test(raw);

  const meetsRequirements = hasMinLength && hasLetter && hasNumber && raw.length <= PASSWORD_MAX;

  if (!raw.length) {
    return {
      score: 0,
      label: "Enter a password",
      meetsRequirements: false,
      checks: { hasMinLength: false, hasLetter: false, hasNumber: false }
    };
  }

  let score = 1;
  if (meetsRequirements) {
    score = 2;
    if (hasLongLength || /[^A-Za-z0-9]/.test(raw) || (/[a-z]/.test(raw) && /[A-Z]/.test(raw))) {
      score = 3;
    }
    if (hasLongLength && hasVariety) {
      score = 4;
    }
  } else {
    const passedCount = [hasMinLength, hasLetter, hasNumber].filter(Boolean).length;
    score = passedCount >= 2 ? 1 : 1;
  }

  const labels = {
    0: "Enter a password",
    1: "Weak",
    2: "Fair",
    3: "Good",
    4: "Strong"
  };

  return {
    score,
    label: labels[score],
    meetsRequirements,
    checks: { hasMinLength, hasLetter, hasNumber }
  };
}

/**
 * Validates signup or sign-in form fields and preserves raw entered values on failure.
 */
export function validateLandingAuth(input = {}, { mode = "signup" } = {}) {
  const fullName = typeof input?.fullName === "string" ? input.fullName : "";
  const email = typeof input?.email === "string" ? input.email : "";
  const password = typeof input?.password === "string" ? input.password : "";

  const trimmedName = fullName.trim();
  const trimmedEmail = email.trim();
  const errors = {};

  if (mode === "signup") {
    if (!trimmedName) {
      errors.fullName = "Enter your full name.";
    } else if (trimmedName.length < 2) {
      errors.fullName = "Full name must be at least 2 characters.";
    } else if (trimmedName.length > FULL_NAME_MAX) {
      errors.fullName = `Full name must be ${FULL_NAME_MAX} characters or fewer.`;
    }
  }

  if (!trimmedEmail) {
    errors.email = "Enter your email address.";
  } else if (!isValidEmail(trimmedEmail)) {
    errors.email = "Enter a valid email address (for example, alex@university.edu).";
  }

  const strength = evaluatePasswordStrength(password);
  if (!password) {
    errors.password = "Enter a password.";
  } else if (password.length > PASSWORD_MAX) {
    errors.password = `Password must be ${PASSWORD_MAX} characters or fewer.`;
  } else if (!strength.checks.hasMinLength) {
    errors.password = "Password must be at least 8 characters long.";
  } else if (!strength.checks.hasLetter) {
    errors.password = "Password must include at least one letter.";
  } else if (!strength.checks.hasNumber) {
    errors.password = "Password must include at least one number.";
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    strength,
    values: { fullName, email, password },
    cleaned: {
      fullName: trimmedName.slice(0, LIMITS.company),
      email: trimmedEmail.toLowerCase(),
      password
    }
  };
}

/**
 * Clamps smooth-scroll animation duration to [400ms, 800ms] as required by the specification.
 */
export function clampScrollDuration(durationMs = 560) {
  const num = Number(durationMs);
  if (!Number.isFinite(num)) return 560;
  return Math.min(MAX_SCROLL_DURATION_MS, Math.max(MIN_SCROLL_DURATION_MS, Math.round(num)));
}

/**
 * Smooth cubic ease-in-out curve for scroll transitions.
 */
export function easeInOutCubic(progress) {
  const t = Math.min(1, Math.max(0, Number(progress) || 0));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Deterministic non-reversible fingerprint for local-first browser credential verification.
 */
export function hashCredential(email, password) {
  const input = `${String(email || "").trim().toLowerCase()}\u0000${String(password || "")}`;
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `v1:${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

function readAccountsMap(store) {
  try {
    const raw = store?.get ? store.get(ACCOUNT_STORAGE_KEY) : store?.getItem?.(ACCOUNT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAccountsMap(store, map) {
  const payload = JSON.stringify(map);
  try {
    if (store?.set) return Boolean(store.set(ACCOUNT_STORAGE_KEY, payload));
    if (store?.setItem) { store.setItem(ACCOUNT_STORAGE_KEY, payload); return true; }
    return false;
  } catch {
    return false;
  }
}

function writeSessionRecord(store, session) {
  const payload = JSON.stringify(session);
  try {
    if (store?.set) return Boolean(store.set(SESSION_STORAGE_KEY, payload));
    if (store?.setItem) { store.setItem(SESSION_STORAGE_KEY, payload); return true; }
    return false;
  } catch {
    return false;
  }
}

export function readActiveSession(store) {
  try {
    const raw = store?.get ? store.get(SESSION_STORAGE_KEY) : store?.getItem?.(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.email !== "string" || !parsed.email) return null;
    return {
      fullName: typeof parsed.fullName === "string" ? parsed.fullName : "",
      email: parsed.email,
      signedInAt: typeof parsed.signedInAt === "string" ? parsed.signedInAt : ""
    };
  } catch {
    return null;
  }
}

export function clearActiveSession(store) {
  try {
    if (store?.remove) return Boolean(store.remove(SESSION_STORAGE_KEY));
    if (store?.removeItem) { store.removeItem(SESSION_STORAGE_KEY); return true; }
    return false;
  } catch {
    return false;
  }
}

/**
 * Registers a new account in local storage after validating all fields.
 * Preserves input values on any validation or duplicate-account failure.
 */
export function registerLocalAccount(store, input, { now = new Date() } = {}) {
  const check = validateLandingAuth(input, { mode: "signup" });
  if (!check.ok) {
    return {
      ok: false,
      errors: check.errors,
      message: Object.values(check.errors)[0],
      values: check.values
    };
  }

  const accounts = readAccountsMap(store);
  const key = check.cleaned.email;
  if (accounts[key]) {
    return {
      ok: false,
      errors: { email: "An account with this email address already exists. Sign in instead." },
      message: "An account with this email address already exists. Sign in instead.",
      values: check.values
    };
  }

  const timestamp = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const record = {
    fullName: check.cleaned.fullName,
    email: key,
    passwordHash: hashCredential(key, check.cleaned.password),
    createdAt: timestamp
  };

  accounts[key] = record;
  if (!writeAccountsMap(store, accounts)) {
    return {
      ok: false,
      errors: {},
      message: "Account could not be saved because browser storage is full or unavailable.",
      values: check.values
    };
  }

  const session = {
    fullName: record.fullName,
    email: record.email,
    signedInAt: timestamp
  };
  if (!writeSessionRecord(store, session)) {
    return {
      ok: false,
      errors: {},
      message: "Session could not be started because browser storage is unavailable.",
      values: check.values
    };
  }

  return {
    ok: true,
    account: { fullName: record.fullName, email: record.email, createdAt: record.createdAt },
    session,
    values: check.values
  };
}

/**
 * Authenticates an existing account in local storage, or creates a session if credentials match.
 * On failure, returns a specific error message and preserves all entered values.
 */
export function authenticateLocalAccount(store, input, { now = new Date() } = {}) {
  const check = validateLandingAuth(input, { mode: "signin" });
  if (!check.ok) {
    return {
      ok: false,
      errors: check.errors,
      message: Object.values(check.errors)[0],
      values: check.values
    };
  }

  const accounts = readAccountsMap(store);
  const key = check.cleaned.email;
  const existing = accounts[key];
  if (!existing) {
    return {
      ok: false,
      errors: { email: "No account was found for that email address. Create an account below." },
      message: "No account was found for that email address. Create an account below.",
      values: check.values
    };
  }

  const expectedHash = hashCredential(key, check.cleaned.password);
  if (existing.passwordHash !== expectedHash) {
    return {
      ok: false,
      errors: { password: "Incorrect password for that email address. Please try again." },
      message: "Incorrect password for that email address. Please try again.",
      values: check.values
    };
  }

  const timestamp = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const session = {
    fullName: existing.fullName,
    email: existing.email,
    signedInAt: timestamp
  };
  if (!writeSessionRecord(store, session)) {
    return {
      ok: false,
      errors: {},
      message: "Session could not be started because browser storage is unavailable.",
      values: check.values
    };
  }

  return {
    ok: true,
    account: { fullName: existing.fullName, email: existing.email, createdAt: existing.createdAt },
    session,
    values: check.values
  };
}

/**
 * Determines whether the visitor must be gated at the standalone landing page.
 * Unauthenticated visitors in the browser edition never load directly into the notebook;
 * they are always gated at the standalone landing page until they sign up or sign in.
 */
export function shouldGateWithLanding({ browserMode, record, drafts, started, session }) {
  if (!browserMode) return false;
  if (session && typeof session.email === "string" && session.email.trim()) return false;
  if (started === true) return false;
  if (hasExistingWork(record, drafts)) return false;
  return true;
}
