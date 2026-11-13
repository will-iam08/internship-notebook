/*
 * My Internship Notebook
 * A dependency-free single-page app. It talks to the Java API when it runs locally
 * ("server" mode) and keeps entries privately in this browser on the public website
 * ("browser" mode). Both modes share one interface: the `api` object in api.js.
 *
 * Modules: domain.js (rules and numbers), storage.js (browser storage), api.js (backends),
 * ui/icons.js (inline icons). This file holds state, views, routing, and event handling.
 */
import {
  STAGES, PIPELINE, OPEN_STAGES, LABELS, DAY_MS, RETENTION_MS, LIMITS, SOURCE_SUGGESTIONS,
  BACKUP_FORMAT, BACKUP_VERSION,
  plural, clamp, dayKey, daysUntil, formatDay, timeAgo, formatDateTime,
  cleanSkills, cleanLink, cleanInterview, collapseHistory, INTERVIEW_NOTE_LIMIT, countBy, reached, sentAt, metrics, weekActivity, agendaItems, attentionItems, matchesQuery, compareBy,
  previewImport, sanitizeImportedEntry
} from "./domain.js";
import { KEYS, clearConfirmedDraft, clearDraft, readDrafts, storage, writeDraft } from "./storage.js";
import { api, browserApi, BROWSER_MODE, StorageCorruptedError } from "./api.js";
import { createCloudClient } from "./cloud.js";
import { readCloudConfig } from "./cloud-config.js";
import { DEMO_SEED, buildDemoDataset } from "./demo.js";
import {
  SEASONS, hasExistingWork, isNewVisitor as isNewVisitorPure,
  canShowWelcome, shouldLandOnWelcome, shouldAutoplayTour,
  sanitizeTargetRole, sanitizeSeason, sanitizeTargetCompanies,
  validateSetup, buildStarterApplications
} from "./onboarding.js";
import { commitStarterNotebook } from "./notebook-commit.js";
import {
  START_MODES, USE_CASES, FOCUS_AREAS, MAX_USE_CASES, DEFAULT_START_MODE, DEFAULT_USE_CASES, DEFAULT_FOCUS_AREAS,
  START_MODE_COPY, USE_CASE_COPY, FOCUS_COPY, buildNotebookPlan, validatePlan, cleanUseCases, cleanFocusAreas
} from "./builder.js";
import { entryCalendar } from "./calendar.js";
import { QUESTION_GROUPS, questionsByGroup, questionsFor, interviewSummary, withQuestionStatus, withQuestionNote } from "./interview.js";
import {
  upcomingActions, dueSoon, dueSoonMessage, buildIcs, buildMarkdownNotebook, buildEmailDigest, digestMailto, shortDate
} from "./reminders.js";
import { icon, LOGO } from "./ui/icons.js";

/* ==========================================================================
   1. Constants
   ========================================================================== */
const VIEWS = {
  welcome: { title: "Welcome", tab: "--tab-today" },
  today: { title: "Today", tab: "--tab-today" },
  board: { title: "Board", tab: "--tab-board" },
  notebook: { title: "All pages", tab: "--tab-notebook" },
  insights: { title: "Insights", tab: "--tab-insights" },
  deleted: { title: "Recently Deleted", tab: "--tab-deleted" },
  settings: { title: "Settings", tab: "--tab-settings" },
  entry: { title: "Page", tab: "--tab-notebook" },
  setup: { title: "Set up your notebook", tab: "--tab-today" },
  build: { title: "Build your notebook", tab: "--tab-today" },
  export: { title: "Reminders and exports", tab: "--tab-settings" },
  signup: { title: "Save your notebook", tab: "--tab-settings" }
};

/* ==========================================================================
   2. Small helpers
   ========================================================================== */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = "") => String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

function debounce(fn, wait) {
  let timer;
  const debounced = (...args) => { window.clearTimeout(timer); timer = window.setTimeout(() => fn(...args), wait); };
  debounced.cancel = () => window.clearTimeout(timer);
  return debounced;
}

/* ==========================================================================
   6. State and preferences
   ========================================================================== */
function readPrefs() {
  let saved = {};
  try { saved = JSON.parse(storage.get(KEYS.prefs) || "{}") || {}; } catch { saved = {}; }
  const legacyGoal = Number(storage.get(KEYS.goal) ?? storage.get(KEYS.legacyGoal));
  const theme = storage.get(KEYS.theme);
  const filters = saved.newsFilter || {};
  return {
    goal: clamp(Number(saved.goal) || (legacyGoal > 0 ? legacyGoal : 5), 1, 50),
    name: typeof saved.name === "string" ? saved.name.slice(0, 40) : "",
    targetRole: sanitizeTargetRole(saved.targetRole),
    season: sanitizeSeason(saved.season),
    targetCompanies: sanitizeTargetCompanies(saved.targetCompanies),
    started: saved.started === true,
    // What the visitor asked the notebook to do (set by the builder). Empty keeps the default Today.
    focusAreas: cleanFocusAreas(saved.focusAreas),
    // Reminders and exports: the visitor's own address for the self-addressed digest (kept only in
    // this browser), the opt-in due-soon notification, and the day it last ran (once a day at most).
    digestEmail: typeof saved.digestEmail === "string" ? saved.digestEmail.trim().slice(0, 254) : "",
    dueSoonAlerts: saved.dueSoonAlerts === true,
    lastDueAlert: typeof saved.lastDueAlert === "string" && /^\d{4}-\d{2}-\d{2}$/.test(saved.lastDueAlert) ? saved.lastDueAlert : "",
    theme: theme === "light" || theme === "dark" ? theme : "system",
    sort: ["updated", "created", "deadline", "company"].includes(saved.sort) ? saved.sort : "updated",
    newsFilter: {
      term: typeof filters.term === "string" ? filters.term.slice(0, 80) : "ALL",
      degree: ["Junior", "Intermediate", "Senior"].includes(filters.degree) ? filters.degree : "ALL",
      coopOnly: filters.coopOnly === true,
      location: typeof filters.location === "string" ? filters.location.slice(0, 120) : "",
      keywords: typeof filters.keywords === "string" ? filters.keywords.slice(0, 120) : ""
    }
  };
}

const state = {
  applications: [],
  deleted: [],
  demoMode: false,
  demo: null,
  realApplications: null,
  realDeleted: null,
  // Welcome page choices (tour tab, mini-board filter, chaos/notebook toggle) survive a re-render.
  welcome: { tab: "today", filter: "ALL", organized: false },
  setupForm: { name: "", targetRole: "", season: "", companies: "" },
  build: null, // the builder's answers and step; set from freshBuild() once it is defined below
  prepOnlyToPractice: false, // the interview-prep filter, for this visit
  prepOpen: {}, // entry id -> Set of open question groups, so re-renders keep them as left
  scrollToPrep: false,
  setupError: null,
  setupSubmitting: false,
  loaded: false,
  loadError: "",
  corrupted: null,
  route: { view: "today", id: null },
  rescheduleId: null,
  backRoute: "#/board",
  selecting: false,
  selectScope: "",
  selected: new Set(),
  visibleIds: [],
  boardQuery: "",
  boardStage: "SAVED",
  filter: { query: "", stage: "ALL" },
  prefs: readPrefs(),
  installPrompt: null,
  dragId: null,
  internships: { listings: [], generatedAt: "", source: "" }
};

async function loadInternships() {
  try {
    const response = await fetch("internships.json", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    state.internships = {
      listings: Array.isArray(data.listings) ? data.listings : [],
      generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : "",
      source: typeof data.source === "string" ? data.source : ""
    };
  } catch {
    // Offline, or the feed hasn't been generated yet: Today just omits the section below.
  }
  if (state.route.view === "today") rerender();
}

function savePrefs() {
  const { goal, name, targetRole, season, targetCompanies, started, focusAreas, digestEmail, dueSoonAlerts, lastDueAlert, sort, newsFilter } = state.prefs;
  // storage.set returns false (it never throws) when the write is rejected, e.g. a full or blocked
  // store. Return that result so onboarding can report a failed preferences write honestly rather
  // than assuming it landed. The goal/theme mirrors are best-effort and do not change the result.
  const saved = storage.set(KEYS.prefs, JSON.stringify({ goal, name, targetRole, season, targetCompanies, started, focusAreas, digestEmail, dueSoonAlerts, lastDueAlert, sort, newsFilter }));
  storage.set(KEYS.goal, String(goal));
  storage.set(KEYS.theme, state.prefs.theme);
  return saved;
}

const find = id => state.applications.find(entry => entry.id === id);
const findDeleted = id => state.deleted.find(entry => entry.id === id);

function replaceApplications(updated) {
  const byId = new Map(updated.map(entry => [entry.id, entry]));
  state.applications = state.applications.map(entry => byId.get(entry.id) || entry);
}

/* ==========================================================================
   6b. Demo-first onboarding: existing-work check and first-run classification
   ==========================================================================
   A visitor is "returning" the moment they have any real work to protect: an active page, a
   recoverable Recently Deleted page, a pending draft, or a set "started" flag from a past setup.
   Only a visitor with none of those and no started flag is "new" and sees the demo. This reads
   real storage through the existing readers; it is never given the demo copy. It must run only
   after a successful api.read() - a StorageCorruptedError is handled by the existing recovery path
   before this is ever reached, so corrupted data is never mistaken for an empty (new) notebook. */
function isNewVisitor(record) {
  return isNewVisitorPure({ browserMode: BROWSER_MODE, record, drafts: readDrafts(), started: readPrefs().started });
}

/* ==========================================================================
   6c. Demo backend and active-API indirection
   ==========================================================================
   The demo is backed by a separate in-memory notebook. demoApi reuses the real browserApi methods
   (create/update/remove/restore/setStatus/importBackup/...), which are all read-modify-write on top
   of read()/write(); overriding only read() and write() to use state.demo redirects the whole object
   to memory. Crucially, demoApi.write never calls storage.set and never notifies the cloud write
   listener (that listener runs only inside the real browserApi.write, after persistence, so it could
   not veto a write anyway). The real api/browserApi used by cloud sync are left untouched.

   activeApi points at the demo backend while the demo is on and at the real api otherwise. Mutation
   handlers call activeApi so they work unchanged in both modes. load() and the cloud
   copy-choice always use the real api and are never invoked while the demo is active.

   demoSession is bumped on every enter/exit. Delayed callbacks (undo toasts, autosave retry timers)
   captured during the demo check the session they were created in, so a demo-era callback can never
   run against the real backend after the visitor leaves the demo. */
let demoStore = null; // the demo backend's own in-memory record, detached from the visible arrays
const demoApi = {
  ...browserApi,
  read() {
    const data = demoStore || { applications: [], recentlyDeleted: [], nextId: 1 };
    // Return copies so callers (the real browserApi methods reused here) never mutate demoStore in
    // place - mirrors how browserApi.read() returns freshly normalized objects, not storage aliases.
    return {
      nextId: data.nextId,
      applications: data.applications.map(entry => ({ ...entry })),
      recentlyDeleted: data.recentlyDeleted.map(entry => ({ ...entry }))
    };
  },
  write(data) {
    // Memory only: never storage.set, never the cloud write listener. This is the isolation. The
    // record is stored detached from state.applications/state.deleted so the existing handlers can
    // update the visible arrays exactly once, the same way they do against the real backend.
    demoStore = {
      nextId: data.nextId,
      applications: data.applications.map(entry => ({ ...entry })),
      recentlyDeleted: data.recentlyDeleted.map(entry => ({ ...entry }))
    };
  },
  async load() {
    const data = this.read();
    return { applications: data.applications, deleted: data.recentlyDeleted };
  }
};

let activeApi = api;
let demoSession = 0;
/** The session token callers capture so a delayed callback can tell if the demo it belonged to is
 *  still active. Any session change (enter or exit) invalidates older demo-era callbacks. */
const currentSession = () => demoSession;
const sessionActive = token => token === demoSession;

const inDemo = () => state.demoMode;

/** Enter the demo: build a fresh in-memory dataset, point activeApi at the demo backend, and bump
 *  the session so any earlier delayed callback is invalidated. Leaves real storage untouched. */
function enterDemoMode() {
  if (!BROWSER_MODE) return false;
  let dataset;
  try {
    dataset = buildDemoDataset();
  } catch {
    return false; // caller shows the fallback onboarding view instead of a broken demo
  }
  if (!dataset || !dataset.applications.length) return false;
  demoSession++;
  state.demoMode = true;
  activeApi = demoApi;
  // Seed the demo backend's own record from the dataset, then populate the visible arrays from a
  // detached read. The visible arrays are independent copies, so the existing handlers update them
  // once (push/filter) just as they do in real mode - no aliasing, no double-counting.
  demoStore = { nextId: dataset.nextId, applications: dataset.applications, recentlyDeleted: dataset.recentlyDeleted };
  state.realApplications = state.applications;
  state.realDeleted = state.deleted;
  const seeded = demoApi.read();
  state.applications = seeded.applications;
  state.deleted = seeded.recentlyDeleted;
  state.demo = demoStore;
  return true;
}

/** Leave the demo for the real notebook: restore the real backend, discard the in-memory copy, and
 *  bump the session so demo-era timers/undo callbacks become no-ops. No real write ever happens. */
function exitDemoMode() {
  if (!state.demoMode) return;
  demoSession++;
  state.demoMode = false;
  // Restore the real notebook arrays captured on entry; discard the in-memory demo copy entirely.
  state.applications = state.realApplications || [];
  state.deleted = state.realDeleted || [];
  state.realApplications = null;
  state.realDeleted = null;
  state.demo = null;
  demoStore = null;
  activeApi = api;
  // Drop any autosave retry timers scheduled against demo IDs so they never fire on the real backend.
  for (const timer of retryTimers.values()) window.clearTimeout(timer);
  retryTimers.clear();
}

/** Wraps a delayed callback (an undo action, a timer) so it runs only if the demo session it was
 *  created in is still current. A demo-era undo clicked after leaving the demo becomes a no-op, so a
 *  demo ID can never reach the real backend. Outside the demo (session token captured while not in
 *  demo) it always runs, because exiting the demo is the only thing that invalidates it. */
function demoBound(fn) {
  const session = currentSession();
  const wasDemo = inDemo();
  return (...args) => {
    if (wasDemo && !sessionActive(session)) return;
    return fn(...args);
  };
}

/** "Build my notebook": open the builder. The demo keeps running behind it and only ends when the
 *  real notebook is created, so a visitor who backs out of the builder is still in the demo. The
 *  started flag is set only on a successful create, so leaving early changes nothing. */
function startMyNotebook() {
  if (!BROWSER_MODE) return;
  go("#/build");
}

/* ==========================================================================
   7. Theme
   ========================================================================== */
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function resolvedTheme() { return state.prefs.theme === "system" ? (darkQuery.matches ? "dark" : "light") : state.prefs.theme; }
function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  $$('meta[name="theme-color"]').forEach(meta => meta.setAttribute("content", theme === "dark" ? "#14110d" : "#f3eee4"));
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

function appCard(entry, index = 0, { selectable = false, draggable = false, compact = false, showMove = false } = {}) {
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
      ${showMove ? `<button class="button small move-button" type="button" data-action="move-menu" data-id="${entry.id}" aria-haspopup="menu">${icon("move")}<span>Move to…</span></button>` : ""}
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

/** Persistent demo banner shown in every view while the demo is active. It labels the view as a
 *  demo, gives the primary "Start my notebook" action, and offers sign-up only as a low-key,
 *  non-blocking link (no wall). */
function demoBanner() {
  return `
    <div class="demo-banner" role="region" aria-label="Interactive demo">
      <div class="demo-banner-text">
        <strong>You're exploring a demo.</strong>
        <span>This is sample data to show you around. Nothing here is saved to your notebook.</span>
      </div>
      <div class="demo-banner-actions">
        <button class="button primary" type="button" data-action="build-notebook">${icon("plus")}<span>Build my notebook</span></button>
        <a class="text-button" href="#/signup" data-action="demo-signup">Sign up</a>
      </div>
    </div>`;
}

const newButton = (label = "New application") => `<button class="button primary" type="button" data-action="new">${icon("plus")}<span>${label}</span></button>`;
const selectButton = scope => `<button class="button ghost" type="button" data-action="start-select" data-scope="${scope}" ${state.selecting && state.selectScope === scope ? 'aria-pressed="true"' : ""}>${icon("select")}<span>Select</span></button>`;

/* ==========================================================================
   10. Views
   ========================================================================== */
function nextStepActions(entry) {
  return entry.nextStep.trim() ? `<div class="view-actions next-step-actions">
    <button class="button small" type="button" data-action="complete-next" data-id="${entry.id}">${icon("check")}Done</button>
    <button class="button small ghost" type="button" data-action="reschedule-next" data-id="${entry.id}">${icon("calendar")}Reschedule</button>
  </div>` : "";
}

function viewToday() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = timeGreeting(hour);
  const name = state.prefs.name.trim();
  const dateLine = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const head = viewHead({
    eyebrow: esc(dateLine),
    title: `${greeting}${name ? `, ${esc(name)}` : ""}<span class="dot">.</span>`,
    actions: newButton()
  });

  // Focus areas from the builder rearrange Today (see todayFocus); none keeps the default layout.
  const focus = todayFocus();
  if (!state.applications.length) {
    const news = focus.showNews ? newsCard() : "";
    return `${head}
      ${focus.newsFirst ? news : ""}
      <section class="card welcome">
        <div class="sticky-note" aria-hidden="true">Tip: press <b>N</b> anywhere to start a new page.</div>
        <p class="eyebrow">Welcome</p>
        <h2>Every internship application, one tidy notebook.</h2>
        <p>Add a role you're interested in, move it along as you apply and interview, and keep notes for each one. Your entries ${BROWSER_MODE
          ? "stay private in this browser unless you explicitly sync in Settings."
          : "are saved on this computer by the notebook server."}</p>
        <ol class="welcome-steps">
          <li><strong>Save roles</strong>Add companies and deadlines as you find them.</li>
          <li><strong>Track each stage</strong>Drag cards from Saved to Applied, Interview, and Offer.</li>
          <li><strong>Keep your notes</strong>Each application gets its own lined page for prep and contacts.</li>
        </ol>
        <div class="welcome-actions">
          ${newButton("Save your first internship")}
          <a class="button ghost" href="#/settings">${icon("install")}<span>Install as an app</span></a>
        </div>
      </section>
      ${focus.newsFirst ? "" : news}`;
  }

  const stats = metrics(state.applications);
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

  const week = weekActivity(state.applications);
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

  const upcoming = agendaItems(state.applications).slice(0, focus.deadlines ? 5 : 3);
  const upcomingCard = `
    <section class="card upcoming-card${focus.deadlines ? " focus-card" : ""}" aria-labelledby="upcoming-title">
      <div class="card-head"><div><h2 class="card-title" id="upcoming-title">Next up</h2><p class="card-note">Your soonest deadlines and next steps</p></div></div>
      ${upcoming.length ? `<div class="agenda-items">${upcoming.map(item => {
          const days = daysUntil(item.date);
          const dayLabel = days < 0 ? "Overdue" : days === 0 ? "Today" : days === 1 ? "Tomorrow" : formatDay(item.date, { weekday: "short" });
          return `
          <div class="agenda-row"><button class="agenda-item" type="button" data-open="${item.entry.id}">
            <span class="agenda-kind st-${item.kind === "deadline" ? "SAVED" : item.entry.status}">${icon(item.kind === "deadline" ? "clock" : "flag")}</span>
            <span class="agenda-text"><strong>${esc(item.kind === "deadline" ? `Apply to ${item.entry.company}` : item.entry.nextStep || `Next step with ${item.entry.company}`)}</strong>
            <span>${esc(dayLabel)} · ${esc(item.entry.role)}</span></span>
          </button>${item.kind === "next" ? nextStepActions(item.entry) : ""}</div>`;
        }).join("")}</div>`
      : `<p class="empty-note">Nothing dated yet. Add a deadline or a next step (like an interview date) to a page.</p>`}
      <p class="card-note" style="margin-top:10px">Full agenda and nudges moved to <a href="#/board">Board</a>.</p>
    </section>`;

  const recent = [...state.applications].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 4);
  const recentCard = `
    <section class="card recent-card" aria-labelledby="recent-title">
      <div class="card-head"><div><h2 class="card-title" id="recent-title">Recently edited</h2><p class="card-note">Jump back into a page</p></div><a class="text-button" href="#/notebook">All pages</a></div>
      <div class="recent-list">${recent.map((entry, index) => appCard(entry, index, { compact: true })).join("")}</div>
    </section>`;

  const news = focus.showNews ? newsCard() : "";
  // "This week" is a half-width card. When "Next up" has moved to the top, Recently edited takes
  // its place beside it; with nothing left to pair with (deadlines + minimal) it spans the row.
  const partner = focus.deadlines ? (focus.minimal ? "" : recentCard) : upcomingCard;
  const practice = practiceCard(focus);
  const sections = [
    focus.deadlines ? upcomingCard : "",
    focus.interviews ? interviewsCard() : "",
    focus.interviews ? practice : "",
    focus.responses ? responsesCard(stats) : "",
    focus.newsFirst ? news : "",
    strip,
    partner ? goalCard : goalCard.replace('class="card goal-card"', 'class="card goal-card focus-card"'),
    partner,
    focus.interviews ? "" : practice,
    focus.newsFirst ? "" : news,
    focus.minimal || focus.deadlines ? "" : recentCard
  ];
  return `${head}<div class="today-grid">${sections.join("")}</div>`;
}

/**
 * How Today is arranged for the saved focus areas. With none set (every notebook made before the
 * builder) this is exactly the original layout. Each area moves its card to the top:
 * - deadlines: "Next up" leads, full width, with five items instead of three
 * - interviews: an Interviews card of interview-stage pages and their next steps
 * - responses: a Responses card with the response rate and who is still waiting
 * - openings: the latest-openings feed moves up, right after the cards above
 * - minimal: drops the optional parts (the openings feed and Recently edited), unless openings
 *   was also chosen, in which case the feed stays because it was asked for
 */
function todayFocus() {
  const areas = new Set(state.prefs.focusAreas);
  return {
    deadlines: areas.has("deadlines"),
    interviews: areas.has("interviews"),
    responses: areas.has("responses"),
    minimal: areas.has("minimal"),
    newsFirst: areas.has("openings"),
    showNews: areas.has("openings") || !areas.has("minimal")
  };
}

function interviewsCard() {
  const interviews = state.applications.filter(entry => entry.status === "INTERVIEW")
    .sort((left, right) => (left.nextStepDate || "9999-12-31").localeCompare(right.nextStepDate || "9999-12-31"));
  return `
    <section class="card focus-card interviews-card" aria-labelledby="interviews-title">
      <div class="card-head"><div><h2 class="card-title" id="interviews-title">Interviews</h2><p class="card-note">Interview-stage pages and what comes next</p></div>
        <a class="text-button" href="#/board">Board</a></div>
      ${interviews.length ? `<div class="agenda-items">${interviews.map(entry => {
          const days = entry.nextStepDate ? daysUntil(entry.nextStepDate) : null;
          const when = days === null ? "No date yet" : days < 0 ? "Overdue" : days === 0 ? "Today" : days === 1 ? "Tomorrow" : formatDay(entry.nextStepDate, { weekday: "short" });
          return `
          <div class="agenda-row"><button class="agenda-item" type="button" data-open="${entry.id}">
            <span class="agenda-kind st-INTERVIEW">${icon("flag")}</span>
            <span class="agenda-text"><strong>${esc(entry.nextStep || `Prepare for ${entry.company}`)}</strong>
            <span>${esc(when)} · ${esc(entry.company)} · ${esc(entry.role)}</span></span>
          </button>${entry.nextStep ? nextStepActions(entry) : ""}</div>`;
        }).join("")}</div>`
      : `<p class="empty-note">No interviews yet. When a page moves to Interview, it shows up here with its next step.</p>`}
    </section>`;
}

function responsesCard(stats) {
  const waiting = state.applications.filter(entry => entry.status === "APPLIED").length;
  const figure = (value, label) => `<div class="response-figure"><strong>${value}</strong><span>${label}</span></div>`;
  return `
    <section class="card focus-card responses-card" aria-labelledby="responses-title">
      <div class="card-head"><div><h2 class="card-title" id="responses-title">Responses</h2><p class="card-note">How many applications have heard back</p></div>
        <a class="text-button" href="#/insights">Insights</a></div>
      <div class="response-figures">
        ${figure(`${stats.responseRate}%`, "response rate")}
        ${figure(stats.sent, stats.sent === 1 ? "application sent" : "applications sent")}
        ${figure(waiting, "waiting to hear back")}
        ${figure(`${stats.interviewRate}%`, "reached an interview")}
      </div>
    </section>`;
}

function agendaCard() {
  const agenda = agendaItems(state.applications);
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
  return `
    <section class="card agenda-card" aria-labelledby="agenda-title">
      <div class="card-head"><div><h2 class="card-title" id="agenda-title">Coming up</h2><p class="card-note">Deadlines and next steps for the next three weeks</p></div></div>
      ${groups.length ? `<ul class="agenda">${groups.map(group => `
        <li class="agenda-day">
          <p class="agenda-date ${group.tone}">${esc(group.label)}</p>
          <div class="agenda-items">${group.items.map(item => `
            <div class="agenda-row"><button class="agenda-item" type="button" data-open="${item.entry.id}">
              <span class="agenda-kind st-${item.kind === "deadline" ? "SAVED" : item.entry.status}">${icon(item.kind === "deadline" ? "clock" : "flag")}</span>
              <span class="agenda-text"><strong>${esc(item.kind === "deadline" ? `Apply to ${item.entry.company}` : item.entry.nextStep || `Next step with ${item.entry.company}`)}</strong>
              <span>${esc(item.kind === "deadline" ? item.entry.role : `${item.entry.company} · ${item.entry.role}`)}</span></span>
            </button>${item.kind === "next" ? nextStepActions(item.entry) : ""}</div>`).join("")}</div>
        </li>`).join("")}</ul>${agenda.length > 9 ? `<p class="card-note" style="margin-top:10px">${plural(agenda.length - 9, "more item")} in <a href="#/notebook" data-action="sort-deadline">All pages</a>.</p>` : ""}`
      : `<p class="empty-note">Nothing dated yet. Add a deadline or a next step (like an interview date) to a page and it shows up here.</p>`}
    </section>`;
}

function attentionCard() {
  const attention = attentionItems(state.applications);
  return `
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
}

const TERM_SEASON_ORDER = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
function sortTerms(terms) {
  return [...terms].sort((left, right) => {
    const [seasonLeft, yearLeft] = left.split(" ");
    const [seasonRight, yearRight] = right.split(" ");
    if (yearLeft !== yearRight) return Number(yearLeft) - Number(yearRight);
    return (TERM_SEASON_ORDER[seasonLeft] ?? 9) - (TERM_SEASON_ORDER[seasonRight] ?? 9);
  });
}
const EXPERIENCE_LEVELS = [
  ["Junior", "Undergraduate or unspecified"],
  ["Intermediate", "Undergraduate or graduate"],
  ["Senior", "Graduate degree"]
];
function newsTerms() {
  return sortTerms([...new Set(state.internships.listings.flatMap(listing => listing.terms || []).filter(term => term && term !== "N/A"))]);
}

function postingKey(link) {
  try {
    const url = new URL(cleanLink(link));
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return `${url.origin}${url.pathname.replace(/\/$/, "")}${url.search}${url.hash}`;
  } catch { return ""; }
}

function newsCard() {
  const feed = state.internships;
  const filters = state.prefs.newsFilter;
  const trackedPostings = new Map(state.applications.filter(entry => entry.link).map(entry => [postingKey(entry.link), entry]));
  const safeRows = feed.listings
    .map((listing, index) => {
      let safeUrl = "";
      try { safeUrl = listing.url ? cleanLink(listing.url) : ""; } catch { safeUrl = ""; }
      const tracked = safeUrl && trackedPostings.get(postingKey(safeUrl));
      return { ...listing, index, safeUrl, tracked };
    })
    .filter(listing => listing.company && listing.role && listing.safeUrl);

  const location = filters.location.trim().toLowerCase();
  const keywords = filters.keywords.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const rows = safeRows.filter(listing =>
    (filters.term === "ALL" || (listing.terms || []).includes(filters.term))
    && (filters.degree === "ALL" || listing.experienceLevel === filters.degree)
    && (!filters.coopOnly || listing.isCoop)
    && (!location || listing.location.toLowerCase().includes(location))
    && keywords.every(word => `${listing.company} ${listing.role}`.toLowerCase().includes(word))
  );

  const modeClass = { Remote: "remote", Hybrid: "hybrid", "In-person": "onsite" };
  const termLabel = filters.term === "ALL" ? "All terms" : filters.term;
  const degreeLabel = filters.degree === "ALL" ? "Any degree eligibility" : EXPERIENCE_LEVELS.find(([value]) => value === filters.degree)?.[1] || "Any degree eligibility";
  const filterBar = safeRows.length ? `
    <div class="news-filters">
      <button class="filter-select" type="button" data-action="news-term-menu" aria-haspopup="menu">${esc(termLabel)}</button>
      <button class="filter-select" type="button" data-action="news-degree-menu" aria-haspopup="menu">${esc(degreeLabel)}</button>
      <label class="sr-only" for="news-keywords">Role or company</label>
      <input id="news-keywords" class="news-location" type="search" data-input="news-keywords" value="${esc(filters.keywords)}" maxlength="120" placeholder="Role or company" />
      <label class="sr-only" for="news-location">Location</label>
      <input id="news-location" class="news-location" type="search" data-input="news-location" value="${esc(filters.location)}" maxlength="120" placeholder="City, region, or country" />
      <label class="news-check"><input type="checkbox" data-input="news-coop" ${filters.coopOnly ? "checked" : ""} /> Co-op only</label>
      <button class="text-button" type="button" data-action="news-clear">Clear filters</button>
    </div>` : "";

  return `
    <section class="card news-card" aria-labelledby="news-title">
      <div class="card-head"><div><h2 class="card-title" id="news-title">${icon("sparkle")} Latest internship openings</h2>
        <p class="card-note">${safeRows.length ? `${plural(rows.length, "role")} shown, worldwide${feed.generatedAt ? ` · updated ${esc(timeAgo(feed.generatedAt))}` : ""}` : "A feed of recently posted internship roles"}</p></div>
      </div>
      ${filterBar}
      ${rows.length ? `<ul class="news-list">${rows.map(listing => `
        <li class="news-item">
          <div class="news-copy">
            <strong>${esc(listing.role)}</strong>
            <span>
              <span class="news-mode news-mode-${modeClass[listing.workMode] || "onsite"}">${esc(listing.workMode)}</span>
              ${listing.isCoop ? `<span class="news-tag">Co-op</span>` : ""}
              <span class="news-meta-text">${esc(listing.company)}${listing.location ? ` · ${esc(listing.location)}` : ""} · ${esc(timeAgo(listing.postedAt))}</span>
            </span>
          </div>
          <div class="news-actions">
            ${listing.tracked ? `<button class="button small" type="button" data-open="${listing.tracked.id}">Open notebook page</button>` : `<button class="button small" type="button" data-action="news-save" data-index="${listing.index}">${icon("plus")}Save to notebook</button>`}
            <a class="button ghost small" href="${esc(listing.safeUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Apply to ${esc(listing.role)} at ${esc(listing.company)} (opens in a new tab)">Apply${icon("external")}</a>
          </div>
        </li>`).join("")}</ul>`
        : `<p class="empty-note">${safeRows.length ? "No roles match these filters." : "No fresh listings right now. Check back soon."}</p>`}
      ${feed.source ? `<p class="card-note" style="margin-top:10px">Source: <a href="${esc(feed.source)}" target="_blank" rel="noopener noreferrer">Pitt CSC &amp; Simplify on GitHub</a></p>` : ""}
    </section>`;
}

function viewBoard() {
  const query = state.boardQuery.trim();
  const visible = state.applications.filter(entry => matchesQuery(entry, query));
  const narrow = window.matchMedia("(max-width: 759px)").matches;
  state.visibleIds = visible.filter(entry => !narrow || entry.status === state.boardStage).map(entry => entry.id);
  if (state.selectScope === "board") state.selected = new Set([...state.selected].filter(id => state.visibleIds.includes(id)));
  const selecting = state.selecting && state.selectScope === "board";
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const counts = countBy(visible);
  // On a narrow screen five side-by-side columns are cumbersome, so a tab strip picks one stage
  // at a time instead (CSS shows only the .active-stage column below 760px). A mouse or trackpad
  // still gets full drag-and-drop between all five; a touch screen gets an explicit "Move to..."
  // button on every card instead of relying on a drag gesture or a small menu.
  const stageTabs = `
    <div class="board-stage-tabs" role="tablist" aria-label="Pipeline stage">
      ${STAGES.map(stage => `<button type="button" role="tab" class="board-stage-tab st-${stage}" data-action="board-stage" data-stage="${stage}" aria-selected="${state.boardStage === stage}">${LABELS[stage]}<b>${counts[stage] || 0}</b></button>`).join("")}
    </div>`;
  const columns = STAGES.map(stage => {
    const entries = visible.filter(entry => entry.status === stage).sort(compareBy(stage === "SAVED" ? "deadline" : "updated"));
    return `
      <section class="column st-${stage}${state.boardStage === stage ? " active-stage" : ""}" data-stage="${stage}" aria-label="${LABELS[stage]}">
        <header class="column-head"><span class="dot"></span><h2>${LABELS[stage]}</h2><span class="count">${entries.length}</span>
          <button class="card-mini-button" type="button" data-action="new" data-stage="${stage}" aria-label="Add to ${LABELS[stage]}">${icon("plus")}</button></header>
        <div class="column-cards">
          ${entries.length ? entries.map((entry, index) => appCard(entry, index, { selectable: selecting, draggable: finePointer, showMove: !finePointer && !selecting })).join("")
            : `<p class="column-empty">${query ? "No matches" : finePointer ? "Drop a card here" : "Nothing here yet"}</p>`}
        </div>
      </section>`;
  }).join("");
  return `
    ${viewHead({ eyebrow: "Your pipeline", title: "Board", sub: `${plural(state.applications.length, "application")} across five stages.`, actions: `${selectButton("board")}${newButton()}` })}
    <div class="today-grid board-lists">${agendaCard()}${attentionCard()}</div>
    <div class="toolbar">
      <label class="search-box">${icon("search")}<span class="sr-only">Filter the board</span><input type="search" data-input="board-query" value="${esc(state.boardQuery)}" placeholder="Filter by company, role, or skill" /></label>
      ${finePointer ? `<p class="drag-hint">Drag cards between columns to change their stage.</p>` : ""}
    </div>
    ${stageTabs}
    <div class="board" id="board">${columns}</div>`;
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
  const data = Array.from({ length: weeks }, (_, index) => weekActivity(state.applications, index - weeks + 1));
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
    ["Interview", stats.interviews],
    ["Offer", list.filter(entry => sentAt(entry) && reached(entry, "OFFER")).length]
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
    if (sentAt(entry)) row.sent++;
    if (sentAt(entry) && reached(entry, "INTERVIEW")) row.interviews++;
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

/** Shown instead of the notebook when this browser's saved data cannot be read (see StorageCorruptedError). */
function viewRecovery(corrupted) {
  return `
    <div class="card recovery" role="alert" style="margin-top:24px">
      ${emptyState({
        iconName: "alert",
        title: "This browser's saved notebook could not be read",
        copy: "This can happen if a tab closed in the middle of a save, or if the browser ran out of storage space. Nothing has been deleted: the original data is still here, kept exactly as found, and you can download it below."
      })}
      <div class="welcome-actions" style="justify-content:center;margin-top:6px">
        <button class="button" type="button" data-action="download-corrupted">${icon("download")}Download the raw data</button>
        <button class="button ghost" type="button" data-action="recovery-import">${icon("upload")}Import a backup instead</button>
        <button class="button danger-soft" type="button" data-action="recovery-reset">Start a new notebook</button>
      </div>
    </div>`;
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

      ${cloudSettings()}

      <section class="card">
        <h2 class="card-title" style="margin-bottom:10px">Your data</h2>
        <div class="setting-row"><div><strong>${BROWSER_MODE ? "Private to this browser" : "Saved on this computer"}</strong>
          <p>${BROWSER_MODE
            ? "Pages are stored in this browser profile on this device. Cloud sync only copies them when you choose Sync now in Settings. Anyone using this same unlocked browser profile can see the local copy. Use a separate profile on a shared device, and download backups to keep another copy."
            : "The Java server saves pages to data/applications.tsv in the project folder."}</p></div></div>
        <div class="setting-row"><div><strong>Backup</strong><p>A single file with every page, including notes and history.</p></div>
          <div class="view-actions">
            <button class="button" type="button" data-action="export-json">${icon("download")}Download backup</button>
            <button class="button ghost" type="button" data-action="import-json">${icon("upload")}Import backup</button>
          </div></div>
        <div class="setting-row"><div><strong>Spreadsheet</strong><p>Export a CSV you can open in Excel, Numbers, or Google Sheets.</p></div>
          <button class="button ghost" type="button" data-action="export-csv">${icon("file")}Export CSV</button></div>
        ${BROWSER_MODE ? `<div class="setting-row"><div><strong>Reminders and exports</strong><p>A calendar file with real reminders, a Markdown copy, a printable sheet, and a weekly digest you email to yourself.</p></div>
          <a class="button ghost" href="#/export">${icon("calendar")}<span>Open</span></a></div>` : ""}
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

      <p class="muted" style="font-size:.82rem">My Internship Notebook · <a href="privacy.html">Privacy</a> · <a href="delete-account.html">Account deletion</a> · <a href="https://github.com/will-iam08/internship-notebook" target="_blank" rel="noopener noreferrer">Source on GitHub</a></p>
    </div>`;
}

const cloud = createCloudClient({ ...(BROWSER_MODE ? readCloudConfig() : {}), fetch: globalThis.fetch.bind(globalThis) });
let cloudBusy = false;
let cloudStatus = "Not signed in";
let cloudError = "";

function cloudSettings() {
  if (!BROWSER_MODE || !cloud.enabled) return "";
  const signedIn = Boolean(cloud.session());
  const disabled = cloudBusy || inDemo() ? "disabled" : "";
  return `<section class="card cloud-sync" aria-labelledby="cloud-sync-title">
    <h2 class="card-title" id="cloud-sync-title">Cloud sync</h2>
    <p class="card-note">Optional: sign in, then choose Sync now. The newer notebook replaces the older copy across devices. Download a backup first if you need to keep both.</p>
    ${inDemo() ? `<p>Finish building your notebook or leave the demo before syncing.</p>` : ""}
    ${signedIn ? `<p>${esc(cloud.session().user.email || "Signed in")}</p>
      <div class="view-actions"><button class="button primary" type="button" data-action="cloud-sync" ${disabled}>Sync now</button>
        <button class="button ghost" type="button" data-action="cloud-signout" ${disabled}>Sign out</button></div>` : `
      <form id="cloud-signin" class="cloud-sync-form">
        <label class="field"><span class="field-label">Email</span><input id="cloud-email" type="email" autocomplete="username" maxlength="254" required ${disabled} /></label>
        <label class="field"><span class="field-label">Password</span><input id="cloud-password" type="password" autocomplete="current-password" required ${disabled} /></label>
        <button class="button" type="submit" ${disabled}>Sign in</button>
      </form>`}
    <p role="status" data-cloud-status>${esc(cloudStatus)}</p>
    ${cloudError ? `<p class="field-error" role="alert">${esc(cloudError)}</p>` : ""}
  </section>`;
}

async function runCloud(action) {
  if (!cloud.enabled || cloudBusy || inDemo()) return;
  cloudBusy = true;
  cloudError = "";
  cloudStatus = "Syncing…";
  rerender();
  try { await action(); }
  catch (error) {
    cloudError = error.message;
    cloudStatus = /offline/i.test(error.message) || !navigator.onLine ? "Offline" : cloud.session() ? "Sync failed" : "Not signed in";
  } finally {
    cloudBusy = false;
    if (state.route.view === "settings") rerender();
  }
}

function signInCloud() {
  const email = $("#cloud-email")?.value.trim() || "";
  const password = $("#cloud-password")?.value || "";
  return runCloud(async () => {
    if (!email || !password) throw new Error("Enter your email and password.");
    await cloud.signIn(email, password);
    cloudStatus = "Signed in";
  });
}

async function syncCloudNotebook() {
  await retryPendingDrafts();
  await saveChain;
  if (Object.keys(readDrafts()).length) throw new Error("Save pending edits before syncing.");
  const local = browserApi.read();
  const original = JSON.stringify(local);
  // Older local notebooks have no notebook clock; start from their latest surviving page edit.
  const updatedAt = local.updatedAt || [...local.applications, ...local.recentlyDeleted]
    .flatMap(entry => [entry.updatedAt, entry.deletedAt]).filter(value => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1) || new Date(0).toISOString();
  const result = await cloud.sync({ ...local, updatedAt });
  if (JSON.stringify(browserApi.read()) !== original || Object.keys(readDrafts()).length || inDemo()) {
    throw new Error("Your local notebook changed. Your edits are kept; sync again.");
  }
  if (result.action === "pulled") {
    const record = result.notebook;
    if (!Array.isArray(record.applications) || !Array.isArray(record.recentlyDeleted)) throw new Error("Cloud notebook is invalid.");
    const ids = new Set();
    const clean = list => list.map(raw => {
      const { entry } = sanitizeImportedEntry(raw);
      if (!entry || !Number.isSafeInteger(entry.id) || entry.id < 1 || ids.has(entry.id)) throw new Error("Cloud notebook is invalid.");
      ids.add(entry.id);
      return entry;
    });
    const applications = clean(record.applications);
    const recentlyDeleted = clean(record.recentlyDeleted);
    const largestId = Math.max(0, ...ids);
    const nextId = Number.isSafeInteger(record.nextId) && record.nextId > largestId ? record.nextId : largestId + 1;
    browserApi.write({ nextId, applications, recentlyDeleted }, record.updatedAt);
    await load();
  }
  cloudStatus = "Synced just now";
}

function viewEntry(id) {
  const stored = find(id);
  if (!stored) {
    const deleted = findDeleted(id);
    return `<div class="entry"><div class="card not-found">${deleted
      ? emptyState({ iconName: "trash", title: "This page is in Recently Deleted", copy: `${esc(deleted.company)} can be restored for ${esc(daysLeft(deleted.deletedAt).replace(" left", ""))}.`, action: `<button class="button primary" type="button" data-action="restore" data-id="${deleted.id}">${icon("restore")}Restore page</button>` })
      : emptyState({ iconName: "notebook", title: "Page not found", copy: "It may have been deleted permanently.", action: `<a class="button" href="#/notebook">Back to all pages</a>` })}</div></div>`;
  }
  // A draft that never got confirmed (the save failed, or the app closed before it ran) shows here
  // in place of the last-saved values, so opening the page never looks like the edit was lost.
  const draft = readDrafts()[id]?.changes;
  const entry = draft ? { ...stored, ...draft } : stored;
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
  // A date is a native date input (keyboard, picker, and locale handled by the browser) with a
  // visible placeholder while empty and a clear button once set. The label is a separate element
  // so the clear button is not inside it.
  const dateField = (name, label, iconName, placeholder) => `
    <div class="line-field date-field${entry[name] ? " has-value" : ""}">
      <label class="line-label" for="entry-${name}">${icon(iconName)}${label}</label>
      <div class="date-control">
        <input type="date" id="entry-${name}" data-field="${name}" value="${esc(entry[name])}" />
        <span class="date-placeholder" aria-hidden="true">${placeholder}</span>
        <button class="icon-button date-clear" type="button" data-action="clear-date" data-clear="${name}" aria-label="Clear ${label.toLowerCase()}">${icon("x")}</button>
      </div>
    </div>`;
  const history = collapseHistory(entry.history);
  const timeline = [...history].reverse().map((change, index, list) => {
    const first = index === list.length - 1;
    return `<li class="st-${change.status}"><strong>${first ? `Added as ${LABELS[change.status]}` : `Moved to ${LABELS[change.status]}`}</strong>
      <time datetime="${esc(change.at)}" title="${esc(formatDateTime(change.at))}">${esc(timeAgo(change.at))}</time></li>`;
  }).join("");
  const rejected = entry.status === "REJECTED";
  return `
    <article class="entry" data-entry="${entry.id}">
      <nav class="entry-nav" aria-label="Page actions">
        <a class="back" href="${state.backRoute}">${icon("back")}${backLabel}</a>
        <span class="save-state" id="save-state" aria-live="polite">${icon("check")}<span>${BROWSER_MODE ? "Saved locally" : "Synced"}</span></span>
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
          <div class="stepper" role="group" aria-label="Stage">
            <div class="steps${rejected ? " is-rejected" : ""}">${steps}</div>
          </div>
          ${rejected ? `<p class="entry-rejected">${pill("REJECTED")}<span>This application was rejected.</span>
            <button class="text-button" type="button" data-action="set-status" data-stage="${beforeRejection}">Reopen as ${LABELS[beforeRejection]}</button></p>` : ""}
        </header>
        <div class="entry-body">
          <div class="entry-main">
            <section class="entry-group" aria-labelledby="group-role">
              <h2 class="section-label" id="group-role">The role</h2>
              <div class="entry-fields">
                ${field("location", "Location", "pin", { placeholder: "City or Remote" })}
                ${field("source", "Found on", "globe", { placeholder: "LinkedIn, referral…", extra: 'list="source-options"' })}
                ${field("link", "Job posting", "link", { type: "url", placeholder: "Paste the link", extra: 'inputmode="url"' })}
                ${field("contact", "Contact", "user", { placeholder: "Recruiter, referral…" })}
              </div>
            </section>
            <section class="entry-group" aria-labelledby="group-dates">
              <h2 class="section-label" id="group-dates">Dates</h2>
              <div class="entry-fields">
                ${dateField("deadline", "Deadline", "clock", "Set a deadline")}
                ${dateField("nextStepDate", "Next step date", "calendar", "Set a date")}
                ${field("nextStep", "Next step", "flag", { placeholder: "e.g. Technical interview", size: "wide" })}
              </div>
              <div id="entry-next-actions">${nextStepActions(entry)}</div>
            </section>
            <section class="entry-group" aria-labelledby="group-notes">
              <h2 class="section-label" id="group-notes">Notes</h2>
              <p class="field-caption" id="skills-caption">Skills</p>
              <div class="skills-editor" id="skills-editor" role="group" aria-labelledby="skills-caption">
                ${entry.skills.map(skill => `<span class="skill-chip">${esc(skill)}<button type="button" data-action="remove-skill" data-skill="${esc(skill)}" aria-label="Remove ${esc(skill)}">${icon("x")}</button></span>`).join("")}
                <input type="text" id="skill-input" placeholder="${entry.skills.length ? "Add another…" : "Add skills, press Enter"}" aria-label="Add a skill" maxlength="40" />
              </div>
              <label class="sr-only" for="entry-notes">Notes</label>
              <textarea class="notes-area" id="entry-notes" data-field="notes" maxlength="${LIMITS.notes}" placeholder="Interview prep, questions to ask, people you met, how it went…">${esc(entry.notes)}</textarea>
            </section>
          </div>
          <aside class="entry-rail" aria-labelledby="timeline-title">
            <h2 class="section-label" id="timeline-title">Timeline</h2>
            <ol class="timeline" tabindex="0" aria-labelledby="timeline-title">${timeline}</ol>
          </aside>
        </div>
        ${BROWSER_MODE ? prepCard(entry) : ""}
        <footer class="entry-foot">
          <span>Created ${esc(formatDateTime(entry.createdAt))} · Edited <span data-edited>${esc(timeAgo(entry.updatedAt))}</span></span>
          <button class="button small danger-soft" type="button" data-action="delete" data-id="${entry.id}">${icon("trash")}Move to Recently Deleted</button>
        </footer>
      </div>
    </article>`;
}

/* ---------- Interview prep (application page and Today, website edition) ----------
   Progress is stored on the page's optional `interview` field and saved through the same draft and
   autosave path as every other field, so it is local, undoable by editing, and part of every backup.
   The Java server has no such field, so the Server Edition shows no prep UI. */
function prepQuestion(entryId, question, record, { compact = false } = {}) {
  const status = record?.status || "new";
  const note = record?.note || "";
  const mark = (value, iconName, label) => `<button class="prep-mark ${value}" type="button" data-action="prep-mark" data-id="${entryId}"
    data-question="${question.id}" data-status="${value}" aria-pressed="${status === value}">${icon(iconName)}<span>${label}</span></button>`;
  return `
    <li class="prep-q${status === "new" ? "" : ` is-${status}`}" data-question="${question.id}">
      <p class="prep-text" id="prep-text-${question.id}">${esc(question.text)}</p>
      <div class="prep-actions" role="group" aria-labelledby="prep-text-${question.id}">
        ${mark("practiced", "check", "Practiced")}${mark("stuck", "flag", "Stuck")}
        ${compact ? "" : `<button class="text-button prep-note-toggle" type="button" data-action="prep-note" data-question="${question.id}"
          aria-expanded="${Boolean(note)}" aria-controls="prep-note-${question.id}">${note ? "Note" : "Add note"}</button>`}
      </div>
      ${compact ? "" : `<label class="prep-note" id="prep-note-${question.id}"${note ? "" : " hidden"}><span class="sr-only">Note for: ${esc(question.text)}</span>
        <textarea rows="2" maxlength="${INTERVIEW_NOTE_LIMIT}" data-prep-note="${question.id}" placeholder="The story you'll tell, or a fact to mention">${esc(note)}</textarea></label>`}
    </li>`;
}

/** Which groups start open on a page: the one the stage leads with, unless the visitor chose. */
function prepOpenGroups(entry) {
  if (!state.prepOpen[entry.id]) state.prepOpen[entry.id] = new Set([questionsFor(entry, { limit: 1 })[0]?.group || "behavioral"]);
  return state.prepOpen[entry.id];
}

function prepCard(entry) {
  const progress = cleanInterview(entry.interview);
  const groups = questionsByGroup(entry.role);
  const summary = interviewSummary(entry);
  const only = state.prepOnlyToPractice;
  const open = prepOpenGroups(entry);
  const statusOf = question => progress[question.id]?.status || "new";
  return `
    <section class="prep" id="prep" aria-labelledby="prep-title">
      <div class="prep-head">
        <div><p class="section-label" id="prep-title">Interview prep</p>
          <p class="prep-sub">Practice out loud, then mark each question. Your progress stays with this page, in this browser.</p></div>
        <label class="prep-filter"><input type="checkbox" data-prep-filter${only ? " checked" : ""} /><span>Only to practice</span></label>
      </div>
      <div class="prep-progress">
        <div class="prep-bar" role="progressbar" aria-label="Questions practiced" aria-valuemin="0" aria-valuemax="${summary.total}"
          aria-valuenow="${summary.practiced}" aria-valuetext="${esc(summary.text)}"><i style="width:${summary.percent}%"></i></div>
        <p class="prep-summary">${esc(summary.text)}</p>
      </div>
      ${QUESTION_GROUPS.map(group => {
        const questions = groups[group.id];
        const shown = only ? questions.filter(question => statusOf(question) !== "practiced") : questions;
        const done = questions.filter(question => statusOf(question) === "practiced").length;
        return `
        <details class="prep-group" data-group="${group.id}"${open.has(group.id) ? " open" : ""}>
          <summary><span>${esc(group.label)}</span><span class="prep-count">${done} of ${questions.length}</span></summary>
          <p class="prep-hint">${esc(group.hint)}</p>
          ${shown.length ? `<ol class="prep-list">${shown.map(question => prepQuestion(entry.id, question, progress[question.id])).join("")}</ol>`
            : `<p class="empty-note">${icon("check", "inline")} Every question here is practiced.</p>`}
        </details>`;
      }).join("")}
    </section>`;
}

/** Re-draws the prep card in place (not the whole page), keeping focus on the control in use. */
function refreshPrep(entry) {
  const card = $("#prep");
  if (!card) return;
  const active = document.activeElement;
  const key = active?.closest?.("#prep") ? { action: active.dataset.action, question: active.dataset.question, status: active.dataset.status, filter: active.matches("[data-prep-filter]") } : null;
  card.outerHTML = prepCard(entry);
  if (!key) return;
  const selector = key.filter ? "#prep [data-prep-filter]"
    : `#prep [data-action="${key.action}"][data-question="${key.question}"]${key.status ? `[data-status="${key.status}"]` : ""}`;
  ($(selector) || $("#prep-title"))?.focus?.();
}

/** Marks a question for a page. On that page it goes through the autosave queue like any field;
 *  from Today it saves straight through the active backend. */
async function setPrepStatus(id, questionId, status) {
  const entry = find(id);
  if (!entry) return;
  const onPage = state.route.view === "entry" && state.route.id === id;
  const current = onPage ? draftValue(id, "interview", entry.interview) : entry.interview;
  const next = withQuestionStatus(current, questionId, status);
  const marked = next[questionId]?.status === status;
  if (onPage) {
    queueChange("interview", next, { immediate: true });
    refreshPrep({ ...entry, interview: next });
  } else {
    try {
      replaceApplications([await activeApi.update(id, { interview: next })]);
      rerender();
      $(".practice-card .prep-mark")?.focus();
    } catch (error) { fail(error); return; }
  }
  announce(marked ? `Marked ${status}` : "Cleared");
}

/** The page "Practice next" draws from: the soonest interview, else (when the visitor asked for
 *  interview help) the most recently edited open application. */
function practiceTarget(focus) {
  const byDate = (left, right) => (left.nextStepDate || "9999-12-31").localeCompare(right.nextStepDate || "9999-12-31");
  const interviews = state.applications.filter(entry => entry.status === "INTERVIEW").sort(byDate);
  if (interviews.length) return interviews[0];
  if (!focus.interviews) return null;
  const open = state.applications.filter(entry => entry.status === "APPLIED" || entry.status === "SAVED")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return open[0] || null;
}

function practiceCard(focus) {
  if (!BROWSER_MODE) return "";
  const target = practiceTarget(focus);
  if (!target) return "";
  const progress = cleanInterview(target.interview);
  const questions = questionsFor(target, { limit: 3, toPractice: true });
  const summary = interviewSummary(target);
  return `
    <section class="card focus-card practice-card" aria-labelledby="practice-title">
      <div class="card-head"><div><h2 class="card-title" id="practice-title">Practice next</h2>
        <p class="card-note">For ${esc(target.company)} · ${esc(summary.text)}</p></div>
        <button class="text-button" type="button" data-action="open-prep" data-id="${target.id}">All questions</button></div>
      ${questions.length ? `<ol class="prep-list">${questions.map(question => prepQuestion(target.id, question, progress[question.id], { compact: true })).join("")}</ol>`
        : `<p class="empty-note">${icon("check", "inline")} Every question for ${esc(target.company)} is practiced.</p>`}
    </section>`;
}

/* ==========================================================================
   10a. Reminders and exports (#/export, website edition)
   ==========================================================================
   The site has no server, so this page hands reminders to apps that can deliver them: a calendar
   file, a Markdown copy, a printable sheet, and a digest the visitor emails to themselves from their
   own mail app. The copy says plainly what the site cannot do (send email, run in the background).
   The one in-site reminder is a notification shown when the notebook is opened, if allowed. */
function notificationPermission() {
  return "Notification" in window ? Notification.permission : "unsupported";
}

function exportCard({ iconName, title, copy, note = "", actions }) {
  return `
    <section class="card export-card">
      <span class="export-mark" aria-hidden="true">${icon(iconName)}</span>
      <div class="export-body">
        <h2 class="card-title">${title}</h2>
        <p>${copy}</p>
        ${note ? `<p class="export-note">${note}</p>` : ""}
        <div class="export-actions">${actions}</div>
      </div>
    </section>`;
}

function dueAlertsControl() {
  const permission = notificationPermission();
  const on = state.prefs.dueSoonAlerts && permission === "granted";
  const status = permission === "unsupported" ? "This browser doesn't support notifications."
    : permission === "denied" ? "Notifications are blocked for this site. Allow them in your browser's site settings, then turn this on."
    : on ? "On. Checked once a day, when you open the notebook."
    : "Off. Your browser will ask for permission when you turn it on.";
  return `
    <div class="export-switch">
      <button class="switch" type="button" role="switch" aria-checked="${on}" data-action="toggle-due-alerts" aria-describedby="due-alerts-status"
        ${permission === "unsupported" ? "disabled" : ""}><span class="switch-knob" aria-hidden="true"></span><span>Due-soon notification</span></button>
      ${on ? `<button class="button small ghost" type="button" data-action="check-due-now">Check now</button>` : ""}
    </div>
    <p class="export-note" id="due-alerts-status">${status}</p>`;
}

function printSheet() {
  const now = new Date();
  const pages = [...state.applications].sort((left, right) => STAGES.indexOf(left.status) - STAGES.indexOf(right.status) || left.company.localeCompare(right.company));
  const coming = state.applications.flatMap(entry => upcomingActions(entry, { now }).map(action => ({ ...action, entry })))
    .sort((left, right) => left.at - right.at).slice(0, 20);
  return `
    <section class="print-sheet" aria-hidden="true">
      <h1>${esc(state.prefs.name ? `${state.prefs.name}'s internship notebook` : "My internship notebook")}</h1>
      <p>Printed ${esc(now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))} · ${plural(pages.length, "application")}</p>
      ${coming.length ? `<h2>Coming up</h2><ul>${coming.map(item => `<li><b>${esc(shortDate(item.at))}</b> ${esc(item.label)} (${esc(item.entry.role)})</li>`).join("")}</ul>` : ""}
      <h2>All applications</h2>
      <table><thead><tr><th>Company</th><th>Role</th><th>Stage</th><th>Deadline</th><th>Next step</th></tr></thead><tbody>
        ${pages.map(entry => `<tr><td>${esc(entry.company)}</td><td>${esc(entry.role)}</td><td>${LABELS[entry.status]}</td><td>${esc(entry.deadline)}</td>
          <td>${esc([entry.nextStep, entry.nextStepDate].filter(Boolean).join(", "))}</td></tr>`).join("")}
      </tbody></table>
    </section>`;
}

function viewExport() {
  if (!BROWSER_MODE) return "";
  const now = new Date();
  const events = state.applications.reduce((total, entry) => total + upcomingActions(entry, { now }).length, 0);
  const digest = buildEmailDigest(state.applications, state.prefs, { now });
  const mailto = digestMailto({ to: state.prefs.digestEmail, digest });
  const empty = !state.applications.length;
  return `
    <div class="export-page">
      ${viewHead({ eyebrow: "Never miss it", title: "Reminders and exports<span class=\"dot\">.</span>",
        sub: "This notebook lives in your browser, with no server behind it. It can't send email or remind you while it's closed, so these hand the job to apps that can." })}
      <div class="export-list">
        ${exportCard({ iconName: "calendar", title: "Calendar file (.ics)",
          copy: "Adds every upcoming deadline, interview, and follow-up to Google Calendar, Apple Calendar, or Outlook, with an alert the day before and two hours before. These are real reminders on your phone and computer.",
          note: events ? `${plural(events, "upcoming event")}. Download a fresh file after you change dates.` : "Nothing dated yet. Add a deadline or a next-step date to a page first.",
          actions: `<button class="button primary" type="button" data-action="export-ics" ${events ? "" : "disabled"}>${icon("download")}<span>Download calendar file</span></button>` })}
        ${exportCard({ iconName: "mail", title: "Email me a digest",
          copy: "Opens your own mail app with this week's deadlines, follow-ups, and interviews written out and addressed to you. You press Send. This site can't send email, and your address stays in this browser.",
          actions: `
            <label class="setup-field export-email"><span>Your email</span>
              <input type="email" data-input="digest-email" value="${esc(state.prefs.digestEmail)}" placeholder="you@example.com" autocomplete="email" maxlength="254" /></label>
            <a class="button${mailto ? "" : " is-disabled"}" data-digest-link ${mailto ? `href="${esc(mailto)}"` : 'aria-disabled="true"'}>${icon("mail")}<span>Open in my mail app</span></a>
            <p class="export-note" data-digest-hint>${mailto ? "" : "Enter your email to fill in the To line."}</p>
            <details class="export-preview"><summary>Preview the digest</summary><pre>${esc(`Subject: ${digest.subject}\n\n${digest.body}`)}</pre></details>` })}
        ${exportCard({ iconName: "alert", title: "Reminders while the notebook is open",
          copy: "When you open the notebook, show a notification for anything due today or tomorrow. It only works while this site is open in a tab. For reminders that always arrive, use the calendar file.",
          actions: dueAlertsControl() })}
        ${exportCard({ iconName: "file", title: "Markdown copy",
          copy: "Every page as readable text, with a summary table at the top. Good for a notes app like Obsidian or Notion, or any text editor.",
          actions: `<button class="button" type="button" data-action="export-md" ${empty ? "disabled" : ""}>${icon("download")}<span>Download Markdown</span></button>` })}
        ${exportCard({ iconName: "notebook", title: "Print or save as PDF",
          copy: "A clean paper copy of what's coming up and every application. Choose Save as PDF in the print dialog to keep a file. Today and All pages also print neatly on their own.",
          actions: `<button class="button" type="button" data-action="print-notebook" ${empty ? "disabled" : ""}>${icon("file")}<span>Print</span></button>` })}
        ${exportCard({ iconName: "download", title: "Backup file (.json)",
          copy: "Everything, including history, in one file. Restore it on another device or browser from Settings.",
          actions: `<button class="button" type="button" data-action="export-json">${icon("download")}<span>Download backup</span></button>` })}
      </div>
      ${printSheet()}
    </div>`;
}

/** Keeps the digest link in step with the email field as the visitor types. */
function updateDigestLink() {
  const link = $("[data-digest-link]");
  if (!link) return;
  const href = digestMailto({ to: state.prefs.digestEmail, digest: buildEmailDigest(state.applications, state.prefs) });
  if (href) { link.setAttribute("href", href); link.removeAttribute("aria-disabled"); link.classList.remove("is-disabled"); }
  else { link.removeAttribute("href"); link.setAttribute("aria-disabled", "true"); link.classList.add("is-disabled"); }
  const hint = $("[data-digest-hint]");
  if (hint) hint.textContent = href ? "" : "Enter your email to fill in the To line.";
}

function exportIcs() {
  const calendar = buildIcs(state.applications, { calendarName: "Internship notebook" });
  if (!calendar.includes("BEGIN:VEVENT")) { toast("Add a deadline or next-step date first."); return; }
  download(`internship-notebook-reminders-${dayKey()}.ics`, calendar, "text/calendar;charset=utf-8");
  toast("Calendar file downloaded. Open it to add the reminders to your calendar.");
}

function exportMarkdown() {
  if (!state.applications.length) { toast("Nothing to export yet"); return; }
  download(`internship-notebook-${dayKey()}.md`, buildMarkdownNotebook(state.applications, state.prefs), "text/markdown;charset=utf-8");
  toast("Markdown downloaded");
}

/** Shows one notification. `new Notification` is the simple path; Android Chrome only allows it
 *  through the service worker registration, so fall back to that. */
async function showNotice(title, body) {
  const options = { body, tag: "due-soon", icon: "icon-192.png" };
  try {
    const notice = new Notification(title, options);
    notice.onclick = () => { window.focus(); go("#/today"); notice.close(); };
    return true;
  } catch {
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (!registration) return false;
      await registration.showNotification(title, options);
      return true;
    } catch { return false; }
  }
}

/** The on-load "due soon" check: only for a real notebook, only with permission, and at most once
 *  a day unless asked directly ("Check now"). It runs only while the tab is open, by design. */
async function checkDueSoon({ force = false } = {}) {
  if (!BROWSER_MODE || inDemo() || !state.loaded || !state.prefs.dueSoonAlerts || notificationPermission() !== "granted") return;
  const today = dayKey();
  if (!force && state.prefs.lastDueAlert === today) return;
  const message = dueSoonMessage(dueSoon(state.applications));
  state.prefs.lastDueAlert = today;
  savePrefs();
  if (message) await showNotice(message.title, message.body);
  else if (force) toast("Nothing is due today or tomorrow.");
}

async function toggleDueAlerts() {
  if (state.prefs.dueSoonAlerts && notificationPermission() === "granted") {
    state.prefs.dueSoonAlerts = false;
    savePrefs();
    rerender();
    return;
  }
  let permission = notificationPermission();
  if (permission === "default") permission = await Notification.requestPermission().catch(() => "denied");
  if (permission !== "granted") {
    rerender();
    toast("Notifications weren't allowed, so this stays off. The calendar file still gives you reminders.");
    return;
  }
  state.prefs.dueSoonAlerts = true;
  savePrefs();
  rerender();
  await checkDueSoon({ force: true });
}

/* ==========================================================================
   10b. Onboarding views: welcome, guided setup, and sign-up
   ========================================================================== */
/* ---------- Welcome page (website edition, new visitors only) ----------
   The front door for a brand-new visitor. It renders in front of the live demo (Demo_Mode stays on
   behind it), so "Explore the demo" is a plain route change and the nav keeps working. Every preview
   below is drawn in HTML/CSS from the same demo dataset the live demo uses, so the mockups stay
   crisp at any size, follow the light/dark theme, and never drift from what the demo shows. */
const WELCOME_TOUR = [
  { key: "today", label: "Today", caption: "Today opens on your weekly goal, what is due next, and the pages you touched last." },
  { key: "board", label: "Board", caption: "The Board lays out every application by stage. Drag a card along when something changes." },
  { key: "notebook", label: "All pages", caption: "All pages is the table of contents: search notes and skills, filter by stage, open any page." },
  { key: "insights", label: "Insights", caption: "Insights turns your history into response rates, a weekly rhythm, and the skills employers ask for." }
];
const WELCOME_FILTERS = ["ALL", "SAVED", "APPLIED", "INTERVIEW"];
/* The "chaos" scraps are invented, like the demo companies. Each scrap is one application as it
   really arrives (an email, a stray tab, a sticky note) and the stage it lands in once organized. */
const WELCOME_SCRAPS = [
  { kind: "tab", mess: "Northwind posting, closes the 28th?", company: "Northwind Robotics", stage: "SAVED" },
  { kind: "email", mess: "Re: Your application to Lumen Analytics", company: "Lumen Analytics", stage: "APPLIED" },
  { kind: "sticky", mess: "Harbor portfolio review Thu!!", company: "Harbor & Co.", stage: "INTERVIEW" },
  { kind: "tab", mess: "tab #14: Quarry Labs SWE intern", company: "Quarry Labs", stage: "SAVED" },
  { kind: "sticky", mess: "did I apply to Pinecrest? check email", company: "Pinecrest Bank", stage: "APPLIED" },
  { kind: "email", mess: "Cedar Grove: technical round invite", company: "Cedar Grove Health", stage: "INTERVIEW" }
];
const WELCOME_SCRAP_COLUMNS = ["SAVED", "APPLIED", "INTERVIEW"];
const WELCOME_CHAOS_CAPTION = {
  false: "Before: an inbox, a pile of tabs, and sticky notes. Six applications, nowhere in particular.",
  true: "After: the same six applications on one board, sorted by stage."
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const timeGreeting = hour => hour < 5 ? "Burning the midnight oil" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

function welcomeMockCover(active) {
  return `<div class="mock-cover">
    <span class="mock-logo">${LOGO}</span>
    ${WELCOME_TOUR.map(tab => `<span class="mock-nav${tab.key === active ? " on" : ""}">${icon(tab.key)}<b>${tab.label}</b></span>`).join("")}
  </div>`;
}

function welcomeMockToday() {
  const seed = DEMO_SEED.applications;
  const stats = metrics(seed);
  const now = new Date();
  const bar = STAGES.filter(stage => stats.counts[stage]).map(stage => `<i class="st-${stage}" style="flex-grow:${stats.counts[stage]}"></i>`).join("");
  const next = seed.filter(entry => entry.nextStepDate).sort((left, right) => left.nextStepDate.localeCompare(right.nextStepDate)).slice(0, 2);
  return `
    <p class="mock-eyebrow">${esc(now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))}</p>
    <p class="mock-title">${esc(timeGreeting(now.getHours()))}<span class="dot">.</span></p>
    <div class="mock-split">
      <div class="mock-card mock-strip"><p><b>${stats.open}</b> open applications</p><div class="mock-bar">${bar}</div></div>
      <div class="mock-card mock-goal"><span class="mock-ring" style="--p:.6"><b>3</b></span><p>of 5 sent<br>this week</p></div>
    </div>
    <div class="mock-card">
      <p class="mock-label">Next up</p>
      ${next.map(entry => {
        const days = daysUntil(entry.nextStepDate);
        return `<div class="mock-line">${pill(entry.status)}<span><b>${esc(entry.nextStep)}</b><small>${esc(entry.company)} · in ${plural(days, "day")}</small></span></div>`;
      }).join("")}
    </div>`;
}

function welcomeMockBoard() {
  const seed = DEMO_SEED.applications;
  return `<div class="mock-columns">${PIPELINE.filter(stage => stage !== "REJECTED").map(stage => {
    const entries = seed.filter(entry => entry.status === stage);
    return `<div class="mock-column st-${stage}">
      <p class="mock-column-head"><i></i>${LABELS[stage]}<span>${entries.length}</span></p>
      ${entries.map(entry => `<div class="mock-card mock-mini"><small>${esc(entry.company)}</small><b>${esc(entry.role)}</b></div>`).join("")}
    </div>`;
  }).join("")}</div>`;
}

function welcomeMockNotebook() {
  const seed = DEMO_SEED.applications;
  return `
    <div class="mock-search">${icon("search")}<span>Search notes, skills, companies</span></div>
    <div class="mock-toc">${seed.map(entry => `
      <div class="mock-toc-row"><span><b>${esc(entry.company)}</b><small>${esc(entry.role)}</small></span>${pill(entry.status)}</div>`).join("")}
    </div>`;
}

function welcomeMockInsights() {
  const seed = DEMO_SEED.applications;
  const stats = metrics(seed);
  const skillCounts = new Map();
  for (const entry of seed) for (const skill of entry.skills) skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);
  const skills = [...skillCounts].sort((left, right) => right[1] - left[1]).slice(0, 4).map(([skill]) => skill);
  // Eight decorative weeks of rhythm; the last bar is "this week", drawn in the accent colour.
  const weeks = [2, 4, 3, 5, 6, 4, 7, 3];
  return `
    <div class="mock-stats">
      <div class="mock-card"><b>${stats.responseRate}%</b><small>Response rate</small></div>
      <div class="mock-card"><b>${stats.interviewRate}%</b><small>Interview rate</small></div>
      <div class="mock-card"><b>${stats.sent}</b><small>Sent</small></div>
    </div>
    <div class="mock-card mock-chart">
      <p class="mock-label">Weekly rhythm</p>
      <div class="mock-bars"><span class="mock-goal-line"></span>${weeks.map((count, index) => `<i style="--h:${count / 7}"${index === weeks.length - 1 ? ' class="now"' : ""}></i>`).join("")}</div>
    </div>
    <p class="mock-skills">${skills.map(skill => `<span class="chip">${esc(skill)}</span>`).join("")}</p>`;
}

const WELCOME_MOCKS = { today: welcomeMockToday, board: welcomeMockBoard, notebook: welcomeMockNotebook, insights: welcomeMockInsights };

function welcomeTour() {
  const active = state.welcome.tab;
  return `
    <section class="welcome-section welcome-tour" aria-labelledby="welcome-tour-title">
      <div class="welcome-section-head">
        <p class="eyebrow">Take the tour</p>
        <h2 id="welcome-tour-title">Four pages, one notebook<span class="dot">.</span></h2>
      </div>
      <div class="tour-tabs" role="tablist" aria-label="Product tour">
        ${WELCOME_TOUR.map(tab => `<button class="tour-tab" type="button" role="tab" id="tour-tab-${tab.key}" aria-controls="tour-panel-${tab.key}"
          aria-selected="${tab.key === active}" tabindex="${tab.key === active ? 0 : -1}" data-action="welcome-tab" data-tab="${tab.key}">${icon(tab.key)}<span>${tab.label}</span></button>`).join("")}
      </div>
      ${WELCOME_TOUR.map(tab => `
        <div class="tour-panel" role="tabpanel" id="tour-panel-${tab.key}" aria-labelledby="tour-tab-${tab.key}" tabindex="0" data-panel="${tab.key}"${tab.key === active ? "" : " hidden"}>
          <div class="mock" role="img" aria-label="Preview of the ${tab.label} page, filled with the demo notebook">
            ${welcomeMockCover(tab.key)}
            <div class="mock-page mock-${tab.key}" aria-hidden="true">${WELCOME_MOCKS[tab.key]()}</div>
          </div>
          <p class="tour-caption">${esc(tab.caption)}</p>
        </div>`).join("")}
    </section>`;
}

function welcomeBoardCards() {
  return DEMO_SEED.applications.filter(entry => WELCOME_FILTERS.includes(entry.status));
}

function welcomeMiniBoard() {
  const filter = state.welcome.filter;
  const cards = welcomeBoardCards();
  const count = stage => stage === "ALL" ? cards.length : cards.filter(entry => entry.status === stage).length;
  const shown = count(filter);
  return `
    <section class="welcome-section welcome-board card" aria-labelledby="welcome-board-title">
      <div class="welcome-section-head">
        <p class="eyebrow">Try it</p>
        <h2 id="welcome-board-title">Filter by stage<span class="dot">.</span></h2>
      </div>
      <div class="welcome-filters" role="group" aria-label="Show applications by stage">
        ${WELCOME_FILTERS.map(stage => `<button class="welcome-filter${stage === "ALL" ? "" : ` st-${stage}`}" type="button" aria-pressed="${stage === filter}"
          data-action="welcome-filter" data-stage="${stage}">${stage === "ALL" ? "All" : `<i></i>${LABELS[stage]}`}<span>${count(stage)}</span></button>`).join("")}
      </div>
      <p class="welcome-count" aria-live="polite">Showing <b data-welcome-count>${shown}</b> of ${plural(cards.length, "application")}</p>
      <div class="welcome-cards">
        ${cards.map(entry => `
          <article class="welcome-card st-${entry.status}" data-stage="${entry.status}"${filter === "ALL" || filter === entry.status ? "" : " hidden"}>
            ${pill(entry.status)}
            <p class="welcome-card-company">${esc(entry.company)}</p>
            <h3 class="welcome-card-role">${esc(entry.role)}</h3>
            <p class="welcome-card-meta">${icon("pin")}${esc(entry.location)}</p>
          </article>`).join("")}
      </div>
    </section>`;
}

function welcomeChaos() {
  const organized = state.welcome.organized;
  // Each scrap's resting place on the board: column by stage, row by order within that stage.
  const rows = {};
  return `
    <section class="welcome-section welcome-chaos card" aria-labelledby="welcome-chaos-title">
      <div class="welcome-section-head">
        <p class="eyebrow">Before and after</p>
        <h2 id="welcome-chaos-title">From scattered to sorted<span class="dot">.</span></h2>
      </div>
      <div class="chaos-switch" role="group" aria-label="Show the search as">
        <button type="button" aria-pressed="${!organized}" data-action="welcome-chaos" data-organized="false">Chaos</button>
        <button type="button" aria-pressed="${organized}" data-action="welcome-chaos" data-organized="true">Notebook</button>
      </div>
      <div class="chaos-stage${organized ? " is-organized" : ""}" data-chaos>
        <div class="chaos-heads" aria-hidden="true">${WELCOME_SCRAP_COLUMNS.map(stage => `<span class="st-${stage}"><i></i>${LABELS[stage]}</span>`).join("")}</div>
        ${WELCOME_SCRAPS.map((scrap, index) => {
          const column = WELCOME_SCRAP_COLUMNS.indexOf(scrap.stage);
          const row = rows[scrap.stage] = (rows[scrap.stage] ?? -1) + 1;
          return `<div class="scrap scrap-${scrap.kind}" aria-hidden="true" style="--i:${index};--col:${column};--row:${row}">
            <span class="scrap-mess">${esc(scrap.mess)}</span>
            <span class="scrap-neat"><b>${esc(scrap.company)}</b>${pill(scrap.stage)}</span>
          </div>`;
        }).join("")}
      </div>
      <p class="chaos-caption" aria-live="polite" data-chaos-caption>${WELCOME_CHAOS_CAPTION[organized]}</p>
    </section>`;
}

function viewWelcome() {
  if (!canShowWelcome({ browserMode: BROWSER_MODE, demoActive: inDemo() })) return "";
  const autoplay = shouldAutoplayTour({ reducedMotion: reducedMotion(), saveData: navigator.connection?.saveData === true });
  const build = (label = "Build my notebook") => `<button class="button primary large" type="button" data-action="build-notebook">${icon("plus")}<span>${label}</span></button>`;
  return `
    <div class="welcome-page">
      <section class="welcome-hero" aria-labelledby="welcome-title">
        <div class="welcome-copy">
          <p class="eyebrow welcome-eyebrow">My Internship Notebook</p>
          <h1 class="welcome-title" id="welcome-title">Your internship search, on paper<span class="dot">.</span></h1>
          <p class="welcome-sub">Save roles, move each one from Saved to Offer, and keep a ruled page of notes for every application, all in one notebook.</p>
          <div class="welcome-cta">
            ${build()}
            <a class="button ghost large" href="#/today">${icon("compass")}<span>Explore the demo</span></a>
          </div>
          <p class="welcome-trust">${icon("lock")}<span>No sign-up needed. Private to your browser.</span></p>
        </div>
        <figure class="welcome-video">
          <div class="tour-video-frame" data-video-frame>
            <video class="tour-video" muted loop playsinline${autoplay ? " autoplay" : ""} preload="${autoplay ? "auto" : "metadata"}"
              poster="media/demo-tour-poster.jpg" src="media/demo-tour.mp4"
              aria-label="Screen recording of the notebook: Today, the Board, an application page, and Insights"></video>
            <button class="tour-video-toggle" type="button" data-action="welcome-video" aria-label="Play the tour video">
              <span class="when-paused">${icon("play")}</span><span class="when-playing">${icon("pause")}</span>
            </button>
          </div>
          <figcaption><span class="tour-video-tag">18-second tour</span><span>Recorded in the demo notebook you can open right now.</span></figcaption>
        </figure>
      </section>

      ${welcomeTour()}

      <div class="welcome-pair">
        ${welcomeMiniBoard()}
        ${welcomeChaos()}
      </div>

      <section class="welcome-benefits" aria-label="Why a notebook">
        <article class="card benefit">
          <span class="benefit-mark">${icon("clock")}</span>
          <h3>Never miss a deadline</h3>
          <p>Deadlines and interview dates surface on Today and the Board before they sneak up on you.</p>
        </article>
        <article class="card benefit">
          <span class="benefit-mark">${icon("notebook")}</span>
          <h3>One page per application</h3>
          <p>Notes, contacts, skills, and a dated timeline for every role, on its own ruled page.</p>
        </article>
        <article class="card benefit">
          <span class="benefit-mark">${icon("lock")}</span>
          <h3>Private, offline, installable</h3>
          <p>Pages stay in this browser, keep working without a connection, and install like an app.</p>
        </article>
      </section>

      <section class="welcome-final" aria-labelledby="welcome-final-title">
        <h2 id="welcome-final-title">Start a fresh notebook<span class="dot">.</span></h2>
        <p>Two minutes of setup. Add your target role and a few companies and the first pages are ready.</p>
        <div class="welcome-cta">${build()}<a class="text-button" href="#/today">Or keep exploring the demo</a></div>
      </section>
    </div>`;
}

/* Welcome interactions. These update state.welcome (so a re-render shows the same choice) and then
   patch the live DOM in place, which is what lets the swap, filter, and chaos morph animate. */
function selectWelcomeTab(key, { focus = false } = {}) {
  if (!WELCOME_MOCKS[key]) return;
  state.welcome.tab = key;
  $$("[data-action='welcome-tab']", viewRoot).forEach(tab => {
    const selected = tab.dataset.tab === key;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  });
  $$(".tour-panel", viewRoot).forEach(panel => {
    const show = panel.dataset.panel === key;
    if (show && panel.hidden) restartAnimation(panel, "is-entering");
    panel.hidden = !show;
  });
}

function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth; // force a reflow so re-adding the class restarts the keyframes
  element.classList.add(className);
}

function filterWelcomeBoard(stage) {
  if (!WELCOME_FILTERS.includes(stage)) return;
  state.welcome.filter = stage;
  $$("[data-action='welcome-filter']", viewRoot).forEach(chip => chip.setAttribute("aria-pressed", String(chip.dataset.stage === stage)));
  let shown = 0;
  $$(".welcome-card", viewRoot).forEach(card => {
    const visible = stage === "ALL" || card.dataset.stage === stage;
    if (visible) { shown++; if (card.hidden) restartAnimation(card, "is-entering"); }
    card.hidden = !visible;
  });
  const count = $("[data-welcome-count]", viewRoot);
  if (count) { count.textContent = String(shown); restartAnimation(count, "is-popping"); }
}

function organizeWelcomeChaos(organized) {
  state.welcome.organized = organized;
  $$("[data-action='welcome-chaos']", viewRoot).forEach(button => button.setAttribute("aria-pressed", String((button.dataset.organized === "true") === organized)));
  $("[data-chaos]", viewRoot)?.classList.toggle("is-organized", organized);
  const caption = $("[data-chaos-caption]", viewRoot);
  if (caption) caption.textContent = WELCOME_CHAOS_CAPTION[organized];
}

function toggleWelcomeVideo(button) {
  const video = button.closest("[data-video-frame]")?.querySelector("video");
  if (!video) return;
  if (video.paused) video.play().catch(() => { if (video.error) markVideoFailed(video); });
  else video.pause();
}

/** Keeps the custom play/pause button in step with the real playback state. */
function syncWelcomeVideo(video) {
  const frame = video.closest("[data-video-frame]");
  if (!frame) return;
  const playing = !video.paused;
  frame.classList.toggle("is-playing", playing);
  frame.querySelector(".tour-video-toggle")?.setAttribute("aria-label", playing ? "Pause the tour video" : "Play the tour video");
}

/** The video is a nice-to-have: if it cannot load, the poster and caption still stand on their own. */
function markVideoFailed(video) {
  const frame = video.closest("[data-video-frame]");
  if (!frame) return;
  frame.classList.add("is-failed");
  const toggle = frame.querySelector(".tour-video-toggle");
  if (toggle) toggle.hidden = true;
}

function viewSetup() {
  if (!BROWSER_MODE) return "";
  const error = state.setupError;
  return `
    ${viewHead({ eyebrow: "Welcome", title: "Set up your notebook<span class=\"dot\">.</span>", sub: "A few details so your notebook starts with your search in mind. Nothing is saved until you finish." })}
    <section class="card setup-card">
      <form id="setup-form" novalidate>
        ${setupFields({ form: state.setupForm, errorFor: field => (error && error.field === field ? error.message : "") })}
        <div class="view-actions">
          <button class="button primary" type="submit" data-action="setup-submit" ${state.setupSubmitting ? "disabled" : ""}>${icon("check")}<span>Create my notebook</span></button>
        </div>
      </form>
    </section>`;
}

/* ---------- Notebook builder (#/build, website edition) ----------
   A three-step questionnaire in front of guided setup's fields: how to start, what it is for, and
   what it should do. The answers live in state.build (choices) and state.setupForm (the same name,
   role, season, and companies fields setup uses), so Back/Next and re-renders keep everything.
   builder.js turns the answers into a plan; finishBuild hands that plan to createRealNotebook, the
   same commit path as guided setup. The demo keeps running behind the wizard until Create. */
const BUILD_STEPS = [
  { short: "Start", title: "How do you want to build your notebook?", sub: "You can change anything later." },
  { short: "Purpose", title: "What are you using it for?", sub: `Pick one or two.` },
  { short: "Focus", title: "What should it do for you?", sub: "Pick as many as you like, then add a few details." }
];
const START_MODE_ICONS = { template: "notebook", scratch: "file", import: "upload" };
const freshBuild = () => ({
  step: 1,
  startMode: DEFAULT_START_MODE,
  useCases: [...DEFAULT_USE_CASES],
  focusAreas: [...DEFAULT_FOCUS_AREAS],
  errors: {},
  note: "",
  submitting: false,
  prefilled: false
});
state.build = freshBuild();

/** The builder's answers in the shape builder.js expects. Companies only matter for a template:
 *  "start empty" and "import" create no pages, so the field is hidden and ignored there. */
function buildAnswers() {
  const form = state.setupForm;
  return {
    startMode: state.build.startMode,
    useCases: state.build.useCases,
    focusAreas: state.build.focusAreas,
    name: form.name,
    targetRole: form.targetRole,
    season: form.season,
    targetCompanies: state.build.startMode === "template" ? form.companies.split(",").map(item => item.trim()).filter(Boolean) : []
  };
}

/** Name, target role, season, and companies: one set of fields shared by setup and the builder. */
function setupFields({ form, errorFor, withCompanies = true }) {
  const seasonOptions = ["", ...SEASONS].map(value =>
    `<option value="${esc(value)}" ${form.season === value ? "selected" : ""}>${value ? esc(value) : "Choose a season"}</option>`).join("");
  const field = (name, label, control) => {
    const message = errorFor(name);
    return `<label class="setup-field"><span>${label}</span>${control(message ? ` aria-invalid="true" aria-describedby="error-${name}"` : "")}
      ${message ? `<p class="field-error" id="error-${name}" role="alert">${esc(message)}</p>` : ""}</label>`;
  };
  return [
    field("name", "Your name", attrs => `<input type="text" name="name" maxlength="40" value="${esc(form.name)}" placeholder="e.g. Jordan" autocomplete="given-name"${attrs} />`),
    field("targetRole", "Target role", attrs => `<input type="text" name="targetRole" maxlength="${LIMITS.role}" value="${esc(form.targetRole)}" placeholder="e.g. Software Engineering Intern"${attrs} />`),
    field("season", "Season", attrs => `<select name="season"${attrs}>${seasonOptions}</select>`),
    withCompanies ? field("targetCompanies", "Target companies <small>(optional, comma separated)</small>", attrs =>
      `<input type="text" name="companies" value="${esc(form.companies)}" placeholder="e.g. Northwind, Lumen, Harbor"${attrs} />`) : ""
  ].join("");
}

/** One checkbox "chip" with a title and a one-line explanation. A real checkbox underneath, so
 *  Space toggles it and screen readers hear "checkbox, checked". */
function buildChip(name, value, copy, checked) {
  return `<label class="build-chip">
    <input type="checkbox" name="${name}" value="${value}"${checked ? " checked" : ""} />
    <span class="build-chip-box" aria-hidden="true">${icon("check")}</span>
    <span class="build-chip-text"><strong>${esc(copy.label)}</strong><small>${esc(copy.hint)}</small></span>
  </label>`;
}

function groupError(field) {
  const message = state.build.errors[field];
  return message ? `<p class="field-error" id="error-${field}" role="alert">${esc(message)}</p>` : "";
}

function buildSummary() {
  const plan = buildNotebookPlan(buildAnswers());
  return `
    <section class="build-summary" aria-labelledby="build-summary-title" data-build-summary>
      <p class="eyebrow">Review</p>
      <h3 id="build-summary-title">Here's what you'll get</h3>
      <p class="build-summary-head">${esc(plan.summary.headline)}</p>
      ${plan.applications.length ? `<ul class="build-pages" aria-label="Starter pages">${plan.applications.map(entry => `
        <li>${pill(entry.status)}<span><b>${esc(entry.company)}</b><small>${esc(entry.role)}</small></span></li>`).join("")}</ul>` : ""}
      <ul class="build-bullets">${plan.summary.bullets.map(line => `<li>${icon("check")}<span>${esc(line)}</span></li>`).join("")}</ul>
    </section>`;
}

function viewBuild() {
  if (!BROWSER_MODE) return "";
  const build = state.build;
  if (!build.prefilled) {
    // Prefill once from saved preferences (a visitor who started setup before, or set a name).
    build.prefilled = true;
    const form = state.setupForm;
    if (!form.name) form.name = state.prefs.name;
    if (!form.targetRole) form.targetRole = state.prefs.targetRole;
    if (!form.season) form.season = state.prefs.season;
    if (!form.companies) form.companies = state.prefs.targetCompanies.join(", ");
    if (state.prefs.focusAreas.length) build.focusAreas = [...state.prefs.focusAreas];
  }
  const step = build.step;
  const current = BUILD_STEPS[step - 1];
  const progress = `
    <div class="build-progress">
      <p class="build-count">Step ${step} of ${BUILD_STEPS.length}</p>
      <ol class="build-track" aria-label="Progress">${BUILD_STEPS.map((item, index) => {
        const number = index + 1;
        const status = number < step ? "done" : number === step ? "current" : "";
        return `<li class="${status}"${number === step ? ' aria-current="step"' : ""}><span class="build-dot">${number < step ? icon("check") : number}</span><span class="build-label">${item.short}<span class="sr-only">${number < step ? ", done" : ""}</span></span></li>`;
      }).join("")}</ol>
    </div>`;

  let body = "";
  if (step === 1) {
    body = `
      <fieldset class="build-options" aria-labelledby="build-step-title"${build.errors.startMode ? ' aria-describedby="error-startMode"' : ""}>
        ${START_MODES.map(mode => `
          <label class="build-option">
            <input type="radio" name="startMode" value="${mode}"${build.startMode === mode ? " checked" : ""} />
            <span class="build-option-mark" aria-hidden="true">${icon(START_MODE_ICONS[mode])}</span>
            <span class="build-option-text"><strong>${esc(START_MODE_COPY[mode].label)}</strong><small>${esc(START_MODE_COPY[mode].hint)}</small></span>
          </label>`).join("")}
      </fieldset>
      ${groupError("startMode")}`;
  } else if (step === 2) {
    body = `
      <fieldset class="build-chips" aria-labelledby="build-step-title" aria-describedby="build-use-limit${build.errors.useCases ? " error-useCases" : ""}">
        ${USE_CASES.map(useCase => buildChip("useCase", useCase, USE_CASE_COPY[useCase], build.useCases.includes(useCase))).join("")}
      </fieldset>
      <p class="build-note" id="build-use-limit">${build.note ? esc(build.note) : `Up to ${MAX_USE_CASES}. ${build.useCases.length} chosen.`}</p>
      ${groupError("useCases")}`;
  } else {
    body = `
      <fieldset class="build-chips build-focus" aria-labelledby="build-step-title"${build.errors.focusAreas ? ' aria-describedby="error-focusAreas"' : ""}>
        ${FOCUS_AREAS.map(area => buildChip("focusArea", area, FOCUS_COPY[area], build.focusAreas.includes(area))).join("")}
      </fieldset>
      ${groupError("focusAreas")}
      <div class="build-details">
        <div class="build-fields">${setupFields({ form: state.setupForm, errorFor: field => build.errors[field], withCompanies: build.startMode === "template" })}</div>
        ${buildSummary()}
      </div>
      ${build.errors.form ? `<p class="field-error" role="alert">${esc(build.errors.form)}</p>` : ""}`;
  }

  const last = step === BUILD_STEPS.length;
  return `
    ${viewHead({ eyebrow: "Build your notebook", title: "Make it yours<span class=\"dot\">.</span>", sub: "Three quick questions. Nothing is saved until you press Create." })}
    <form id="build-form" class="card build-card" novalidate>
      ${progress}
      <div class="build-step" data-step="${step}">
        <h2 class="build-title" id="build-step-title" tabindex="-1">${esc(current.title)}</h2>
        <p class="build-sub">${esc(current.sub)}</p>
        ${body}
      </div>
      <div class="build-nav">
        ${step > 1
          ? `<button class="button ghost" type="button" data-action="build-back">${icon("back")}<span>Back</span></button>`
          : inDemo() ? `<a class="text-button build-later" href="#/today">Not now, back to the demo</a>` : "<span></span>"}
        <button class="button primary" type="submit" ${build.submitting ? "disabled" : ""}>${last
          ? `${icon("check")}<span>${build.submitting ? "Creating…" : "Create my notebook"}</span>`
          : `<span>Next</span>${icon("forward")}`}</button>
      </div>
    </form>`;
}

/** Copies the live text fields into state.setupForm (they are also mirrored on input). */
function syncBuildForm() {
  const live = $("#build-form");
  if (!live) return;
  for (const name of ["name", "targetRole", "season", "companies"]) {
    if (live.elements[name]) state.setupForm[name] = live.elements[name].value;
  }
}

/** Announces through the persistent #announcer. Clearing first makes a repeated message speak again. */
function announce(message) {
  const region = $("#announcer");
  if (!region) return;
  region.textContent = "";
  window.setTimeout(() => { region.textContent = message; }, 30);
}

function showBuildStep(step) {
  state.build.step = clamp(step, 1, BUILD_STEPS.length);
  state.build.note = "";
  rerender();
  // Focus the new question so keyboard and screen-reader users start at the top of the step; the
  // announcer adds where they are ("Step 2 of 3") without repeating the question.
  $("#build-step-title")?.focus();
  announce(`Step ${state.build.step} of ${BUILD_STEPS.length}`);
}

/** Next: checks only the current step's choice, so a visitor is never blocked by a later field. */
function nextBuildStep() {
  syncBuildForm();
  const { errors } = validatePlan(buildAnswers());
  const field = state.build.step === 1 ? "startMode" : "useCases";
  if (errors[field]) {
    state.build.errors = { [field]: errors[field] };
    rerender();
    $("#build-step-title")?.focus();
    return;
  }
  state.build.errors = {};
  showBuildStep(state.build.step + 1);
}

function refreshBuildSummary() {
  const summary = $("[data-build-summary]");
  if (summary) summary.outerHTML = buildSummary();
}

/** A checkbox chip changed. Use cases stop at MAX_USE_CASES: the extra tick is undone and the note
 *  under the chips says why, rather than silently disabling the other options. */
function changeBuildChip(input) {
  const key = input.name === "useCase" ? "useCases" : "focusAreas";
  const list = state.build[key].filter(value => value !== input.value);
  if (input.checked) list.push(input.value);
  if (key === "useCases" && list.length > MAX_USE_CASES) {
    input.checked = false;
    state.build.note = `You can pick up to ${MAX_USE_CASES}. Unselect one to choose this.`;
  } else {
    state.build[key] = key === "useCases" ? cleanUseCases(list) : cleanFocusAreas(list);
    state.build.note = "";
    delete state.build.errors[key];
  }
  if (key === "useCases") {
    const note = $("#build-use-limit");
    if (note) note.textContent = state.build.note || `Up to ${MAX_USE_CASES}. ${state.build.useCases.length} chosen.`;
    if (state.build.note) announce(state.build.note);
  } else {
    refreshBuildSummary();
  }
}

const BUILD_STEP_OF_FIELD = { startMode: 1, useCases: 2 };

async function finishBuild() {
  if (!BROWSER_MODE || state.build.submitting) return; // one-shot latch against double submit
  syncBuildForm();
  const answers = buildAnswers();
  const check = validatePlan(answers);
  if (!check.ok) {
    state.build.errors = check.errors;
    const [first] = Object.keys(check.errors);
    state.build.step = BUILD_STEP_OF_FIELD[first] || 3;
    rerender();
    const target = $(`#build-form [aria-invalid="true"]`) || $("#build-step-title");
    target?.focus();
    announce(`Check ${plural(Object.keys(check.errors).length, "field")} before creating your notebook.`);
    return;
  }
  const plan = buildNotebookPlan(answers);
  state.build.errors = {};
  state.build.submitting = true;
  rerender();
  try {
    const { weeklyGoal, ...prefs } = plan.prefs;
    const { status } = await createRealNotebook({ applications: plan.applications, prefs: { ...prefs, goal: weeklyGoal } });
    state.build = freshBuild();
    if (status === "existing") return;
    go("#/today");
    if (plan.openImport) {
      // The picker usually opens straight away; the toast's button covers browsers that only allow it
      // during a click (the click that started this has passed through a few awaits by now).
      toast("Your notebook is ready. Choose your backup file to import it.", { action: "Choose file", run: () => $("#import-file").click() });
      $("#import-file").click();
    } else {
      toast("Your notebook is ready.");
    }
  } catch (error) {
    state.prefs.started = false;
    state.build.submitting = false;
    state.build.errors = { form: "Your notebook could not be created on this browser. Storage may be full or blocked." };
    rerender();
    toast(`Your notebook was not created: ${error.message}`, { error: true });
  }
}

function viewSignup() {
  if (!BROWSER_MODE) return "";
  return `
    ${viewHead({ eyebrow: "Your data", title: "Save your notebook", sub: "Your notebook saves automatically in this browser. Download a backup to keep another copy." })}
    <section class="card signup-card">
      <div class="view-actions">
        <button class="button" type="button" data-action="export-json">${icon("download")}Download backup</button>
        ${cloud.enabled ? `<a class="button ghost" href="#/settings">Sign in to sync</a>` : ""}
        <button class="button ghost" type="button" data-action="signup-browser-only">Keep it on this browser only</button>
      </div>
    </section>`;
}

/* ==========================================================================
   10c. Guided setup completion (validated single-batch notebook commit)
   ==========================================================================
   Order is deliberate and stated plainly: validate everything first; re-check for existing work
   immediately before writing (covers a direct #/setup link or a second tab creating data mid-flow);
   commit the notebook as ONE write (importBackup for companies, a single empty-notebook write for
   none); persist preferences; then set the started flag only after the notebook commit succeeded.
   localStorage has no multi-key transaction, so the notebook write and the prefs write are separate
   ordered writes: the started flag gates on the notebook write specifically, a catch cannot roll
   back a write that already landed, and we never roll back or overwrite data another tab wrote. */
/**
 * The one path from onboarding to a real notebook, used by guided setup and the builder, in the
 * order described above: re-check for existing work, commit the pages as one batch, save the
 * preferences, and set started only after the commit. Then leave the demo (if it is still running
 * behind the builder) and load the real notebook. Returns { status: "created" | "existing" }; a
 * failed notebook commit throws before any preference changes.
 */
async function createRealNotebook({ applications, prefs }) {
  // (2) Never overwrite a notebook that appeared meanwhile (direct link, or another tab).
  const existing = browserApi.read();
  if (hasExistingWork(existing, readDrafts())) {
    toast("You already have a notebook on this browser. Opening it.");
    if (inDemo()) exitDemoMode();
    go("#/today");
    await load();
    return { status: "existing" };
  }
  // (3) Commit the notebook as ONE write through the real backend.
  await commitStarterNotebook(browserApi, applications);
  // (4) Persist the preferences (separate write; honest about failure), (5) started only now.
  Object.assign(state.prefs, prefs, { started: true });
  if (!savePrefs()) {
    // The notebook committed but preferences could not be saved. Do not roll back the notebook (a
    // catch cannot undo a landed write, and the notebook is the thing worth keeping). Say so.
    toast("Your notebook was created, but your preferences could not be saved on this browser.", { error: true });
  }
  if (inDemo()) exitDemoMode();
  await load(); // the real notebook (started is set, so no demo)
  return { status: "created" };
}

async function completeSetup() {
  if (!BROWSER_MODE) return;
  if (state.setupSubmitting) return; // one-shot latch against double submit
  state.setupError = null;

  // (1) Validate everything before any write. Read the live form so the submit reflects the
  //     current inputs; mirror them into state.setupForm so an error rerender keeps the values.
  const live = $("#setup-form");
  if (live) {
    state.setupForm.name = live.elements.name?.value ?? state.setupForm.name;
    state.setupForm.targetRole = live.elements.targetRole?.value ?? state.setupForm.targetRole;
    state.setupForm.season = live.elements.season?.value ?? state.setupForm.season;
    state.setupForm.companies = live.elements.companies?.value ?? state.setupForm.companies;
  }
  const form = state.setupForm;
  const companies = form.companies.split(",").map(item => item.trim()).filter(Boolean);
  const result = validateSetup({ name: form.name, targetRole: form.targetRole, season: form.season, targetCompanies: companies });
  if (!result.ok) {
    state.setupError = result; // { field, message } - the form shows it and keeps entered values
    rerender();
    return;
  }

  state.setupSubmitting = true;
  rerender();
  try {
    const starters = buildStarterApplications({ targetRole: result.value.targetRole, targetCompanies: result.value.targetCompanies });
    const { name, targetRole, season, targetCompanies } = result.value;
    const { status } = await createRealNotebook({ applications: starters, prefs: { name, targetRole, season, targetCompanies } });
    state.setupSubmitting = false;
    if (status === "created") go("#/signup");
  } catch (error) {
    // The notebook commit failed: leave real storage unchanged, do not set the started flag, and say so.
    state.prefs.started = false;
    state.setupSubmitting = false;
    state.setupError = { field: null, message: "Your notebook could not be created on this browser. Storage may be full or blocked." };
    rerender();
    toast(`Setup did not complete: ${error.message}`, { error: true });
  }
}

/* ==========================================================================
   11. Router and rendering
   ========================================================================== */
const viewRoot = $("#view");
const page = $("#page");
const renderers = { welcome: viewWelcome, today: viewToday, board: viewBoard, notebook: viewNotebook, insights: viewInsights, deleted: viewDeleted, settings: viewSettings, setup: viewSetup, build: viewBuild, signup: viewSignup, export: viewExport };

// The skip link targets #view directly with JS, not a "#view" hash change: every hash change
// goes through the router below, and "view" isn't a route name, so letting the browser's default
// anchor jump happen would fire hashchange -> parseRoute() -> fall back to Today, sending
// keyboard and screen-reader users away from the page they meant to skip into.
$(".skip-link").addEventListener("click", event => {
  event.preventDefault();
  viewRoot.focus({ preventScroll: false });
  viewRoot.scrollIntoView({ block: "start" });
});

function parseRoute() {
  const [view, id] = window.location.hash.replace(/^#\/?/, "").split("/");
  if (view === "entry" && Number(id) > 0) return { view: "entry", id: Number(id) };
  // The welcome page only exists in front of the demo; anyone else asking for it gets Today.
  if (view === "welcome" && !canShowWelcome({ browserMode: BROWSER_MODE, demoActive: inDemo() })) return { view: "today", id: null };
  if ((view === "build" || view === "export") && !BROWSER_MODE) return { view: "today", id: null }; // browser-notebook features only
  return { view: renderers[view] ? view : "today", id: null };
}

/** parseRoute() sends a #/welcome that may not render to Today; this makes the address bar agree. */
function settleWelcomeHash() {
  if (window.location.hash === "#/welcome" && state.route.view !== "welcome") window.history.replaceState(null, "", "#/today");
}

function render({ animate = false, keepScroll = true } = {}) {
  const { view, id } = state.route;
  const scrollTop = page.scrollTop;
  const windowScroll = window.scrollY;
  if (state.corrupted) {
    document.title = "Recover your notebook · My Internship Notebook";
    $("#mobile-title").textContent = "Recover your notebook";
    viewRoot.innerHTML = viewRecovery(state.corrupted);
    return;
  }
  if (!state.loaded) {
    viewRoot.innerHTML = state.loadError
      ? `<div class="card" style="margin-top:24px">${emptyState({ iconName: "alert", title: "The notebook server isn't answering", copy: `${esc(state.loadError)} Start it with the command in the README, then try again.`, action: `<button class="button primary" type="button" data-action="reload">Try again</button>` })}</div>`
      : `<p class="empty-note" style="padding:40px 0">Opening your notebook…</p>`;
    return;
  }
  viewRoot.classList.toggle("animate", animate);
  const body = view === "entry" ? viewEntry(id) : renderers[view]();
  // The welcome page and the builder carry their own calls to action, so no demo banner on them.
  viewRoot.innerHTML = inDemo() && view !== "welcome" && view !== "build" ? demoBanner() + body : body;
  const entry = view === "entry" ? find(id) : null;
  const title = entry ? `${entry.company}` : VIEWS[view].title;
  document.title = `${title} · My Internship Notebook`;
  $("#mobile-title").textContent = title;
  // An open application page is still a page of "All pages", so that tab stays highlighted
  // instead of every tab looking unselected while you are reading or editing an entry.
  const navKey = view === "entry" ? "notebook" : view === "export" ? "settings" : view;
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
window.matchMedia("(max-width: 759px)").addEventListener("change", () => {
  if (state.route.view === "board") { state.selected.clear(); rerender(); }
});

async function navigate() {
  await flushEntrySave();
  const previous = state.route;
  state.route = parseRoute();
  // Leaving the demo for setup or sign-up ends the demo so those screens and the real notebook show.
  if (inDemo() && (state.route.view === "setup" || state.route.view === "signup")) exitDemoMode();
  settleWelcomeHash();
  if (previous.view !== state.route.view) endSelection(false);
  if (state.route.view === "entry" && previous.view !== "entry") {
    state.backRoute = `#/${previous.view === "entry" ? "board" : previous.view}`;
  }
  closeMenu();
  render({ animate: true, keepScroll: false });
  page.scrollTop = 0;
  window.scrollTo(0, 0);
  viewRoot.focus({ preventScroll: true });
  // "All questions" on Today's Practice next card lands on the prep card. This runs here, after
  // the view takes focus above, or that focus would immediately replace it.
  if (state.route.view === "entry" && state.scrollToPrep) {
    state.scrollToPrep = false;
    const title = $("#prep-title");
    if (title) { title.setAttribute("tabindex", "-1"); $("#prep").scrollIntoView({ block: "start" }); title.focus({ preventScroll: true }); }
  }
  if (state.route.view === "entry" && state.rescheduleId === state.route.id) {
    state.rescheduleId = null;
    $('[data-field="nextStepDate"]')?.focus();
  }
}

function go(hash) {
  if (window.location.hash === hash) navigate();
  else window.location.hash = hash;
}

function updateCounts() {
  const stats = metrics(state.applications);
  const values = { active: stats.open, total: stats.total, deleted: state.deleted.length };
  $$("[data-count]").forEach(element => { element.textContent = values[element.dataset.count] || ""; });
}

/* ==========================================================================
   12. Toasts, confirm dialog, popover menu
   ========================================================================== */
const toasts = $("#toasts");
/**
 * One toast slot. A new message replaces the one showing (text, action, and timer) instead of
 * stacking, so quick changes never pile up over the page, and the slot keeps its place so nothing
 * shifts. Plain messages stay about 4 seconds; one with an Undo or Retry button, or an error, stays
 * 6 seconds. The timer pauses while the toast is hovered or holds keyboard focus, so nobody loses
 * the Undo button while reaching for it (WCAG 2.2.1, Timing Adjustable). #toasts is a polite live
 * region, so each new message is announced once.
 * Errors merge: when a second error arrives within two seconds of the first (one failure often
 * reports twice, e.g. "couldn't save locally" and then the save itself failing), the first, more
 * specific message stays and only the newer action (such as Retry) is taken.
 */
let toastTimer = null;
function toast(message, { action, run, error = false, duration } = {}) {
  let element = toasts.querySelector(".toast:not(.leaving)");
  toasts.querySelectorAll(".toast.leaving").forEach(old => old.remove());
  const replacing = Boolean(element);
  if (!element) {
    element = document.createElement("div");
    element.className = "toast";
    const pause = () => window.clearTimeout(toastTimer);
    const resume = () => { if (!element.matches(":hover, :focus-within")) armToast(element); };
    element.addEventListener("pointerenter", pause);
    element.addEventListener("pointerleave", resume);
    element.addEventListener("focusin", pause);
    element.addEventListener("focusout", event => { if (!element.contains(event.relatedTarget)) resume(); });
    toasts.append(element);
  }
  // Keep focus in the slot if it was on the old button, so a keyboard user isn't dropped.
  const hadFocus = element.contains(document.activeElement);
  if (error && replacing && element.classList.contains("error") && Date.now() - Number(element.dataset.at) < 2000) {
    message = element.querySelector(".toast-text")?.textContent || message;
  }
  element.dataset.at = String(Date.now());
  element.classList.toggle("error", error);
  element.innerHTML = `<span class="toast-text">${esc(message)}</span>`;
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action;
    button.addEventListener("click", () => { dismissToast(element); run?.(); });
    element.append(button);
    if (hadFocus) button.focus();
  }
  if (replacing) { element.classList.remove("is-updated"); void element.offsetWidth; element.classList.add("is-updated"); }
  element.dataset.duration = String(duration ?? (action || error ? 6000 : 4000));
  if (!element.matches(":hover, :focus-within")) armToast(element);
  else window.clearTimeout(toastTimer);
}
function armToast(element) {
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => dismissToast(element), Number(element.dataset.duration) || 4000);
}
function dismissToast(element) {
  if (!element.isConnected || element.classList.contains("leaving")) return;
  window.clearTimeout(toastTimer);
  element.classList.add("leaving");
  window.setTimeout(() => element.remove(), 240);
}
const fail = error => toast(error?.message || "Something went wrong.", { error: true });

const confirmElement = $("#confirm-dialog");
let confirmResolve = null;
function confirmDialog({ eyebrow = "A small safety net", title, copy, yes = "Continue", no = "Keep it", iconName = "trash", danger = true }) {
  dialogOpener = document.activeElement;
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
    if (item.separator) return '<hr role="separator" />';
    if (item.header) return `<p class="menu-label" role="presentation">${esc(item.header)}</p>`;
    // A stage choice or a generic radio choice (item.radio) is one of a mutually exclusive set
    // (only one is ever "checked"), so it gets menuitemradio with aria-checked; a plain action is
    // menuitem and has neither. Only a stage choice gets the coloured dot - a plain radio choice
    // relies on the ::after checkmark CSS already keys off aria-checked.
    const isRadio = Boolean(item.stage || item.radio);
    const role = isRadio ? "menuitemradio" : "menuitem";
    const checkedAttr = isRadio ? ` aria-checked="${Boolean(item.checked)}"` : "";
    const mark = item.stage ? '<i class="menu-dot"></i>' : item.radio ? "" : icon(item.icon || "forward");
    return `<button type="button" role="${role}" data-menu-index="${index}" class="${item.danger ? "danger" : ""} ${item.stage ? `st-${item.stage}` : ""}"${checkedAttr}>
      ${mark}<span>${esc(item.label)}</span></button>`;
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
    ...(entry.link ? [{ label: "Open job posting", icon: "external", run: () => window.open(entry.link, "_blank", "noopener,noreferrer") }] : []),
    { label: "Move to Recently Deleted", icon: "trash", danger: true, run: () => removeApplications([entry.id]) }
  ]);
}

/* ==========================================================================
   13. Actions (every change goes through the api, then updates local state)
   ========================================================================== */
/**
 * Changes one page's stage from its own page. Clicks are queued one after another, and each one
 * re-reads the page when its turn comes, so fast clicking never sends a stale change and choosing
 * the stage the page already has does nothing (no save, no history entry, no toast).
 */
let stageChain = Promise.resolve();
function setEntryStatus(id, stage) {
  stageChain = stageChain.then(async () => {
    await flushEntrySave();
    const entry = find(id);
    if (!entry || entry.status === stage) return;
    try {
      replaceApplications([await activeApi.update(id, { status: stage })]);
      rerender();
      toast(`Moved to ${LABELS[stage]}`, { action: "Undo", run: demoBound(() => undoStatus([[id, entry.status]])) });
    } catch (error) { fail(error); }
  });
  return stageChain;
}

/** Shows or hides a date field's placeholder and clear button to match its value. */
function syncDateField(input) {
  input.closest(".date-field")?.classList.toggle("has-value", Boolean(input.value));
}

async function changeStatus(ids, stage, { undoable = true } = {}) {
  const previous = ids.map(id => [id, find(id)?.status]);
  try {
    const updated = await activeApi.setStatus(ids, stage);
    replaceApplications(updated);
    rerender();
    const subject = ids.length === 1 ? find(ids[0])?.company || "Application" : plural(ids.length, "application");
    toast(`${subject} moved to ${LABELS[stage]}`, undoable ? { action: "Undo", run: demoBound(() => undoStatus(previous)) } : {});
  } catch (error) { fail(error); }
}

async function undoStatus(previous) {
  try {
    const groups = new Map();
    previous.forEach(([id, stage]) => { if (stage && find(id)) groups.set(stage, [...(groups.get(stage) || []), id]); });
    for (const [stage, ids] of groups) replaceApplications(await activeApi.setStatus(ids, stage));
    rerender();
    toast("Change undone");
  } catch (error) { fail(error); }
}

async function toggleStar(id) {
  await flushEntrySave();
  const entry = find(id);
  if (!entry) return;
  try {
    replaceApplications([await activeApi.update(id, { starred: !entry.starred })]);
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
    await Promise.all(ids.map(id => flushEntrySave(id)));
    if (ids.some(id => readDrafts()[id])) throw new Error("Some edits are still waiting to save. Retry them before deleting this page.");
    const removed = await activeApi.remove(ids);
    ids.forEach(clearDraft);
    state.applications = state.applications.filter(entry => !ids.includes(entry.id));
    state.deleted.push(...removed);
    ids.forEach(id => state.selected.delete(id));
    if (state.route.view === "entry" && ids.includes(state.route.id)) go(state.backRoute);
    else rerender();
    toast(entries.length === 1 ? `${entries[0].company} moved to Recently Deleted` : `${plural(entries.length, "application")} moved to Recently Deleted`,
      { action: "Undo", run: demoBound(() => restoreApplications(ids, { quiet: true })) });
  } catch (error) { fail(error); }
}

async function restoreApplications(ids, { quiet = false } = {}) {
  try {
    const restored = await activeApi.restore(ids);
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
    await activeApi.purge(ids);
    state.deleted = state.deleted.filter(entry => !ids.includes(entry.id));
    ids.forEach(id => state.selected.delete(id));
    if (!state.deleted.length) endSelection(false);
    rerender();
    toast(entries.length === 1 ? "Deleted permanently" : `${plural(entries.length, "application")} deleted permanently`);
  } catch (error) { fail(error); }
}

async function createApplication(fields) {
  const created = await activeApi.create(fields);
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
let newPostingLink = "";
function renderStagePicker() {
  // Roving tabindex: only the checked option is a Tab stop, matching how a native radio group
  // behaves, and letting arrow keys move both focus and the selection between options.
  $("#new-stage").innerHTML = STAGES.map(stage => `<button class="stage-option st-${stage}" type="button" role="radio" aria-checked="${stage === newStage}" tabindex="${stage === newStage ? "0" : "-1"}" data-action="pick-stage" data-stage="${stage}">${LABELS[stage]}</button>`).join("");
  $("#new-stage").setAttribute("role", "radiogroup");
  $("#new-stage").setAttribute("aria-label", "Stage");
}
function moveStagePicker(delta) {
  const index = STAGES.indexOf(newStage);
  newStage = STAGES[(index + delta + STAGES.length) % STAGES.length];
  renderStagePicker();
  $(`[data-stage="${newStage}"]`, $("#new-stage")).focus();
}
function updateSourceOptions() {
  const used = [...new Set(state.applications.map(entry => entry.source.trim()).filter(Boolean))];
  const options = [...used, ...SOURCE_SUGGESTIONS.filter(source => !used.some(item => item.toLowerCase() === source.toLowerCase()))];
  $("#source-options").innerHTML = options.map(source => `<option value="${esc(source)}"></option>`).join("");
}
function openNew(stage = "SAVED", initial = {}) {
  newPostingLink = "";
  dialogOpener = document.activeElement;
  closeMenu();
  if ($("#palette").open) $("#palette").close();
  newForm.reset();
  for (const [name, value] of Object.entries(initial)) {
    if (newForm.elements[name] && typeof value === "string") newForm.elements[name].value = value;
  }
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
    const applications = BROWSER_MODE ? activeApi.read().applications : state.applications;
    const duplicate = newPostingLink && postingKey(fields.link) === newPostingLink
      && applications.find(entry => postingKey(entry.link) === newPostingLink);
    if (duplicate) { newDialog.close(); go(`#/entry/${duplicate.id}`); toast("That posting is already in your notebook."); return; }
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
$("#new-stage").addEventListener("keydown", event => {
  if (!event.target.matches('[role="radio"]')) return;
  if (["ArrowRight", "ArrowDown"].includes(event.key)) { event.preventDefault(); moveStagePicker(1); }
  else if (["ArrowLeft", "ArrowUp"].includes(event.key)) { event.preventDefault(); moveStagePicker(-1); }
  else if (event.key === "Home") { event.preventDefault(); newStage = STAGES[0]; renderStagePicker(); $(`[data-stage="${newStage}"]`, $("#new-stage")).focus(); }
  else if (event.key === "End") { event.preventDefault(); newStage = STAGES[STAGES.length - 1]; renderStagePicker(); $(`[data-stage="${newStage}"]`, $("#new-stage")).focus(); }
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
  dialogOpener = document.activeElement;
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
// Remembers whatever had focus when a dialog opened, so closing it can put focus back there even
// after a rerender has replaced that element with an equivalent new one (the browser's own
// dialog focus-restore only works if the original DOM node is still attached, which a rerender
// between open and close - e.g. adding an application - breaks). Falls back to the main view.
let dialogOpener = null;
$$("dialog").forEach(dialog => dialog.addEventListener("close", () => {
  if (dialog.contains(document.activeElement)) document.activeElement.blur();
  const target = dialogOpener && document.body.contains(dialogOpener) ? dialogOpener : viewRoot;
  dialogOpener = null;
  target.focus({ preventScroll: true });
}));

/* ==========================================================================
   17. Notebook page editing (autosave, with a disk-backed retry queue)
   ==========================================================================
   Every field edit is written to this browser's drafts store (see storage.js) the instant it
   happens - not just held in memory - so it survives a refresh, going offline, or the app or
   tab closing before the debounced save runs. That draft is the only source of truth for "what
   is unsaved for entry X"; flushEntrySave() always reads from it and only clears it once activeApi.update()
   has actually confirmed the write, so a failed save keeps the edit queued for automatic retry
   (on a timer and when the connection comes back) instead of discarding it.

   Four states are shown, and each means something different:
     "Saving…"       a request to save is in flight right now
     "Saved locally" the edit is captured in this browser (the draft above), but not yet confirmed
     "Synced"        the Java server has confirmed the write (server mode only)
     "Couldn't save" the last attempt failed; the edit is still queued and will retry, or press Retry
   The website edition has no server to sync to, so it never claims "Synced": once activeApi.update()
   succeeds there, the browser's storage *is* the confirmed record, so it stays "Saved locally". */
let saveChain = Promise.resolve();
const inFlight = new Set();
const retryTimers = new Map();
const RETRY_DELAY_MS = 4000;

function setSaveState(mode, message = "") {
  const element = $("#save-state");
  if (!element) return;
  element.className = `save-state ${mode}`;
  const label = mode === "saving" ? "Saving…"
    : mode === "draft" ? "Saved locally"
    : mode === "synced" ? (BROWSER_MODE ? "Saved locally" : "Synced")
    : mode === "error" ? (message || "Couldn't save")
    : (BROWSER_MODE ? "Saved locally" : "Synced");
  const iconName = mode === "saving" ? "clock" : mode === "error" ? "alert" : "check";
  element.innerHTML = `${icon(iconName)}<span>${esc(label)}</span>${mode === "error" ? `<button type="button" class="save-retry" data-action="retry-save">Retry</button>` : ""}`;
}

/** Saves whatever is drafted for `targetId` (the open entry by default). Safe to call repeatedly:
 *  a save already in flight for that entry is left alone rather than duplicated. Pass
 *  `overrideChanges` to save specific fields directly instead of whatever is currently drafted -
 *  used when the draft itself couldn't be written (see queueChange) so there is nothing on disk
 *  to read back. */
function flushEntrySave(targetId = state.route.view === "entry" ? state.route.id : null, overrideChanges = null) {
  entrySave.cancel();
  if (targetId == null) return saveChain;
  const demo = inDemo();
  const session = currentSession();
  // In the demo there is no real draft store: read the override only, and never touch KEYS.drafts.
  const changes = overrideChanges || (demo ? null : readDrafts()[targetId]?.changes);
  if (!changes || !Object.keys(changes).length) return saveChain;
  if (inFlight.has(targetId)) return saveChain;
  inFlight.add(targetId);
  const isCurrent = () => state.route.view === "entry" && state.route.id === targetId;
  if (isCurrent()) setSaveState("saving");
  saveChain = saveChain.then(async () => {
    let resendQueued = false;
    try {
      if (!find(targetId)) { if (!demo) clearDraft(targetId); return; } // the page was deleted while a draft was pending
      const updated = await activeApi.update(targetId, changes);
      replaceApplications([updated]);
      // Only the fields whose current draft value still matches what was just sent are cleared.
      // Anything typed *during* this request (queued by writeDraft while the await above was
      // pending) is a different value than what `changes` captured, so it is left queued instead
      // of being silently thrown away with the rest of the draft - that was the actual bug: a
      // plain clearDraft() here deleted the whole draft, snapshot and any later edits alike.
      if (!demo) clearConfirmedDraft(targetId, changes);
      window.clearTimeout(retryTimers.get(targetId));
      retryTimers.delete(targetId);
      updateCounts();
      if (isCurrent()) {
        setSaveState("synced");
        const edited = $("[data-edited]");
        if (edited) edited.textContent = timeAgo(updated.updatedAt);
        if ("link" in changes) refreshLinkButton(updated);
        if ("nextStep" in changes) $("#entry-next-actions").innerHTML = nextStepActions(updated);
        if ("company" in changes) { $("#mobile-title").textContent = updated.company; document.title = `${updated.company} · My Internship Notebook`; }
      }
      resendQueued = demo ? false : Boolean(readDrafts()[targetId]); // something else arrived while this save was in flight
    } catch (error) {
      // The draft on disk is untouched (it was written before this attempt started), so nothing
      // typed is lost - only the confirmation failed. Keep retrying instead of giving up on it.
      if (isCurrent()) setSaveState("error", error.message);
      toast(`Couldn't save ${find(targetId)?.company || "your change"}: ${error.message}`, { error: true, action: "Retry", run: () => flushEntrySave(targetId) });
      window.clearTimeout(retryTimers.get(targetId));
      if (!demo || sessionActive(session)) {
        retryTimers.set(targetId, window.setTimeout(() => { if (!demo || sessionActive(session)) flushEntrySave(targetId); }, RETRY_DELAY_MS));
      }
    } finally {
      inFlight.delete(targetId);
    }
    // Send the newer edit right away instead of waiting for the next keystroke or retry timer.
    if (resendQueued) flushEntrySave(targetId);
  });
  return saveChain;
}
const entrySave = debounce(() => flushEntrySave(), 650);

/** Retries every draft left over from a previous visit (a save that failed, or never got the
 *  chance to run before the app closed) for entries that still exist. */
async function retryPendingDrafts() {
  if (inDemo()) return; // no real drafts in the demo, and real drafts must not replay into it
  for (const id of Object.keys(readDrafts()).map(Number).filter(id => find(id))) await flushEntrySave(id);
}
window.addEventListener("online", retryPendingDrafts);

function queueChange(field, value, { immediate = false } = {}) {
  const id = state.route.id;
  if ((field === "company" || field === "role") && !String(value).trim()) {
    setSaveState("error", `${field === "company" ? "Company" : "Role"} can't be empty`);
    return;
  }
  if (inDemo()) {
    // Demo edits are in-memory only: never touch the real drafts store. Save straight to the demo
    // backend (activeApi) so the change is reflected, with no KEYS.drafts write.
    flushEntrySave(id, { [field]: value });
    return;
  }
  const draftWritten = writeDraft(id, { [field]: value });
  if (!draftWritten) {
    // The safety-net draft itself could not be written (storage full or blocked) - this is a
    // stronger failure than "saved locally but not yet confirmed", so it must not be reported as
    // "Saved locally". Try to save this field directly instead of silently losing it.
    setSaveState("error", "This browser couldn't save your change (storage may be full or blocked)");
    toast("This browser couldn't save your change locally. Storage may be full or blocked (for example in a private window). Trying to save it directly...", { error: true });
    flushEntrySave(id, { [field]: value });
    return;
  }
  setSaveState("draft");
  if (immediate) flushEntrySave(id);
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
  // A draft left over from a previous visit (the save never got the chance to run, or it failed)
  // shows as "Saved locally" right away, and retries as soon as the page opens.
  if (readDrafts()[state.route.id]) { setSaveState("draft"); flushEntrySave(); }
}

/** Reads what a field currently shows, preferring an unconfirmed draft over the last saved value. */
function draftValue(id, field, fallback) {
  const draft = readDrafts()[id]?.changes;
  return draft && field in draft ? draft[field] : fallback;
}

function saveSkills(update) {
  const id = state.route.id;
  const entry = find(id);
  if (!entry) return;
  const skills = cleanSkills(update(draftValue(id, "skills", entry.skills)));
  queueChange("skills", skills, { immediate: true });
  renderSkillChips();
}

function renderSkillChips() {
  const stored = find(state.route.id);
  if (!stored) return;
  const skills = draftValue(state.route.id, "skills", stored.skills);
  const editor = $("#skills-editor");
  if (!editor) return;
  const input = $("#skill-input");
  const value = input.value;
  editor.querySelectorAll(".skill-chip").forEach(chip => chip.remove());
  input.insertAdjacentHTML("beforebegin", skills.map(skill => `<span class="skill-chip">${esc(skill)}<button type="button" data-action="remove-skill" data-skill="${esc(skill)}" aria-label="Remove ${esc(skill)}">${icon("x")}</button></span>`).join(""));
  input.value = value;
  input.placeholder = skills.length ? "Add another…" : "Add skills, press Enter";
}

viewRoot.addEventListener("input", event => {
  const target = event.target;
  if (target.dataset.field && state.route.view === "entry") {
    if (target.tagName === "TEXTAREA") autosize(target);
    if (target.type === "date") syncDateField(target);
    else queueChange(target.dataset.field, target.value);
    return;
  }
  const input = target.dataset.input;
  if (input === "board-query") { state.boardQuery = target.value; refreshList(target); }
  if (input === "notebook-query") { state.filter.query = target.value; refreshList(target); }
  if (input === "news-location" || input === "news-keywords") {
    state.prefs.newsFilter[input === "news-location" ? "location" : "keywords"] = target.value.slice(0, 120);
    savePrefs();
    refreshList(target);
  }
  if (input === "name") { state.prefs.name = target.value.slice(0, 40); savePrefs(); }
  if (target.dataset.prepNote && state.route.view === "entry") {
    const entry = find(state.route.id);
    if (entry) queueChange("interview", withQuestionNote(draftValue(entry.id, "interview", entry.interview), target.dataset.prepNote, target.value));
  }
  if (input === "digest-email") { state.prefs.digestEmail = target.value.trim().slice(0, 254); savePrefs(); updateDigestLink(); }
  if ((state.route.view === "setup" || state.route.view === "build") && target.name && target.name in state.setupForm) {
    state.setupForm[target.name] = target.value;
    if (state.route.view === "build") refreshBuildSummary();
  }
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
    if (target.type === "date") syncDateField(target);
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
  if (target.dataset.input === "news-coop") { state.prefs.newsFilter.coopOnly = target.checked; savePrefs(); rerender(); }
  if ((state.route.view === "setup" || state.route.view === "build") && target.name && target.name in state.setupForm) {
    state.setupForm[target.name] = target.value;
    if (state.route.view === "build") refreshBuildSummary();
  }
  if (target.matches("[data-prep-filter]") && state.route.view === "entry") {
    state.prepOnlyToPractice = target.checked;
    const entry = find(state.route.id);
    if (entry) refreshPrep({ ...entry, interview: draftValue(entry.id, "interview", entry.interview) });
  }
  if (state.route.view === "build" && target.name === "startMode") state.build.startMode = target.value;
  if (state.route.view === "build" && (target.name === "useCase" || target.name === "focusArea")) changeBuildChip(target);
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

viewRoot.addEventListener("submit", event => {
  if (event.target.id === "setup-form") { event.preventDefault(); completeSetup(); return; }
  if (event.target.id === "build-form") {
    event.preventDefault();
    if (state.build.step < BUILD_STEPS.length) nextBuildStep(); else finishBuild();
    return;
  }
  if (event.target.id === "cloud-signin") { event.preventDefault(); signInCloud(); return; }
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

function notebookHasData(record) {
  return Boolean(record?.applications?.length || record?.recentlyDeleted?.length);
}

const completingNextSteps = new Set();
async function completeNextStep(id) {
  if (completingNextSteps.has(id)) return;
  completingNextSteps.add(id);
  try {
    await flushEntrySave(id);
    if (readDrafts()[id]) throw new Error("Retry the pending edits before completing this step.");
    const entry = find(id);
    if (!entry?.nextStep.trim()) return;
    const previous = { nextStep: entry.nextStep, nextStepDate: entry.nextStepDate, notes: entry.notes };
    const note = `${dayKey()} · Completed next step: ${entry.nextStep}${entry.nextStepDate ? ` (planned ${entry.nextStepDate})` : ""}`;
    const notes = `${entry.notes}${entry.notes ? "\n\n" : ""}${note}`;
    replaceApplications([await activeApi.update(id, { nextStep: "", nextStepDate: "", notes })]);
    rerender();
    viewRoot.focus({ preventScroll: true });
    const undoSession = currentSession();
    const undoWasDemo = inDemo();
    toast("Next step completed. A dated record is saved in Notes.", { action: "Undo", run: async () => {
      if (undoWasDemo && !sessionActive(undoSession)) return; // demo ended: do not touch the real backend
      try {
        await flushEntrySave(id);
        const current = find(id);
        if (readDrafts()[id] || !current || current.nextStep || current.nextStepDate || current.notes !== notes) {
          throw new Error("This page changed after completion. Your newer edits have been kept.");
        }
        replaceApplications([await activeApi.update(id, previous)]);
        rerender();
      } catch (error) { fail(error); }
    } });
  } catch (error) { fail(error); }
  finally { completingNextSteps.delete(id); }
}

const actions = {
  "build-notebook": () => startMyNotebook(),
  "build-back": () => { syncBuildForm(); state.build.errors = {}; showBuildStep(state.build.step - 1); },
  "welcome-tab": target => selectWelcomeTab(target.dataset.tab),
  "welcome-filter": target => filterWelcomeBoard(target.dataset.stage),
  "welcome-chaos": target => organizeWelcomeChaos(target.dataset.organized === "true"),
  "welcome-video": target => toggleWelcomeVideo(target),
  new: target => openNew(target.dataset.stage),
  "start-my-notebook": () => startMyNotebook(),
  "setup-submit": () => completeSetup(),
  "signup-browser-only": () => {
    // Keep it on this browser only: no account, data untouched, go to the real notebook.
    toast("Your notebook is saved on this browser.");
    go("#/today");
  },
  palette: () => openPalette(),
  "cycle-theme": () => {
    const order = ["system", "light", "dark"];
    setTheme(order[(order.indexOf(state.prefs.theme) + 1) % order.length]);
    toast(`Theme: ${themeLabel()}`);
  },
  "set-theme": target => setTheme(target.dataset.themeValue),
  "cloud-sync": () => runCloud(syncCloudNotebook),
  "cloud-signout": () => runCloud(async () => { await cloud.signOut(); cloudStatus = "Not signed in"; }),
  goal: target => {
    state.prefs.goal = clamp(state.prefs.goal + Number(target.dataset.delta), 1, 50);
    savePrefs();
    rerender();
  },
  "card-menu": target => { const entry = find(Number(target.dataset.id)); if (entry) cardMenu(target, entry); },
  "move-menu": target => { const entry = find(Number(target.dataset.id)); if (entry) cardMenu(target, entry); },
  "board-stage": target => { state.boardStage = target.dataset.stage; rerender(); },
  "complete-next": target => completeNextStep(Number(target.dataset.id)),
  "reschedule-next": target => {
    const id = Number(target.dataset.id);
    if (state.route.view === "entry" && state.route.id === id) $('[data-field="nextStepDate"]')?.focus();
    else { state.rescheduleId = id; go(`#/entry/${id}`); }
  },
  "news-save": target => {
    try {
      const listing = state.internships.listings[Number(target.dataset.index)];
      if (!listing) return;
      const link = cleanLink(listing.url);
      const tracked = state.applications.find(entry => postingKey(entry.link) === postingKey(link));
      if (tracked) { go(`#/entry/${tracked.id}`); return; }
      openNew("SAVED", {
        company: String(listing.company).slice(0, LIMITS.company), role: String(listing.role).slice(0, LIMITS.role),
        location: String(listing.location || "").slice(0, LIMITS.location), link, source: "Pitt CSC / Simplify"
      });
      newPostingLink = postingKey(link);
    } catch (error) { fail(error); }
  },
  "news-clear": () => {
    state.prefs.newsFilter = { term: "ALL", degree: "ALL", coopOnly: false, location: "", keywords: "" };
    savePrefs(); rerender();
  },
  "news-term-menu": target => {
    const current = state.prefs.newsFilter.term;
    openMenu(target, [
      { label: "All terms", radio: true, checked: current === "ALL", run: () => { state.prefs.newsFilter.term = "ALL"; savePrefs(); rerender(); } },
      ...newsTerms().map(term => ({ label: term, radio: true, checked: current === term, run: () => { state.prefs.newsFilter.term = term; savePrefs(); rerender(); } }))
    ]);
  },
  "news-degree-menu": target => {
    const current = state.prefs.newsFilter.degree;
    openMenu(target, [
      { label: "Any degree eligibility", radio: true, checked: current === "ALL", run: () => { state.prefs.newsFilter.degree = "ALL"; savePrefs(); rerender(); } },
      ...EXPERIENCE_LEVELS.map(([value, label]) => ({ label, radio: true, checked: current === value, run: () => { state.prefs.newsFilter.degree = value; savePrefs(); rerender(); } }))
    ]);
  },
  "entry-menu": target => {
    const entry = find(Number(target.dataset.id));
    if (!entry) return;
    openMenu(target, [
      ...(entry.link ? [{ label: "Open job posting", icon: "external", run: () => window.open(entry.link, "_blank", "noopener,noreferrer") }] : []),
      entry.status === "REJECTED"
        ? { label: `Reopen as ${LABELS[[...entry.history].reverse().find(change => change.status !== "REJECTED")?.status || "APPLIED"]}`, icon: "restore",
          run: () => setEntryStatus(entry.id, [...entry.history].reverse().find(change => change.status !== "REJECTED")?.status || "APPLIED") }
        : { label: "Mark rejected", icon: "x", run: () => setEntryStatus(entry.id, "REJECTED") },
      { label: "Duplicate page", icon: "copy", run: () => duplicate(entry) },
      { label: "Copy as text", icon: "file", run: () => copySummary(entry) },
      ...((entry.deadline || entry.nextStepDate) ? [{ label: "Add dates to calendar", icon: "calendar", run: () => exportCalendar(entry) }] : []),
      { separator: true },
      { label: "Move to Recently Deleted", icon: "trash", danger: true, run: () => removeApplications([entry.id]) }
    ]);
  },
  "toggle-star": target => toggleStar(Number(target.dataset.id)),
  "set-status": target => setEntryStatus(state.route.id, target.dataset.stage),
  "clear-date": target => {
    const input = $(`#entry-${target.dataset.clear}`);
    if (!input || !input.value) return;
    input.value = "";
    syncDateField(input);
    queueChange(target.dataset.clear, "", { immediate: true });
    input.focus();
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
  "prep-mark": target => setPrepStatus(Number(target.dataset.id), target.dataset.question, target.dataset.status),
  "prep-note": target => {
    const box = $(`#prep-note-${target.dataset.question}`);
    if (!box) return;
    box.hidden = !box.hidden;
    target.setAttribute("aria-expanded", String(!box.hidden));
    if (!box.hidden) box.querySelector("textarea")?.focus();
  },
  "open-prep": target => { state.scrollToPrep = true; go(`#/entry/${target.dataset.id}`); },
  "export-ics": () => exportIcs(),
  "export-md": () => exportMarkdown(),
  "print-notebook": () => window.print(),
  "toggle-due-alerts": () => toggleDueAlerts(),
  "check-due-now": () => checkDueSoon({ force: true }),
  "import-json": () => $("#import-file").click(),
  install: () => promptInstall(),
  reload: () => load(),
  "retry-save": () => flushEntrySave(),
  "download-corrupted": () => {
    if (state.corrupted) download(`notebook-recovery-${dayKey()}.txt`, state.corrupted.raw, "text/plain;charset=utf-8");
  },
  "recovery-reset": async () => {
    const ok = await confirmDialog({
      eyebrow: "This can't be undone",
      title: "Start a new notebook?",
      copy: "The unreadable data stays kept, exactly as found, at a separate backup key in this browser in case it can be recovered later. Your visible notebook will start empty.",
      yes: "Start new",
      iconName: "alert"
    });
    if (!ok) return;
    storage.set(KEYS.data, JSON.stringify({ nextId: 1, applications: [], recentlyDeleted: [] }));
    state.prefs.started = true; // starting fresh after recovery is an explicit start, not a demo visit
    savePrefs();
    state.corrupted = null;
    load();
  },
  "recovery-import": () => {
    // The unreadable copy is already kept at its own key (see StorageCorruptedError), so it is
    // safe to give the primary key a valid empty starting point before opening the file picker.
    storage.set(KEYS.data, JSON.stringify({ nextId: 1, applications: [], recentlyDeleted: [] }));
    state.prefs.started = true; // explicit recovery via import is a deliberate start, not a demo visit
    savePrefs();
    state.corrupted = null;
    load().then(() => $("#import-file").click());
  }
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

// Welcome tour video: media events do not bubble, so listen in the capture phase.
for (const type of ["play", "pause"]) {
  viewRoot.addEventListener(type, event => { if (event.target.matches?.(".tour-video")) syncWelcomeVideo(event.target); }, true);
}
viewRoot.addEventListener("error", event => { if (event.target.matches?.(".tour-video")) markVideoFailed(event.target); }, true);
// Interview prep groups remember being opened or closed; "toggle" does not bubble, so capture it.
viewRoot.addEventListener("toggle", event => {
  const group = event.target.closest?.(".prep-group");
  if (!group || state.route.view !== "entry") return;
  const open = state.prepOpen[state.route.id] ||= new Set();
  if (group.open) open.add(group.dataset.group); else open.delete(group.dataset.group);
}, true);
// In the builder, Enter on an option card moves on, like Enter in a text field. Browsers do not
// submit a form from a focused radio or checkbox on their own, and Space still toggles as usual.
viewRoot.addEventListener("keydown", event => {
  if (event.key !== "Enter" || !event.target.matches?.('#build-form input[type="radio"], #build-form input[type="checkbox"]')) return;
  event.preventDefault();
  $("#build-form").requestSubmit();
});
// Welcome tour tabs follow the ARIA tabs pattern: arrows move and select, Home/End jump to the ends.
viewRoot.addEventListener("keydown", event => {
  const tab = event.target.closest?.("[data-action='welcome-tab']");
  if (!tab) return;
  const keys = WELCOME_TOUR.map(item => item.key);
  const index = keys.indexOf(tab.dataset.tab);
  const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: keys.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  event.stopPropagation(); // keep the global shortcuts below from also reacting to this key
  selectWelcomeTab(keys[(next + keys.length) % keys.length], { focus: true });
});

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

function exportJson(record = { applications: state.applications, recentlyDeleted: state.deleted }) {
  const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), applications: record.applications, recentlyDeleted: record.recentlyDeleted };
  download(`internship-notebook-backup-${dayKey()}.json`, JSON.stringify(backup, null, 2), "application/json");
  toast("Backup downloaded. Keep it somewhere safe.");
}

function exportCalendar(entry) {
  const calendar = entryCalendar(entry);
  if (!calendar) { toast("Add a deadline or next-step date first."); return; }
  const safeCompany = entry.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "application";
  download(`${safeCompany}-dates.ics`, calendar, "text/calendar;charset=utf-8");
  toast("Calendar file downloaded");
}

$("#import-file").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("That file is too large to be a notebook backup.");
    const parsed = JSON.parse(await file.text());
    const rawEntries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.applications) ? parsed.applications : null;
    const rawDeleted = !Array.isArray(parsed) && Array.isArray(parsed?.recentlyDeleted) ? parsed.recentlyDeleted : null;
    if (!rawEntries && !rawDeleted) throw new Error("That file isn't a My Internship Notebook backup.");
    const format = Array.isArray(parsed) ? null : parsed?.format;
    const version = Array.isArray(parsed) ? NaN : Number(parsed?.version);
    // Every field goes through the same limits and safety rules as a normal entry (see
    // sanitizeImportedEntry in domain.js) - in particular, a link is only kept if it survives the
    // same http(s)-only check a typed link does, so a backup can never smuggle in an unsafe URL.
    const active = previewImport(rawEntries || []);
    const deleted = previewImport(rawDeleted || []);
    const cutoff = Date.now() - RETENTION_MS;
    const recoverable = deleted.usable.filter(entry => new Date(entry.deletedAt).getTime() > cutoff);
    const expired = deleted.usable.length - recoverable.length;
    const skipped = active.skipped + deleted.skipped;
    const linksRemoved = active.linksRemoved + deleted.linksRemoved;
    const total = active.usable.length + recoverable.length;
    if (!total) throw new Error("No recoverable pages with a company and role were found in that backup.");
    const notes = [
      format && format !== BACKUP_FORMAT ? "This file wasn't made by My Internship Notebook. Importing what looks like application data." : "",
      Number.isFinite(version) && version > BACKUP_VERSION ? "This backup was made with a newer version of the app; some newer fields may be ignored." : "",
      skipped ? `${plural(skipped, "entry", "entries")} without a company and role will be skipped.` : "",
      expired ? `${plural(expired, "deleted page")} with an expired or missing deletion date will be skipped.` : "",
      linksRemoved ? `${plural(linksRemoved, "link")} could not be verified as safe and will be left blank.` : ""
    ].filter(Boolean);
    const ok = await confirmDialog({
      eyebrow: "Import backup",
      title: `Add ${plural(total, "page")} to your notebook?`,
      copy: [`This backup contains ${active.usable.length} active and ${recoverable.length} deleted pages. Your current pages stay as they are. Pages already in your notebook are skipped. Original dates and history are kept, including the seven-day deletion window.`, ...notes].join(" "),
      yes: "Import",
      no: "Cancel",
      iconName: "upload",
      danger: false
    });
    if (!ok) return;
    const added = await activeApi.importBackup(active.usable, recoverable);
    state.applications.push(...added.applications);
    state.deleted.push(...added.recentlyDeleted);
    rerender();
    const addedCount = added.applications.length + added.recentlyDeleted.length;
    if (!addedCount) { toast("Everything in that backup is already in your notebook."); return; }
    const duplicates = total - addedCount;
    const detail = [duplicates ? `${plural(duplicates, "duplicate")} skipped` : "", skipped ? `${plural(skipped, "entry", "entries")} skipped` : "", linksRemoved ? `${plural(linksRemoved, "link")} removed for safety` : ""].filter(Boolean).join(", ");
    const importUndoSession = currentSession();
    const importUndoWasDemo = inDemo();
    toast(`Imported ${plural(addedCount, "page")}${detail ? ` (${detail})` : ""}`, { action: "Undo", run: async () => {
      if (importUndoWasDemo && !sessionActive(importUndoSession)) return; // demo ended: do not touch the real backend
      try {
        const deletedIds = added.recentlyDeleted.map(entry => entry.id);
        if (deletedIds.length) {
          await activeApi.purge(deletedIds);
          state.deleted = state.deleted.filter(entry => !deletedIds.includes(entry.id));
        }
        if (added.applications.length) await removeApplications(added.applications.map(entry => entry.id), { confirmFirst: false });
        else { rerender(); toast("Import undone. Your backup file is unchanged."); }
      } catch (error) { fail(error); }
    } });
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
  state.corrupted = null;
  render();
  try {
    // Always load the real notebook through the real backend first. The first-run decision runs
    // only on this successful read; a StorageCorruptedError is caught below and shown via the
    // recovery flow, so corrupted data is never mistaken for an empty (new) notebook.
    const { applications, deleted } = await api.load();
    state.applications = applications;
    state.deleted = deleted;
    state.loaded = true;
    retryPendingDrafts();
    maybeEnterDemo();
    settleWelcomeHash();
  } catch (error) {
    if (error instanceof StorageCorruptedError) state.corrupted = error;
    else state.loadError = error.message;
  }
  render({ animate: true, keepScroll: false });
}

/** Decides first-run routing after a successful real-notebook read. A new visitor (browser edition,
 *  no existing work, not started) lands on the welcome page in demo mode; everyone else keeps their
 *  real notebook. If the demo dataset cannot be built, fall back to the real (empty) notebook. */
function maybeEnterDemo() {
  if (state.demoMode) return;
  if (!BROWSER_MODE) return;
  const record = { applications: state.applications, recentlyDeleted: state.deleted };
  if (!isNewVisitor(record)) return;
  enterDemoMode(); // on failure this returns false and we simply stay on the real empty notebook
  if (shouldLandOnWelcome({ browserMode: BROWSER_MODE, newVisitor: true, demoActive: inDemo(), hash: window.location.hash, launchIntent: openNewOnStart })) {
    // replaceState, not go(): the welcome page IS the first page, so Back should leave the site
    // rather than bounce to a Today screen the visitor never saw.
    window.history.replaceState(null, "", "#/welcome");
    state.route = parseRoute();
  }
}

function hydrateStaticIcons() {
  $$("[data-icon]").forEach(element => { element.innerHTML = icon(element.dataset.icon); });
  $$(".cover-logo").forEach(element => { element.innerHTML = LOGO; });
  updateStorageChip();
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  $$(".shortcut-key").forEach(element => { element.textContent = isMac ? "⌘K" : "Ctrl K"; });
}

function updateStorageChip() {
  const label = $("[data-storage-label]");
  const chip = $("[data-storage-chip]");
  if (!label || !chip) return;
  if (!BROWSER_MODE) {
    label.textContent = "Saved on this computer";
    chip.title = "Your pages are saved by the local Java server.";
  } else {
    label.textContent = "Private to this browser";
    chip.title = "Your pages are stored only in this browser on this device.";
  }
}

window.addEventListener("hashchange", navigate);
window.addEventListener("pagehide", () => { if (!inDemo()) flushEntrySave(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && !inDemo()) flushEntrySave(); });
// Keep relative times ("2 min ago", "3 days left") fresh while the app stays open. The welcome page
// and the builder are skipped: neither shows relative times, and a re-render would restart the tour
// video or pull focus off the builder's buttons.
window.setInterval(() => {
  const typing = document.activeElement?.closest?.("#view input, #view textarea, #view select");
  if (state.loaded && !["entry", "welcome", "build"].includes(state.route.view) && !typing && !$$("dialog").some(dialog => dialog.open) && menu.hidden) rerender();
}, 60000);

hydrateStaticIcons();
applyTheme();
loadInternships();
// The installed app's "New application" shortcut opens #/new.
const shared = new URLSearchParams(window.location.search);
const sharedOnStart = shared.has("share-target") || shared.has("title") || shared.has("text") || shared.has("url");
const openNewOnStart = window.location.hash === "#/new" || sharedOnStart;
if (openNewOnStart) window.history.replaceState(null, "", "#/today");
state.route = parseRoute();
load().then(() => {
  checkDueSoon(); // opt-in, real notebook only, once a day, and only because the tab is open
  if (openNewOnStart && state.loaded) openNew("SAVED", sharedOnStart ? {
    role: (shared.get("title") || "").slice(0, LIMITS.role),
    link: (shared.get("url") || "").slice(0, LIMITS.link),
    notes: (shared.get("text") || "").slice(0, LIMITS.notes)
  } : {});
});
