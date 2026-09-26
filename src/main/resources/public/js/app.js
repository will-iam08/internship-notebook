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
  cleanSkills, countBy, reached, metrics, weekActivity, agendaItems, attentionItems, matchesQuery, compareBy,
  previewImport
} from "./domain.js";
import { KEYS, clearConfirmedDraft, clearDraft, readDrafts, storage, writeDraft } from "./storage.js";
import { api, BROWSER_MODE, StorageCorruptedError } from "./api.js";
import {
  cloudSnapshot, createEmailAccount, deleteCloudAccount, disableCloud, enableCloudWithLocal, enableCloudWithRemote,
  fetchCloudNotebook, initializeCloud, refreshAccount, resendVerification, resumeCloud, sendPasswordReset,
  signInEmail, signInGoogle, signOutCloud
} from "./cloud.js";
import { entryCalendar } from "./calendar.js";
import { icon, LOGO } from "./ui/icons.js";

/* ==========================================================================
   1. Constants
   ========================================================================== */
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
  corrupted: null,
  route: { view: "today", id: null },
  backRoute: "#/board",
  selecting: false,
  selectScope: "",
  selected: new Set(),
  visibleIds: [],
  boardQuery: "",
  boardStage: "SAVED",
  filter: { query: "", stage: "ALL" },
  prefs: readPrefs(),
  cloud: cloudSnapshot(),
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
        <p>Add a role you're interested in, move it along as you apply and interview, and keep notes for each one. Your entries ${BROWSER_MODE
          ? state.cloud.enabled ? "are saved in this browser and synced to your private account notebook." : "stay private in this browser unless you explicitly turn on cloud sync in Settings."
          : "are saved on this computer by the notebook server."}</p>
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

  const attention = attentionItems(state.applications);
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

function viewBoard() {
  const query = state.boardQuery.trim();
  const visible = state.applications.filter(entry => matchesQuery(entry, query));
  state.visibleIds = visible.map(entry => entry.id);
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

      <section class="card">
        <h2 class="card-title" style="margin-bottom:10px">Account &amp; cloud sync</h2>
        ${cloudSettings()}
      </section>

      <section class="card">
        <h2 class="card-title" style="margin-bottom:10px">Your data</h2>
        <div class="setting-row"><div><strong>${BROWSER_MODE ? state.cloud.enabled ? "Local-first, with account sync" : "Private to this browser" : "Saved on this computer"}</strong>
          <p>${BROWSER_MODE
            ? state.cloud.enabled
              ? "Pages are saved locally first and copied to your private account notebook while sync is on. Verified account access and Firestore rules restrict the cloud copy to your user ID. Anyone using this same unlocked browser profile can still see the local copy."
              : "Pages are stored in this browser profile on this device. Nothing is uploaded. Other browser profiles and devices cannot see them, but anyone using this same profile can. Use a separate profile on a shared device, and use a backup file to move your notebook."
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

      <p class="muted" style="font-size:.82rem">My Internship Notebook · <a href="privacy.html">Privacy</a> · <a href="delete-account.html">Account deletion</a> · <a href="https://github.com/will-iam08/coop-compass" target="_blank" rel="noopener noreferrer">Source on GitHub</a></p>
    </div>`;
}

function cloudSettings() {
  if (!BROWSER_MODE) return `<div class="setting-row"><div><strong>Local server mode</strong><p>Cloud sync is available on the public web app. This development copy continues to use the Java server.</p></div></div>`;
  const cloud = state.cloud;
  if (!cloud.ready) return `<div class="setting-row"><div><strong>${cloud.status === "unavailable" ? "Cloud sync unavailable" : "Loading account options…"}</strong><p>${esc(cloud.error || "Your local notebook remains available while Firebase loads.")}</p></div></div>`;
  if (!cloud.user) return `
    <div class="setting-row"><div><strong>Optional cloud sync</strong><p>Sign in to use the same notebook on your devices. Your local notebook stays on this device until you explicitly choose to upload it.</p></div>
      <button class="button primary" type="button" data-action="cloud-google">Sign in with Google</button></div>
    <div class="cloud-email-form">
      <label class="field"><span class="field-label">Email</span><input id="cloud-email" type="email" autocomplete="email" maxlength="254" /></label>
      <label class="field"><span class="field-label">Password</span><input id="cloud-password" type="password" autocomplete="current-password" minlength="6" maxlength="128" /></label>
      <div class="view-actions">
        <button class="button" type="button" data-action="cloud-email-signin">Sign in</button>
        <button class="button ghost" type="button" data-action="cloud-email-create">Create account</button>
        <button class="text-button" type="button" data-action="cloud-reset">Forgot password?</button>
      </div>
    </div>`;
  if (!cloud.user.verified) return `
    <div class="setting-row"><div><strong>Verify ${esc(cloud.user.email)}</strong><p>We sent a verification link. Cloud data stays locked until the address is verified.</p></div></div>
    <div class="view-actions"><button class="button primary" type="button" data-action="cloud-check-email">I've verified it</button><button class="button ghost" type="button" data-action="cloud-resend">Resend email</button><button class="text-button" type="button" data-action="cloud-signout">Sign out</button></div>`;
  return `
    <div class="setting-row"><div><strong>${cloud.enabled ? "Cloud sync is on" : "Signed in — sync is paused"}</strong><p>${esc(cloud.user.email)} · ${cloud.enabled ? (cloud.status === "syncing" ? "Syncing…" : cloud.status === "error" ? cloud.error : "Synced with your private account notebook.") : "This device is still local-only until you choose a copy to sync."}</p></div>
      ${cloud.enabled
        ? `<div class="view-actions">${cloud.status === "error" ? `<button class="button primary" type="button" data-action="cloud-retry">Retry sync</button>` : ""}<button class="button ghost" type="button" data-action="cloud-disable">Pause sync</button></div>`
        : `<button class="button primary" type="button" data-action="cloud-enable">Choose notebook</button>`}</div>
    <div class="setting-row"><div><strong>Delete cloud account</strong><p>Permanently removes your sign-in and cloud notebook. The notebook saved in this browser is kept unless you clear it separately.</p></div>
      <div class="view-actions">
        ${cloud.user.providers?.includes("password") ? `<input id="cloud-delete-password" type="password" autocomplete="current-password" maxlength="128" placeholder="Current password" aria-label="Current password for account deletion" />` : ""}
        <button class="button danger-soft" type="button" data-action="cloud-delete-account">Delete account</button>
      </div></div>
    <div class="view-actions"><button class="text-button" type="button" data-action="cloud-signout">Sign out</button></div>
    <p class="card-note">Firebase Authentication controls access and Firestore rules restrict each notebook to its verified owner. This is recoverable account security, not user-only end-to-end encryption.</p>`;
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
  const timeline = [...entry.history].reverse().map((change, index, list) => {
    const first = index === list.length - 1;
    return `<li class="st-${change.status}"><strong>${first ? `Added as ${LABELS[change.status]}` : `Moved to ${LABELS[change.status]}`}</strong><span>${esc(formatDateTime(change.at))}</span></li>`;
  }).join("");
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
  return { view: renderers[view] ? view : "today", id: null };
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
  viewRoot.innerHTML = view === "entry" ? viewEntry(id) : renderers[view]();
  const entry = view === "entry" ? find(id) : null;
  const title = entry ? `${entry.company}` : VIEWS[view].title;
  document.title = `${title} · My Internship Notebook`;
  $("#mobile-title").textContent = title;
  // An open application page is still a page of "All pages", so that tab stays highlighted
  // instead of every tab looking unselected while you are reading or editing an entry.
  const navKey = view === "entry" ? "notebook" : view;
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
  const stats = metrics(state.applications);
  const values = { active: stats.open, total: stats.total, deleted: state.deleted.length };
  $$("[data-count]").forEach(element => { element.textContent = values[element.dataset.count] || ""; });
}

/* ==========================================================================
   12. Toasts, confirm dialog, popover menu
   ========================================================================== */
const toasts = $("#toasts");
/**
 * A toast with an Undo (or Retry) action gets a longer 10s timer instead of ~5s, since deciding
 * whether to undo something and then pressing a small button takes longer than reading a plain
 * status message - and the timer pauses entirely while the toast is hovered or has keyboard
 * focus, so a screen-reader or keyboard user who has landed on the Undo button never has it
 * disappear out from under them while they're still using it (WCAG 2.2.1, Timing Adjustable).
 */
function toast(message, { action, run, error = false, duration } = {}) {
  const element = document.createElement("div");
  element.className = `toast${error ? " error" : ""}`;
  element.innerHTML = `<span>${esc(message)}</span>`;
  let timer = null;
  const dismiss = () => {
    if (!element.isConnected) return;
    window.clearTimeout(timer);
    element.classList.add("leaving");
    window.setTimeout(() => element.remove(), 240);
  };
  const totalMs = duration ?? (action ? 10000 : error ? 7000 : 5200);
  const arm = () => { timer = window.setTimeout(dismiss, totalMs); };
  const disarm = () => window.clearTimeout(timer);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action;
    button.addEventListener("click", () => { dismiss(); run?.(); });
    element.append(button);
  }
  element.addEventListener("pointerenter", disarm);
  element.addEventListener("pointerleave", arm);
  element.addEventListener("focusin", disarm);
  element.addEventListener("focusout", arm);
  toasts.append(element);
  while (toasts.children.length > 3) toasts.firstElementChild.remove();
  arm();
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
    // A stage choice is one of a mutually exclusive set (only one stage is ever "checked"), so it
    // gets menuitemradio with aria-checked; a plain action is menuitem and has neither.
    const role = item.stage ? "menuitemradio" : "menuitem";
    const checkedAttr = item.stage ? ` aria-checked="${Boolean(item.checked)}"` : "";
    return `<button type="button" role="${role}" data-menu-index="${index}" class="${item.danger ? "danger" : ""} ${item.stage ? `st-${item.stage}` : ""}"${checkedAttr}>
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
    ...(entry.link ? [{ label: "Open job posting", icon: "external", run: () => window.open(entry.link, "_blank", "noopener,noreferrer") }] : []),
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
   is unsaved for entry X"; flushEntrySave() always reads from it and only clears it once api.update()
   has actually confirmed the write, so a failed save keeps the edit queued for automatic retry
   (on a timer and when the connection comes back) instead of discarding it.

   Four states are shown, and each means something different:
     "Saving…"       a request to save is in flight right now
     "Saved locally" the edit is captured in this browser (the draft above), but not yet confirmed
     "Synced"        the Java server has confirmed the write (server mode only)
     "Couldn't save" the last attempt failed; the edit is still queued and will retry, or press Retry
   The website edition has no server to sync to, so it never claims "Synced": once api.update()
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
  const changes = overrideChanges || readDrafts()[targetId]?.changes;
  if (!changes || !Object.keys(changes).length) return saveChain;
  if (inFlight.has(targetId)) return saveChain;
  inFlight.add(targetId);
  const isCurrent = () => state.route.view === "entry" && state.route.id === targetId;
  if (isCurrent()) setSaveState("saving");
  saveChain = saveChain.then(async () => {
    let resendQueued = false;
    try {
      if (!find(targetId)) { clearDraft(targetId); return; } // the page was deleted while a draft was pending
      const updated = await api.update(targetId, changes);
      replaceApplications([updated]);
      // Only the fields whose current draft value still matches what was just sent are cleared.
      // Anything typed *during* this request (queued by writeDraft while the await above was
      // pending) is a different value than what `changes` captured, so it is left queued instead
      // of being silently thrown away with the rest of the draft - that was the actual bug: a
      // plain clearDraft() here deleted the whole draft, snapshot and any later edits alike.
      clearConfirmedDraft(targetId, changes);
      window.clearTimeout(retryTimers.get(targetId));
      retryTimers.delete(targetId);
      updateCounts();
      if (isCurrent()) {
        setSaveState("synced");
        const edited = $("[data-edited]");
        if (edited) edited.textContent = timeAgo(updated.updatedAt);
        if ("link" in changes) refreshLinkButton(updated);
        if ("company" in changes) { $("#mobile-title").textContent = updated.company; document.title = `${updated.company} · My Internship Notebook`; }
      }
      resendQueued = Boolean(readDrafts()[targetId]); // something else arrived while this save was in flight
    } catch (error) {
      // The draft on disk is untouched (it was written before this attempt started), so nothing
      // typed is lost - only the confirmation failed. Keep retrying instead of giving up on it.
      if (isCurrent()) setSaveState("error", error.message);
      toast(`Couldn't save ${find(targetId)?.company || "your change"}: ${error.message}`, { error: true, action: "Retry", run: () => flushEntrySave(targetId) });
      window.clearTimeout(retryTimers.get(targetId));
      retryTimers.set(targetId, window.setTimeout(() => flushEntrySave(targetId), RETRY_DELAY_MS));
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
  for (const id of Object.keys(readDrafts()).map(Number).filter(id => find(id))) await flushEntrySave(id);
}
window.addEventListener("online", retryPendingDrafts);

function queueChange(field, value, { immediate = false } = {}) {
  const id = state.route.id;
  if ((field === "company" || field === "role") && !String(value).trim()) {
    setSaveState("error", `${field === "company" ? "Company" : "Role"} can't be empty`);
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

function notebookHasData(record) {
  return Boolean(record?.applications?.length || record?.recentlyDeleted?.length);
}

function cloudCredentials() {
  const email = $("#cloud-email")?.value.trim() || "";
  const password = $("#cloud-password")?.value || "";
  if (!email) throw new Error("Enter your email address.");
  return { email, password };
}

async function chooseCloudNotebook() {
  const remote = await fetchCloudNotebook();
  const local = BROWSER_MODE ? api.read() : null;
  if (!remote) {
    const upload = await confirmDialog({
      eyebrow: "First cloud sync",
      title: notebookHasData(local) ? "Upload this device's notebook?" : "Create your cloud notebook?",
      copy: notebookHasData(local)
        ? "This copies the notebook currently in this browser into your private account. Nothing local is deleted."
        : "This creates an empty private notebook for your account and turns on sync for future pages.",
      yes: "Upload & sync",
      no: "Not now",
      iconName: "upload",
      danger: false
    });
    if (!upload) return;
    await enableCloudWithLocal();
    toast("Cloud sync is on.");
    rerender();
    return;
  }
  if (!notebookHasData(local)) {
    const download = await confirmDialog({
      eyebrow: "Notebook found",
      title: "Use your cloud notebook on this device?",
      copy: "This downloads your account notebook into this browser and turns on sync.",
      yes: "Use cloud notebook",
      no: "Keep local-only",
      iconName: "download",
      danger: false
    });
    if (!download) return;
    await enableCloudWithRemote(remote);
    await load();
    toast("Cloud notebook restored.");
    return;
  }
  const useCloud = await confirmDialog({
    eyebrow: "Choose carefully",
    title: "A notebook already exists in your account",
    copy: "Use the cloud notebook on this device? Your current device copy will be replaced, so download a backup first if you need both. Choosing Keep local leaves sync paused and changes neither copy.",
    yes: "Use cloud notebook",
    no: "Keep local",
    iconName: "download",
    danger: false
  });
  if (!useCloud) return;
  await enableCloudWithRemote(remote);
  await load();
  toast("Cloud notebook restored.");
}

async function runCloud(action) {
  try { await action(); }
  catch (error) { fail(error); }
}

const actions = {
  new: target => openNew(target.dataset.stage),
  palette: () => openPalette(),
  "cycle-theme": () => {
    const order = ["system", "light", "dark"];
    setTheme(order[(order.indexOf(state.prefs.theme) + 1) % order.length]);
    toast(`Theme: ${themeLabel()}`);
  },
  "set-theme": target => setTheme(target.dataset.themeValue),
  "cloud-google": () => runCloud(async () => { await signInGoogle(); await chooseCloudNotebook(); }),
  "cloud-email-signin": () => runCloud(async () => {
    const { email, password } = cloudCredentials();
    if (!password) throw new Error("Enter your password.");
    await signInEmail(email, password);
    await chooseCloudNotebook();
  }),
  "cloud-email-create": () => runCloud(async () => {
    const { email, password } = cloudCredentials();
    if (password.length < 6) throw new Error("Use a password with at least 6 characters.");
    await createEmailAccount(email, password);
    toast("Verification email sent. Open it before enabling sync.");
    rerender();
  }),
  "cloud-reset": () => runCloud(async () => {
    const { email } = cloudCredentials();
    await sendPasswordReset(email);
    toast("If that address has an account, a reset email is on its way.");
  }),
  "cloud-resend": () => runCloud(async () => { await resendVerification(); toast("Verification email sent."); }),
  "cloud-check-email": () => runCloud(async () => { await refreshAccount(); if (cloudSnapshot().user?.verified) await chooseCloudNotebook(); else toast("That email is not verified yet.", { error: true }); }),
  "cloud-enable": () => runCloud(chooseCloudNotebook),
  "cloud-retry": () => runCloud(async () => { await enableCloudWithLocal(); toast("Cloud notebook synced."); rerender(); }),
  "cloud-disable": () => runCloud(async () => {
    const pause = await confirmDialog({ eyebrow: "This device", title: "Pause cloud sync?", copy: "Changes will keep saving locally in this browser, but they will not reach your other devices until sync is turned on again.", yes: "Pause sync", no: "Keep syncing", iconName: "lock", danger: false });
    if (pause) { disableCloud(); rerender(); }
  }),
  "cloud-signout": () => runCloud(async () => { await signOutCloud(); toast("Signed out. Your local notebook is still here."); rerender(); }),
  "cloud-delete-account": () => runCloud(async () => {
    const password = $("#cloud-delete-password")?.value || "";
    const confirmed = await confirmDialog({
      eyebrow: "Permanent account deletion",
      title: "Delete your cloud account and notebook?",
      copy: "This permanently deletes your Firebase sign-in and the notebook stored in your account. Your copy in this browser remains on this device.",
      yes: "Delete account",
      no: "Keep account",
      iconName: "trash",
      danger: true
    });
    if (!confirmed) return;
    await deleteCloudAccount(password);
    toast("Cloud account deleted. Your local notebook is still here.");
    rerender();
  }),
  goal: target => {
    state.prefs.goal = clamp(state.prefs.goal + Number(target.dataset.delta), 1, 50);
    savePrefs();
    rerender();
  },
  "card-menu": target => { const entry = find(Number(target.dataset.id)); if (entry) cardMenu(target, entry); },
  "move-menu": target => { const entry = find(Number(target.dataset.id)); if (entry) cardMenu(target, entry); },
  "board-stage": target => { state.boardStage = target.dataset.stage; rerender(); },
  "entry-menu": target => {
    const entry = find(Number(target.dataset.id));
    if (!entry) return;
    openMenu(target, [
      ...(entry.link ? [{ label: "Open job posting", icon: "external", run: () => window.open(entry.link, "_blank", "noopener,noreferrer") }] : []),
      { label: "Duplicate page", icon: "copy", run: () => duplicate(entry) },
      { label: "Copy as text", icon: "file", run: () => copySummary(entry) },
      ...((entry.deadline || entry.nextStepDate) ? [{ label: "Add dates to calendar", icon: "calendar", run: () => exportCalendar(entry) }] : []),
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
    state.corrupted = null;
    load();
  },
  "recovery-import": () => {
    // The unreadable copy is already kept at its own key (see StorageCorruptedError), so it is
    // safe to give the primary key a valid empty starting point before opening the file picker.
    storage.set(KEYS.data, JSON.stringify({ nextId: 1, applications: [], recentlyDeleted: [] }));
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
  const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), applications: state.applications, recentlyDeleted: state.deleted };
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
    if (!rawEntries || !rawEntries.length) throw new Error("That file isn't a My Internship Notebook backup.");
    const format = Array.isArray(parsed) ? null : parsed?.format;
    const version = Array.isArray(parsed) ? NaN : Number(parsed?.version);
    // Every field goes through the same limits and safety rules as a normal entry (see
    // sanitizeImportedEntry in domain.js) - in particular, a link is only kept if it survives the
    // same http(s)-only check a typed link does, so a backup can never smuggle in an unsafe URL.
    const { usable, skipped, linksRemoved } = previewImport(rawEntries);
    if (!usable.length) throw new Error("No applications with a company and role were found in that backup.");
    const notes = [
      format && format !== BACKUP_FORMAT ? "This file wasn't made by My Internship Notebook. Importing what looks like application data." : "",
      Number.isFinite(version) && version > BACKUP_VERSION ? "This backup was made with a newer version of the app; some newer fields may be ignored." : "",
      skipped ? `${plural(skipped, "entry", "entries")} without a company and role will be skipped.` : "",
      linksRemoved ? `${plural(linksRemoved, "link")} could not be verified as safe and will be left blank.` : ""
    ].filter(Boolean);
    const ok = await confirmDialog({
      eyebrow: "Import backup",
      title: `Add ${plural(usable.length, "page")} to your notebook?`,
      copy: ["Your current pages stay as they are. Pages already in your notebook are skipped.", ...notes].join(" "),
      yes: "Import",
      no: "Cancel",
      iconName: "upload",
      danger: false
    });
    if (!ok) return;
    const added = await api.importEntries(usable);
    state.applications.push(...added);
    rerender();
    if (!added.length) { toast("Everything in that backup is already in your notebook."); return; }
    const duplicates = usable.length - added.length;
    const detail = [duplicates ? `${plural(duplicates, "duplicate")} skipped` : "", skipped ? `${plural(skipped, "entry", "entries")} skipped` : "", linksRemoved ? `${plural(linksRemoved, "link")} removed for safety` : ""].filter(Boolean).join(", ");
    toast(`Imported ${plural(added.length, "page")}${detail ? ` (${detail})` : ""}`, { action: "Undo", run: () => removeApplications(added.map(entry => entry.id), { confirmFirst: false }) });
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
    const { applications, deleted } = await api.load();
    state.applications = applications;
    state.deleted = deleted;
    state.loaded = true;
    retryPendingDrafts();
  } catch (error) {
    if (error instanceof StorageCorruptedError) state.corrupted = error;
    else state.loadError = error.message;
  }
  render({ animate: true, keepScroll: false });
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
  } else if (state.cloud.enabled) {
    label.textContent = state.cloud.status === "syncing" ? "Syncing securely" : state.cloud.status === "error" ? "Cloud sync needs attention" : "Synced to your account";
    chip.title = state.cloud.error || "Your local notebook is synced to your private Firebase account.";
  } else {
    label.textContent = "Private to this browser";
    chip.title = "Your pages are stored only in this browser on this device.";
  }
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
const shared = new URLSearchParams(window.location.search);
const sharedOnStart = shared.has("share-target") || shared.has("title") || shared.has("text") || shared.has("url");
const openNewOnStart = window.location.hash === "#/new" || sharedOnStart;
if (openNewOnStart) window.history.replaceState(null, "", "#/today");
state.route = parseRoute();
load().then(async () => {
  if (openNewOnStart && state.loaded) openNew("SAVED", sharedOnStart ? {
    role: (shared.get("title") || "").slice(0, LIMITS.role),
    link: (shared.get("url") || "").slice(0, LIMITS.link),
    notes: (shared.get("text") || "").slice(0, LIMITS.notes)
  } : {});
  if (!BROWSER_MODE) return;
  let resumeStarted = false;
  await initializeCloud(snapshot => {
    state.cloud = snapshot;
    updateStorageChip();
    if (state.route.view === "settings") rerender();
    if (!resumeStarted && snapshot.user?.verified) {
      resumeStarted = true;
      resumeCloud(api.read()).then(async result => {
        if (result.action === "use-remote") await load();
      }).catch(error => fail(error));
    }
  });
});
